# Cloudflare setup

An ordered walkthrough from zero to a deployed Worker. **This repo is not
deployed yet**: no Cloudflare secrets are set, and the `deploy` job in
`.github/workflows/deploy.yml` self-skips until `CLOUDFLARE_API_TOKEN` exists.
Nothing here has been done for you — start at step 1.

The README stays the reference for what the recipe does and how the routes
behave. This file is only the setup order.

## What gets deployed

Cloudflare **Workers** with static assets (`[assets]` in `wrangler.toml`) plus
the **Cache API** (`[cache] enabled = true`). There is **nothing to provision**
— no KV namespace, no D1 database, no bucket, no zone. The Cache API is a
runtime surface, not an account resource, so there is no dashboard object to
create and no "Cache" permission to grant. `wrangler.toml` is already complete
and holds no placeholder ids to fill in.

## 1. Create or reuse the API token

All nine `zfb-example-*` repos share **one** account-scoped token. If you have
already made it for another example, reuse it and skip to step 2 — see
[the family-wide guide](https://github.com/Takazudo/zfbex-tweaker/blob/main/docs/cloudflare-shared-token-and-env-setup.md)
for how that shared token is scoped and stored.

To make it: Cloudflare dashboard → My Profile → API Tokens → Create Custom
Token, with these permissions:

| Type | Resource | Level |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Account Settings | Read |

Set **Account Resources → Include → (your account)**. No Zone permissions are
needed — this repo deploys to a `*.workers.dev` host, not a custom domain. If
you are building the shared token, give it the union of every example repo's
permissions instead of only the two above.

Copy the token value when it is shown; Cloudflare will not display it again.

You also need your **account id**, visible in the dashboard URL
(`dash.cloudflare.com/<account-id>`) or via `pnpm exec wrangler whoami`.

## 2. Set the two GitHub Actions secrets

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo Takazudo/zfb-example-workers-cache
gh secret set CLOUDFLARE_ACCOUNT_ID --repo Takazudo/zfb-example-workers-cache
```

Each command prompts for the value. The equivalent UI path is **Settings →
Secrets and variables → Actions**. Confirm both landed:

```sh
gh secret list --repo Takazudo/zfb-example-workers-cache
```

These two are what the `deploy` job's preflight step looks for. Until
`CLOUDFLARE_API_TOKEN` is present the job skips with a notice instead of
failing.

## 3. Set the `PURGE_TOKEN` Worker secret (optional)

`PURGE_TOKEN` is a **Cloudflare-side Worker secret**, not a GitHub secret. It is
the shared secret that `POST /api/purge` compares against the `X-Purge-Token`
request header.

```sh
pnpm exec wrangler secret put PURGE_TOKEN
```

This requires the Worker to exist, so run it **after** the first deploy (step 4)
— or run it before and let step 4 pick it up on the next deploy either way.

Skipping it does not leave the purge route unguarded — it leaves it **disabled**.
With no `PURGE_TOKEN` set, `POST /api/purge` returns `503` with
`{"error":"missing_purge_token"}` and never calls `ctx.cache.purge()`. Every
other route is public and read-only, so the only thing you lose by skipping this
step is tag purging; cached entries then expire on their own `max-age`.

## 4. Trigger the first deploy

Push to `main` (or re-run the latest `Deploy` workflow run) once the secrets from
step 2 are in place:

```sh
git push origin main
gh run watch --repo Takazudo/zfb-example-workers-cache
```

The `build` job runs on every push and PR and needs no credentials. The `deploy`
job runs only on pushes to `main`, and now that the token exists its preflight
passes and it runs `pnpm exec wrangler deploy`.

The Worker lands at:

```
https://zfb-example-workers-cache.takazudo.workers.dev
```

`takazudo` is the account's workers.dev subdomain; substitute your own if you
deployed to a different account.

## 5. Verify

Use the checks from the README's "Verify on workers.dev" section against the
deployed URL — they only mean something on Cloudflare, since local Wrangler does
not simulate Workers Cache.

```sh
WORKER_URL="https://zfb-example-workers-cache.takazudo.workers.dev"

curl -si "$WORKER_URL/products" | grep -i "cf-cache-status\\|cache-control"
curl -si "$WORKER_URL/products" | grep -i "cf-cache-status\\|cache-control"
```

The first response should be `Cf-Cache-Status: MISS` and the second `HIT`, with
the render timestamp in the HTML unchanged on the hit.

Header variants — each `X-Catalog-Market` value gets its own cached entry
because `/catalog` sets `Vary: X-Catalog-Market`:

```sh
curl -si -H "X-Catalog-Market: jp" "$WORKER_URL/catalog" | grep -i "cf-cache-status\\|vary"
curl -si -H "X-Catalog-Market: jp" "$WORKER_URL/catalog" | grep -i "cf-cache-status\\|vary"
curl -si -H "X-Catalog-Market: eu" "$WORKER_URL/catalog" | grep -i "cf-cache-status\\|vary"
```

Purge, if you set `PURGE_TOKEN` in step 3:

```sh
curl -si -X POST \
  -H "X-Purge-Token: $PURGE_TOKEN" \
  "$WORKER_URL/api/purge"
```

A success returns `200` with `{"ok":true,"purged":{"tags":["products"]}}`, and
the next `/products` or `/catalog` request should miss and stamp a new render
time.

## Troubleshooting

**The deploy job was skipped.** Its preflight found no `CLOUDFLARE_API_TOKEN`
(step 2), or `wrangler.toml` contains a `REPLACE_WITH_*` placeholder. This repo
provisions nothing, so its `wrangler.toml` has no placeholder — in practice a
skip here always means the secret is missing. The run's notice annotation says
which condition tripped. Note the job also only runs on `push`, never on a pull
request.

**`POST /api/purge` returns 503.** `PURGE_TOKEN` is not set on the Worker. Run
step 3, then redeploy or wait for the next deploy.

**`POST /api/purge` returns 401.** The `X-Purge-Token` header does not match the
Worker secret. Re-set it with `wrangler secret put PURGE_TOKEN` and use the same
value in the request. A missing header is also a 401.

**`POST /api/purge` returns 501.** `ctx.cache` is unavailable in the runtime you
hit — you are on local Wrangler, not on Workers. Purge can only be verified
against the deployed Worker.

**`POST /api/purge` returns 405.** The route only accepts `POST`.

**Every request is a MISS.** Expected locally: `pnpm preview` runs the built
Worker through Wrangler, but local Wrangler dev does not simulate Workers Cache
— repeated requests re-render and `Cf-Cache-Status` is absent entirely. Verify
on workers.dev instead. On the deployed Worker, check that you are requesting a
cacheable route: only `/products` and `/catalog` send a `public` `Cache-Control`;
`/` and `/api/*` deliberately send `no-store`. On `/catalog`, remember each
distinct `X-Catalog-Market` value is a separate cache entry, so the first request
per market always misses.

**An editor flags the `[cache]` block in `wrangler.toml`.** Wrangler `4.85.0`
accepts it, but its `config-schema.json` omits the field, so schema-aware editors
warn about it. Leave it as is. The `2026-05-01` compatibility date is likewise
deliberate — see the README's "Step 0 caveats".
