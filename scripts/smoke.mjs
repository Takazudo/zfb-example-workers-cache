#!/usr/bin/env node
// Header-contract check for this site, in two roles:
//
//   post-deploy — run against the live custom domain, it confirms the domain is
//                 attached and serving this site with the expected cache headers.
//   pre-deploy  — run against `pnpm preview` (SMOKE_BASE_URL), it gates the same
//                 contract on every push and PR without Cloudflare credentials,
//                 and is the only place `Cache-Tag` can be asserted at all (the
//                 edge strips it — see ROUTE_CONTRACT).
//
// A deploy can succeed while the site is still unreachable — the custom-domain
// route, its DNS record, and its edge TLS cert are provisioned by Cloudflare
// asynchronously. This script is the only check that confirms the domain is
// actually attached and serving this site.
//
// Three outcomes:
//   SKIP (exit 0) — the domain is not wired up yet (no DNS, no cert, refused
//                   connection). House rule: the repo never shows a red deploy
//                   before Cloudflare is wired up. Retired by SMOKE_REQUIRE_LIVE.
//   PASS (exit 0) — the domain serves this site with the expected cache contract.
//   FAIL (exit 1) — the domain resolves but the site is wrong or broken; or an
//                   already-issued cert expired; or the host is unreachable
//                   while SMOKE_REQUIRE_LIVE is set.
//
// Target override, in precedence order: argv[2], SMOKE_BASE_URL, the real domain.
//
// SMOKE_REQUIRE_LIVE=1 turns every SKIP into a FAIL. Set it once the domain is
// confirmed live — from then on "not serving yet" is an outage, not a
// provisioning window. It governs ONLY the domain-not-ready skip. The cache
// HIT/MISS nondeterminism tolerance is a separate concern and stays non-fatal in
// both modes; see observeCacheBehavior().
//
// SMOKE_ASSERT_CACHE_TAG=1 fails the run if no Cache-Tag assertion executed —
// i.e. it demands an off-edge target. Set it wherever the Cache-Tag check is the
// point of the run (CI's build job); see ASSERT_CACHE_TAG.
//
// Read-only GETs only. POST /api/purge is a mutating, token-guarded admin
// endpoint and is deliberately never exercised here.

// argv[2] is what makes the skip/fail matrix testable by hand against known-bad
// endpoints (an expired cert, a hostname that does not resolve, …).
const BASE_URL = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "https://zfb-example-workers-cache.takazudomodular.com").replace(/\/+$/, "");

const REQUIRE_LIVE = /^(1|true)$/i.test((process.env.SMOKE_REQUIRE_LIVE ?? "").trim());

const REQUEST_TIMEOUT_MS = 15_000;
const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_DELAY_MS = 5_000;

// Unique to this site — the <h1> of pages/index.tsx. A wildcard DNS record or a
// misrouted zone would serve *something*; this is what proves it serves THIS site.
const CONTENT_MARKER = "A compact zfb recipe for response-header driven caching.";

// The cache contract each route promises. These come from lib/http.tsx via the
// `cacheControl` prop each page passes, and the Worker sets them on EVERY
// response regardless of edge cache state — which is exactly why they are safe
// to assert on. See the "why not assert a HIT" note further down.
//
// `cacheTag` is the exception, and the reason this script cares whether it is
// talking to the edge: Cloudflare CONSUMES `Cache-Tag`. It is a cache-control-plane
// header, stripped before the response reaches the client, so it is unassertable
// against production no matter how the request is made. It IS present when the
// Worker is reached directly (`pnpm preview`), so the assertion runs off-edge only
// — which is why CI's build job smoke-tests a local preview. See checkCacheTag().
const ROUTE_CONTRACT = [
  { path: "/", directives: { "no-store": true }, cacheTag: null },
  { path: "/products", directives: { public: true, "max-age": "60", "stale-while-revalidate": "600" }, cacheTag: "products" },
  {
    path: "/catalog",
    directives: { public: true, "max-age": "45", "stale-while-revalidate": "300" },
    // Each X-Catalog-Market value gets its own cached variant.
    varyIncludes: "x-catalog-market",
    cacheTag: "products,catalog-market",
  },
];

// Set it and the run fails if no cache-tag assertion actually executed. Without
// this, a target that carries cf-ray but is not the production edge (wrangler dev
// --remote, a workers.dev URL, a version-preview URL, a tunnel) silently degrades
// to zero coverage — the same "green CI proves nothing" failure this check exists
// to remove.
const ASSERT_CACHE_TAG = /^(1|true)$/i.test((process.env.SMOKE_ASSERT_CACHE_TAG ?? "").trim());

const failures = [];
const notes = [];

let cacheTagAssertions = 0;
let cacheTagSkippedOnEdge = 0;

