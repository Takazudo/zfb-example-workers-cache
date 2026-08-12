# zfb Workers Cache example

An SSR recipe for Cloudflare Workers Cache with zfb. The pages return explicit
HTTP cache headers, tag cached responses with `Cache-Tag`, and expose a small
token-protected purge route.

## Local run

```sh
pnpm install
pnpm dev
pnpm build
pnpm preview
```

`pnpm dev` is useful for page-authoring feedback. `pnpm preview` runs the built
Worker through Wrangler, but current local Wrangler dev does not simulate
Workers Cache hits: repeated requests still re-render, and `Cf-Cache-Status` is
not present locally.

## Deploy

No Cloudflare storage resources are required. Set one Worker secret for the
purge endpoint:

```sh
pnpm exec wrangler secret put PURGE_TOKEN
pnpm build
pnpm exec wrangler deploy
```

`wrangler.toml` uses Workers Static Assets, and serves production on a custom
domain:

```toml
main = "./dist/_worker.js"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]

workers_dev = true
preview_urls = true

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "404-page"
run_worker_first = false

[cache]
enabled = true

[[routes]]
pattern = "zfb-example-workers-cache.takazudomodular.com"
custom_domain = true
```

Two ordering rules are load-bearing here:

- `workers_dev` and `preview_urls` **must stay above `[assets]` and `[cache]`**.
  In TOML any key after a table header belongs to that table, so a `workers_dev`
  written below either one is parsed as an assets field — Wrangler warns
  `Unexpected fields found in assets field` and silently ignores it.
- `preview_urls` defaults to *match* `workers_dev`, so it is set explicitly.
  Otherwise turning `workers_dev` off later would silently kill every per-deploy
  preview URL too.

The `2026-05-01` compatibility date is deliberate: Wrangler `4.85.0` accepts the
Workers Cache config, but its local runtime rejected newer compatibility dates
during verification.

### Why the custom domain matters for this example

`custom_domain = true` makes Cloudflare create and manage the DNS record and TLS
certificate for the hostname. It also places the Worker inside the
`takazudomodular.com` **zone**, which is the part that matters for a caching
demo: zone-scoped cache features — Cache Rules, Early Hints, tiered cache, and
the zone's own cache analytics and purge UI — apply to a custom domain's zone,
and a bare `*.workers.dev` host has no zone, so it gets none of them.

`workers_dev = true` is kept on deliberately, which makes the `*.workers.dev`
host a useful control: the same routes, the same `Cache-Control` headers, but
without a zone behind them.

## Routes

- `/products` sets
  `Cache-Control: public, max-age=60, stale-while-revalidate=600` and
  `Cache-Tag: products`.
- `/catalog` sets `Vary: X-Catalog-Market` and
  `Cache-Tag: products,catalog-market`, so each market header gets its own
  cached variant.
- `POST /api/purge` checks `X-Purge-Token`, calls
  `ctx.cache.purge({ tags: ["products"] })`, checks `result.success`, and
  returns JSON with `Cache-Control: no-store`.
- Non-cache dynamic responses in this example set `Cache-Control: no-store`.

## Verify a deploy

Production is <https://zfb-example-workers-cache.takazudomodular.com>. The same
build is also reachable on `https://zfb-example-workers-cache.<subdomain>.workers.dev`
— useful as the zoneless control described above.

After deploy, request a cached page twice:

```sh
WORKER_URL="https://zfb-example-workers-cache.takazudomodular.com"

curl -si "$WORKER_URL/products" | grep -i "cf-cache-status\\|cache-control"
curl -si "$WORKER_URL/products" | grep -i "cf-cache-status\\|cache-control"
```

The first response should be `Cf-Cache-Status: MISS`; the second should become
`HIT`. The render timestamp in the HTML should stay the same on a hit.

Verify header variants:

```sh
curl -si -H "X-Catalog-Market: jp" "$WORKER_URL/catalog" | grep -i "cf-cache-status\\|vary"
curl -si -H "X-Catalog-Market: jp" "$WORKER_URL/catalog" | grep -i "cf-cache-status\\|vary"
curl -si -H "X-Catalog-Market: eu" "$WORKER_URL/catalog" | grep -i "cf-cache-status\\|vary"
```

Purge all product-tagged entries:

```sh
curl -si -X POST \
  -H "X-Purge-Token: $PURGE_TOKEN" \
  "$WORKER_URL/api/purge"
```

The next `/products` or `/catalog` request should miss and stamp a new render
time.

## Next.js mapping

Think of `Cache-Control: public, max-age=60, stale-while-revalidate=600` as the
edge equivalent of a short ISR window. The route still renders on the first
request, then Cloudflare can serve the cached response without invoking the
Worker until it expires.

`Cache-Tag: products` plus `ctx.cache.purge({ tags: ["products"] })` maps to the
same operational idea as `revalidateTag("products")`: data changes call a purge
endpoint, and every cached response with that tag is invalidated.

The difference is that this recipe is explicit HTTP caching. There is no hidden
framework cache and no build-time pre-warming for Workers Cache; the first
request creates the entry.

## Step 0 caveats

- Official Workers Cache docs checked on 2026-07-10 list top-level
  `[cache] enabled = true`, `Cache-Control`, `Cache-Tag`, `Vary`,
  `ctx.cache.purge()`, and `Cf-Cache-Status` as the relevant surfaces.
