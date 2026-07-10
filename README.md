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

`wrangler.toml` uses Workers Static Assets:

```toml
main = "./dist/_worker.js"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "404-page"

[cache]
enabled = true
```

The `2026-05-01` compatibility date is deliberate: Wrangler `4.85.0` accepts the
Workers Cache config, but its local runtime rejected newer compatibility dates
during verification.

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

## Verify on workers.dev

After deploy, request a cached page twice:

```sh
WORKER_URL="https://zfb-example-workers-cache.<subdomain>.workers.dev"

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

This repo ships `.github/workflows/deploy.yml`:

- **build** runs on every push and PR — `pnpm install`, `pnpm typecheck`,
  `pnpm build`. It needs no Cloudflare credentials, so CI is green immediately.
- **deploy** runs on push to `main` and calls `wrangler deploy`. It self-skips
  until the secrets below are set, so a fresh repo never shows a red deploy.

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with Account · Workers Scripts: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | target Cloudflare account id |

`PURGE_TOKEN` is a Worker secret set with `wrangler secret put`, not a GitHub secret.

### Cloudflare API token permissions

The `CLOUDFLARE_API_TOKEN` repo secret is an **Account**-scoped custom token
(Cloudflare dashboard → My Profile → API Tokens → Create Custom Token) with
these permissions:

- **Workers Scripts** — Edit
- **Account Settings** — Read

Set **Account Resources → Include → (your account)**. No Zone permissions are
needed — this repo deploys to a `*.workers.dev` host, not a custom domain. A
single token can be shared across all `zfb-example-*` repos if it carries the
union of every repo's permissions.