/**
 * Every Cloudflare-proxied response carries cf-ray, including Cloudflare's own
 * error pages; a direct hit on the Worker (`pnpm preview`) carries none. Needs no
 * extra request and does not depend on the hostname, so switching between
 * workers.dev and a custom domain cannot break the detection.
 */
function servedByEdge(response) {
  return response.headers.has("cf-ray");
}

function annotate(level, message) {
  // GitHub Actions workflow commands are single-line; %0A is the newline escape.
  const escaped = String(message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::${level}::${escaped}`);
}

/**
 * The single funnel for "the domain is not serving yet" — every skip in this
 * script goes through here, which is what makes SMOKE_REQUIRE_LIVE a one-line
 * switch rather than a flag threaded through each check.
 */
function skip(reason) {
  if (REQUIRE_LIVE) {
    annotate(
      "error",
      `${BASE_URL} did not respond, and SMOKE_REQUIRE_LIVE is set.\n${reason}\nThis domain is known to be live, so an unreachable host is an outage — not a provisioning window.`,
    );
    console.error(`\nSmoke test FAILED — ${BASE_URL} is unreachable.`);
    process.exit(1);
  }
  annotate("notice", `Smoke test skipped — ${BASE_URL} is not serving yet.\n${reason}\nThis is expected until the custom-domain route, DNS record, and edge TLS cert finish provisioning (and until the deploy token carries Zone · Workers Routes · Edit). Set SMOKE_REQUIRE_LIVE=1 once the domain is live to turn this into a failure.`);
  process.exit(0);
}

/**
 * Collect every `code` reachable from an Error, since fetch reports network
 * failures as a bare `TypeError: fetch failed` that hides the real reason.
 *
 * Both links must be followed. `cause` carries the wrapped error, but a host
 * that resolves to several addresses (any dual-stack A + AAAA name, including
 * localhost) fails as an AggregateError whose per-address errors live in
 * `errors` — walking only `cause` finds no code at all there, which previously
 * made a refused connection look like an unrecognised failure instead of the
 * "not wired up yet" case it is.
 *
 * Falls back to error names only when nothing carried a code (e.g. an
 * AbortSignal TimeoutError).
 */
function errorCodes(error) {
  const codes = [];
  const names = [];
  const seen = new Set();
  const queue = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (current.code) codes.push(String(current.code));
    if (current.name) names.push(String(current.name));

    if (current.cause) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }

  if (codes.length > 0) return [...new Set(codes)];
  return [...new Set(names)].filter((name) => name !== "Error" && name !== "TypeError" && name !== "AggregateError");
}

/**
 * Cert failures that can only mean an ALREADY-ISSUED cert stopped being
 * trustworthy. Cloudflare issues the edge cert as part of provisioning a custom
 * domain, so on the way up it is always freshly minted — it cannot be expired or
 * revoked. Seeing one of these therefore means an established domain broke,
 * which is a failure even with the skip path enabled.
 *
 * These need an explicit escape hatch because the broad TLS matching below would
 * otherwise swallow them: "CERT_HAS_EXPIRED".includes("CERT") is true.
 */
const BROKEN_CERT_CODES = new Set(["CERT_HAS_EXPIRED", "CERT_REVOKED"]);

/**
 * "Not wired up yet" vs "wired up but broken". Only the former may skip, so this
 * matches on transport-layer failures — no DNS record, no TLS cert, nothing
 * listening. Anything that completes an HTTPS exchange is judged on its merits.
 */
function isNotWiredUpYet(error) {
  const codes = errorCodes(error);
  if (codes.some((code) => BROKEN_CERT_CODES.has(code))) return false;
  return codes.some(
    (code) =>
      // DNS: the custom-domain record does not exist yet
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      // Nothing accepting connections / transient network
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "TimeoutError" ||
      code.startsWith("UND_ERR_") ||
      // TLS: Cloudflare has not issued the edge cert for this hostname yet
      code === "EPROTO" ||
      code.startsWith("ERR_TLS") ||
      code.startsWith("ERR_SSL") ||
      code.includes("CERT"),
  );
}

function get(path, headers = {}) {
  // Node validates the TLS chain and hostname by default, so a plain successful
  // https fetch IS the "valid TLS for this host" assertion — an invalid or
  // wrong-host cert throws instead of resolving.
  return fetch(`${BASE_URL}${path}`, {
    headers: { "user-agent": "zfb-example-workers-cache-smoke/1", ...headers },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** `public, max-age=60` -> { public: true, "max-age": "60" } */
function parseCacheControl(value) {
  const directives = {};
  for (const part of (value ?? "").split(",")) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq === -1) directives[token.toLowerCase()] = true;
    else directives[token.slice(0, eq).trim().toLowerCase()] = token.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return directives;
}

function check(condition, message) {
  if (condition) return true;
  failures.push(message);
  return false;
}

async function probeReachable() {
  let lastError;
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
    try {
      return await get("/");
    } catch (error) {
      lastError = error;
      // Only retry the transport failures we would skip on; a real HTTP response
      // never lands here, so retrying cannot mask a broken site.
      if (!isNotWiredUpYet(error)) throw error;
      if (attempt < PROBE_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));
    }
  }
  skip(`${errorCodes(lastError).join(" / ") || lastError?.message} after ${PROBE_ATTEMPTS} attempts.`);
}

/** `products, catalog-market` -> ["products", "catalog-market"] */
function parseTagList(value) {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Order- and whitespace-insensitive, and it names the offending tag rather than
 * dumping both strings — `products, catalog-market` must not read as a regression
 * against `products,catalog-market`.
 *
 * Off-edge only (see the ROUTE_CONTRACT note): on the edge the header is gone by
 * design, so asserting it there would fail on every correct deploy.
 */
function checkCacheTag(path, response, expected) {
  if (servedByEdge(response)) {
    if (expected !== null) cacheTagSkippedOnEdge += 1;
    return;
  }

  const raw = response.headers.get("cache-tag");

  if (expected === null) {
    check(!raw, `GET ${path} sent Cache-Tag "${raw}" but is uncacheable (no-store) and must carry none`);
    cacheTagAssertions += 1;
    return;
  }

  const want = parseTagList(expected);
  const got = parseTagList(raw);
  const missing = want.filter((tag) => !got.includes(tag));
  const unexpected = got.filter((tag) => !want.includes(tag));

  if (missing.length > 0 || unexpected.length > 0) {
    const detail = [
      missing.length > 0 ? `missing ${missing.map((t) => `"${t}"`).join(", ")}` : "",
      unexpected.length > 0 ? `unexpected ${unexpected.map((t) => `"${t}"`).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    check(false, `GET ${path} cache-tag ${detail} (got: ${raw ?? "(none)"}, want: ${expected})`);
  }

  cacheTagAssertions += 1;
}

function checkCacheContract(path, response, { directives, varyIncludes, cacheTag = null }) {
  const raw = response.headers.get("cache-control");
  const actual = parseCacheControl(raw);
  for (const [name, expected] of Object.entries(directives)) {
    check(
      actual[name] === expected,
      `GET ${path} cache-control missing "${name}${expected === true ? "" : `=${expected}`}" (got: ${raw})`,
    );
  }

  if (varyIncludes) {
    const vary = (response.headers.get("vary") ?? "").toLowerCase();
    // Substring, not equality — Cloudflare appends its own values (Accept-Encoding).
    check(vary.includes(varyIncludes), `GET ${path} vary did not include "${varyIncludes}" (got: ${response.headers.get("vary")})`);
  }

  checkCacheTag(path, response, cacheTag);

  const observedTag = servedByEdge(response) ? "" : `  cache-tag: ${response.headers.get("cache-tag") ?? "(none)"}`;
  console.log(`  GET ${path.padEnd(10)} ${response.status}  cache-control: ${raw}${varyIncludes ? `  vary: ${response.headers.get("vary")}` : ""}${observedTag}`);
}

/**
 * Reuses the probe's response — this is the request that proves the domain is
 * attached at all. Returns it so the caller can read transport-level facts off it
 * (whether the edge answered) without spending another request.
 */
async function checkRootPage(contract) {
  let response;
  try {
    response = await probeReachable();
  } catch (error) {
    // probeReachable() re-throws anything it would not skip on, i.e. a failure
    // that is not "the domain isn't wired up yet". That is a genuine failure.
    failures.push(`GET / failed with a non-transport error: ${errorCodes(error).join(" / ") || error.message}`);
    return null;
  }

  if (!check(response.status === 200, `GET / returned ${response.status}, expected 200`)) return response;

  const contentType = response.headers.get("content-type") ?? "";
  check(contentType.includes("text/html"), `GET / content-type was "${contentType}", expected text/html`);

  const body = await response.text();
  check(
    body.includes(CONTENT_MARKER),
    `GET / did not contain this site's content marker (${JSON.stringify(CONTENT_MARKER)}) — the domain resolves but is serving something else`,
  );

  checkCacheContract("/", response, contract);
  return response;
}

async function checkRoute(contract) {
  let response;
  try {
    response = await get(contract.path);
  } catch (error) {
    // The root probe already proved the host is reachable, so a transport error
    // here is a real defect — record it as a normal failure rather than letting
    // it unwind into main()'s catch-all and report as a crash.
    failures.push(`GET ${contract.path} failed: ${errorCodes(error).join(" / ") || error.message}`);
    return;
  }
  if (!check(response.status === 200, `GET ${contract.path} returned ${response.status}, expected 200`)) return;
  checkCacheContract(contract.path, response, contract);
}

/**
 * NON-FATAL. Edge cache state is not deterministic: the first request after a
 * deploy is always a MISS, CI is answered by whichever PoP is nearest the
 * runner, and a PoP that did not serve the priming request has its own cold
 * cache. Requiring a HIT here would make the deploy job flaky for reasons that
 * say nothing about whether the code is correct — so this observes and reports,
 * and the assertions above carry the actual pass/fail weight.
 *
 * SMOKE_REQUIRE_LIVE does NOT tighten this, deliberately. That flag answers "is
 * the domain up?", which is now a settled yes/no. Cache HIT/MISS answers "which
 * PoP took this request and how warm was it?", which stays genuinely
 * nondeterministic no matter how live the domain is. Making the flag also demand
 * a HIT would reintroduce exactly the flake this function exists to remove, so
 * the two concerns stay separate.
 */
async function observeCacheBehavior(rootResponse) {
  // Off-edge there is no Cache API at all (wrangler dev does not simulate it), so
  // this would spend four requests to conclude "no HIT" every single time — a
  // guaranteed-misleading notice on the local-preview run.
  if (!servedByEdge(rootResponse)) {
    notes.push("Cache HIT/MISS not observed — this target is not behind the Cloudflare edge, and wrangler does not simulate the Cache API. The header contract asserted above is what this run gates on.");
    return;
  }

  const statuses = [];
  const renderedAt = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    try {
      response = await get("/products");
    } catch (error) {
      // This whole function is an observation, so a blip here must never reach
      // main()'s catch-all — that would fail the job on exactly the kind of
      // nondeterminism this function exists to keep out of the pass/fail path.
      notes.push(`Cache observation stopped early: ${errorCodes(error).join(" / ") || error.message}. Not a failure — the assertions above already passed.`);
      break;
    }
    statuses.push(response.headers.get("cf-cache-status") ?? "(none)");
    const body = await response.text();
    const stamp = body.match(/<strong>(\d{4}-\d{2}-\d{2}T[\d:.]+Z)<\/strong>/);
    if (stamp) renderedAt.push(stamp[1]);
    if (statuses.at(-1) === "HIT") break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  if (statuses.length === 0) return;

  const sawHit = statuses.includes("HIT");
  const stableStamp = renderedAt.length > 1 && renderedAt.at(-1) === renderedAt[0];

  if (sawHit) {
    notes.push(`Cache HIT observed on /products (cf-cache-status: ${statuses.join(" -> ")}). Render timestamp ${stableStamp ? "stayed stable, confirming the response was reused" : "changed, so the HIT served a re-rendered entry"}.`);
  } else {
    notes.push(`No cache HIT observed on /products within ${statuses.length} requests (cf-cache-status: ${statuses.join(" -> ")}). Not a failure — a cold deploy misses, and CI's PoP varies. The cache-control contract asserted above is what gates this job.`);
  }
}

async function main() {
  console.log(`Smoke testing ${BASE_URL}\n`);

  const [rootContract, ...routeContracts] = ROUTE_CONTRACT;

  const rootResponse = await checkRootPage(rootContract);
  // The remaining checks only mean anything once we know the domain serves this
  // site at all — a wrong-site root makes every downstream failure noise.
  if (failures.length === 0) {
    for (const contract of routeContracts) await checkRoute(contract);
    if (rootResponse) await observeCacheBehavior(rootResponse);
  }

  // One aggregate note, not one per tagged route — on the edge every tagged route
  // skips, and three copies of the same explanation is noise.
  if (cacheTagSkippedOnEdge > 0) {
    notes.push(`Cache-Tag not asserted on ${cacheTagSkippedOnEdge} route(s): Cloudflare consumes Cache-Tag and strips it before the response reaches the client, so it cannot be checked against a live edge. CI's build job asserts it against a local preview instead — reproduce with: SMOKE_BASE_URL=http://localhost:4321 SMOKE_ASSERT_CACHE_TAG=1 pnpm smoke`);
  }

  if (ASSERT_CACHE_TAG && cacheTagAssertions === 0) {
    failures.push("SMOKE_ASSERT_CACHE_TAG is set but no cache-tag assertion ran — this target sits behind the Cloudflare edge, which strips the header. Point the smoke test at a local preview (SMOKE_BASE_URL=http://localhost:4321) or unset the flag.");
  }

  for (const note of notes) annotate("notice", note);

  if (failures.length > 0) {
    console.log("");
    for (const failure of failures) annotate("error", failure);
    console.error(`\nSmoke test FAILED — ${failures.length} check(s) did not pass.`);
    process.exit(1);
  }

  console.log(`\nSmoke test passed — ${BASE_URL} is live and serving the expected cache contract.`);
}

main().catch((error) => {
  annotate("error", `Smoke test crashed: ${error?.stack ?? error}`);
  process.exit(1);
});