- Wrangler `4.85.0` dry-run parsing accepts `[cache] enabled = true`; its
  `config-schema.json` omits the hidden `cache` field, so schema-aware editors
  may flag the block even though Wrangler accepts it.
- Per-entrypoint cache controls and `cross_version_cache` currently require
  Wrangler `>=4.107.0`, so this example does not use them.
- Latest Cloudflare Worker types include `ctx.cache`, but
  `@takazudo/zfb-adapter-cloudflare` currently exposes a minimal `ctx` type. The
  purge route uses a narrow local widening for `ctx.cache.purge()`.

## Continuous deployment (GitHub Actions)

For an ordered from-zero walkthrough of the steps below, see
[`docs/cloudflare-setup.md`](docs/cloudflare-setup.md).

This repo ships `.github/workflows/deploy.yml`:

- **build** runs on every push and PR — `pnpm install`, `pnpm typecheck`,
  `pnpm build`, then `pnpm smoke` against a local `pnpm preview` to assert the
  response-header contract. It needs no Cloudflare credentials, so CI is green
  immediately and forks get the same gate.
- **deploy** runs on push to `main` and calls `wrangler deploy`, publishing to
  <https://zfb-example-workers-cache.takazudomodular.com>. It self-skips until
  the secrets below are set, so a fresh repo never shows a red deploy.
- **smoke** runs right after a real deploy — `pnpm smoke`, which checks the live
  custom domain. See the next section.

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with Account · Workers Scripts: Edit **and** Zone · Workers Routes: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | target Cloudflare account id |

### The smoke test

`scripts/smoke.mjs` runs in two places, for two different reasons.

**After a deploy**, against the live custom domain: `wrangler deploy` succeeding
proves the Worker uploaded — it says nothing about whether the custom domain
resolves, whether its TLS certificate has been issued, or whether the site behind
it is the right one. This is the only check that confirms that.

**Before a deploy**, on every push and PR, against a local `pnpm preview`: this
gates the header contract without Cloudflare credentials, and it is the only run
that can assert `Cache-Tag` (see below).

It runs against any base URL:

```sh
pnpm smoke                                        # the production custom domain
SMOKE_BASE_URL=http://localhost:4321 pnpm smoke   # against `pnpm preview`
```

It has three outcomes:

- **skip** (green) — the hostname does not resolve, refuses connections, or has
  no valid certificate yet. Provisioning a new custom domain is asynchronous, so
  this is the expected state for the first deploy or two, and the repo never
  shows a red deploy before Cloudflare is wired up.
- **pass** — `/` returns 200 HTML containing this site's content marker, and
  `/`, `/products`, and `/catalog` each return the `Cache-Control` (and, for
  `/catalog`, the `Vary`) that the route sets in `pages/`.
- **fail** — the hostname resolves but serves the wrong thing, or a route's cache
  contract has drifted from its source.

#### `Cache-Tag` is asserted only off the edge

Cloudflare **consumes** `Cache-Tag`: it is a cache-control-plane header, stripped
before the response reaches the client. So `curl` against the live domain never
shows it, and no post-deploy check can assert it. It *is* present when the Worker
is reached directly, which is why CI asserts it from the `build` job's local
preview. Reproduce that run with:

```sh
pnpm build
pnpm preview                                          # in one shell
SMOKE_BASE_URL=http://localhost:4321 \
  SMOKE_ASSERT_CACHE_TAG=1 pnpm smoke                 # in another
```

`SMOKE_ASSERT_CACHE_TAG=1` fails the run if no `Cache-Tag` assertion executed —
without it, pointing the smoke test at any edge-fronted URL would silently
degrade to zero coverage for the one header this recipe is about. Against the
live domain the check is skipped with a notice, and the run still passes.

It deliberately asserts the **cache contract**, not a cache hit. A `HIT` is not
reproducible on demand: the first request after a deploy always misses, and CI
is answered by whichever edge PoP is closest to the runner, which may have its
own cold cache. Requiring a `HIT` would make the deploy job flaky for reasons
unrelated to correctness. The script still probes `/products` a few times and
reports the `Cf-Cache-Status` sequence it saw as a notice — observed, never
asserted.

`POST /api/purge` is never exercised by the smoke test. It mutates cache state
and is token-guarded; the smoke test issues read-only GETs.

`PURGE_TOKEN` is a Worker secret set with `wrangler secret put`, not a GitHub secret.

### Cloudflare API token permissions

The `CLOUDFLARE_API_TOKEN` repo secret is an **Account**-scoped custom token
(Cloudflare dashboard → My Profile → API Tokens → Create Custom Token) with
these permissions:

- **Workers Scripts** — Edit
- **Account Settings** — Read
- **Workers Routes** — Edit (Zone permission)

Set **Account Resources → Include → (your account)** and **Zone Resources →
Include → takazudomodular.com**.

The Zone permission is required because of the `[[routes]]` block: creating and
maintaining the `custom_domain` route is a zone-level operation. Without it,
`wrangler deploy` uploads the Worker and then fails on the route step with an
authentication error — the Worker is live on `*.workers.dev`, but the custom
domain is never attached.

A single token can be shared across all `zfb-example-*` repos if it carries the
union of every repo's permissions.
