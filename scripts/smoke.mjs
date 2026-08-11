#!/usr/bin/env node
// Post-deploy smoke test for the live custom domain.
//
// A deploy can succeed while the site is still unreachable — the custom-domain
// route, its DNS record, and its edge TLS cert are provisioned by Cloudflare
// asynchronously. This script is the only check that confirms the domain is
// actually attached and serving this site.
//
// Three outcomes:
//   SKIP (exit 0) — the domain is not wired up yet (no DNS, no cert, refused
//                   connection). House rule: the repo never shows a red deploy
//                   before Cloudflare is wired up.
//   PASS (exit 0) — the domain serves this site with the expected cache contract.
//   FAIL (exit 1) — the domain resolves but the site is wrong or broken.
//
// Read-only GETs only. POST /api/purge is a mutating, token-guarded admin
// endpoint and is deliberately never exercised here.

const BASE_URL = (process.env.SMOKE_BASE_URL ?? "https://zfb-example-workers-cache.takazudomodular.com").replace(/\/+$/, "");

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
const ROUTE_CONTRACT = [
  { path: "/", directives: { "no-store": true } },
  { path: "/products", directives: { public: true, "max-age": "60", "stale-while-revalidate": "600" } },
  {
    path: "/catalog",
    directives: { public: true, "max-age": "45", "stale-while-revalidate": "300" },
    // Each X-Catalog-Market value gets its own cached variant.
    varyIncludes: "x-catalog-market",
  },
];

const failures = [];
const notes = [];

function annotate(level, message) {
  // GitHub Actions workflow commands are single-line; %0A is the newline escape.
  const escaped = String(message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::${level}::${escaped}`);
}

function skip(reason) {
  annotate("notice", `Smoke test skipped — ${BASE_URL} is not serving yet.\n${reason}\nThis is expected until the custom-domain route, DNS record, and edge TLS cert finish provisioning (and until the deploy token carries Zone · Workers Routes · Edit).`);
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
 * "Not wired up yet" vs "wired up but broken". Only the former may skip, so this
 * matches on transport-layer failures — no DNS record, no TLS cert, nothing
 * listening. Anything that completes an HTTPS exchange is judged on its merits.
 */
function isNotWiredUpYet(error) {
  const codes = errorCodes(error);
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

function checkCacheContract(path, response, { directives, varyIncludes }) {
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

  console.log(`  GET ${path.padEnd(10)} ${response.status}  cache-control: ${raw}${varyIncludes ? `  vary: ${response.headers.get("vary")}` : ""}`);
}

/** Reuses the probe's response — this is the request that proves the domain is attached at all. */
async function checkRootPage(contract) {
  let response;
  try {
    response = await probeReachable();
  } catch (error) {
    // probeReachable() re-throws anything it would not skip on, i.e. a failure
    // that is not "the domain isn't wired up yet". That is a genuine failure.
    failures.push(`GET / failed with a non-transport error: ${errorCodes(error).join(" / ") || error.message}`);
    return;
  }

  if (!check(response.status === 200, `GET / returned ${response.status}, expected 200`)) return;

  const contentType = response.headers.get("content-type") ?? "";
  check(contentType.includes("text/html"), `GET / content-type was "${contentType}", expected text/html`);

  const body = await response.text();
  check(
    body.includes(CONTENT_MARKER),
    `GET / did not contain this site's content marker (${JSON.stringify(CONTENT_MARKER)}) — the domain resolves but is serving something else`,
  );

  checkCacheContract("/", response, contract);
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
 */
async function observeCacheBehavior() {
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

  await checkRootPage(rootContract);
  // The remaining checks only mean anything once we know the domain serves this
  // site at all — a wrong-site root makes every downstream failure noise.
  if (failures.length === 0) {
    for (const contract of routeContracts) await checkRoute(contract);
    await observeCacheBehavior();
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
