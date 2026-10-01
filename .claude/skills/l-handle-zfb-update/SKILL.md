---
name: l-handle-zfb-update
description: >-
  Update the zfb upstream dependency (the @takazudo/zfb* packages) in this
  example (workers-cache) to the latest stable release, review what changed
  upstream between versions, and adapt this project's code if a change touches a
  surface it uses. Use when: (1) User says 'update zfb', 'bump zfb', 'zfb
  update', or 'handle zfb update', (2) A new zfb release is out and this
  example should track it.
user-invocable: true
argument-hint: "[target-version, e.g. 2.3.0 — omit to use latest stable]"
---

# Handle zfb Update — workers-cache

This is an SSR Workers Cache recipe: pages set explicit HTTP cache headers, tag
responses with `Cache-Tag`, and expose a token-protected purge route that calls
`ctx.cache.purge()`. It enables `[cache]` in `wrangler.toml` and uses a
`PURGE_TOKEN` secret.

Current floor: **zfb 3.0.0**. Pages are zudo-react JSX (`jsxImportSource:
"@takazudo/zfb/zudo-react"`, HTML attribute spellings) rendered by the named
`renderToString` from `@takazudo/zfb/zudo-react/server` in `lib/http.tsx`;
styling is one inline `<style rawHtml>`, and the config is `wind: false`. There
are no islands, no client JS, and no Preact or Tailwind anywhere.

Bump every `@takazudo/*` package this repo depends on to the latest stable
release (kept in lockstep on one version), review what changed upstream, and
adapt this project only where an upstream change touches a surface it actually
uses.

Upstream repo: `Takazudo/zudo-front-builder` (monorepo; npm packages live under
`packages/`). Every release has a `v<version>` tag and GitHub release notes.

## Step 0 — Preconditions

`package.json` and `pnpm-lock.yaml` must be clean (`git status --short` shows
neither). If either is dirty, stop and ask before touching them.

## Step 1 — Resolve current and target versions

```bash
CURRENT=$(node -p "require('./package.json').dependencies['@takazudo/zfb']")
TARGET=${1:-$(npm view @takazudo/zfb dist-tags.latest)}
```

- Always resolve the target from the `latest` dist-tag, never `next` — this repo
  tracks the zfb stable line. The `next` prerelease line ended at `1.1.0-next.1`,
  a prerelease of the already-released `1.1.0`; following it now would pin an
  abandoned channel behind stable.
- If `CURRENT` == `TARGET`: report "already at the latest stable (<version>)" and STOP.
- If an explicit target is older than `CURRENT`, that is a downgrade — stop and
  confirm first.

## Step 2 — Review upstream changes BEFORE bumping

Enumerate versions between CURRENT (exclusive) and TARGET (inclusive) in publish
order — never sort prerelease strings lexically (`next.9` vs `next.10`):

```bash
node -e '
const vs = JSON.parse(process.argv[1]);
const cur = vs.indexOf(process.argv[2]), tgt = vs.indexOf(process.argv[3]);
if (tgt < 0) { console.error("target not found"); process.exit(1); }
if (cur >= 0 && tgt <= cur) { console.error("not newer than current"); process.exit(1); }
console.log(vs.slice(cur + 1, tgt + 1).join("\n"));
' "$(npm view @takazudo/zfb versions --json)" "$CURRENT" "$TARGET"
```

Read the release notes for EVERY enumerated version:

```bash
gh release view "v<version>" --repo Takazudo/zudo-front-builder --json body -q '.body'
```

If a release has no notes, fall back to the commit list:

```bash
gh api "repos/Takazudo/zudo-front-builder/compare/v<prev>...v<version>" \
  --jq '.commits[].commit.message' | head -40
```

**Fail closed:** if the changes cannot be reviewed at all, stop and ask — never
bump blind.

Flag anything that touches a surface this example uses:

| Upstream surface | Where this project uses it |
| --- | --- |
| `defineConfig` schema | `zfb.config.ts` — `wind: false` + adapter |
| zudo-react JSX runtime + types (`Child`, `rawHtml`, attribute spellings) | `components/recipe-page.tsx`, `tsconfig.json` (`jsxImportSource`) |
| Server renderer (`@takazudo/zfb/zudo-react/server` `renderToString`) | `lib/http.tsx` — doctype prefix + headers are added here |
| Cloudflare adapter + `ctx` (`ctx.cache.purge()`, `getCloudflareContext()`) | `pages/api/purge.tsx`, `pages/catalog.tsx` |
| SSR route contract (`export const prerender = false`) | `pages/products.tsx`, `pages/catalog.tsx`, `pages/api/purge.tsx` |
| Page components / data | `components/recipe-page.tsx`, `lib/product-data.ts` |
| CLI (`zfb dev/build/preview/check`) | `package.json` scripts, `wrangler.toml` |

**Major version bump (e.g. 3.x → 4.x) = migration, not a two-line edit.** Read
the upstream migration guide for that major, audit every surface in the table,
and run the full parity verification in Step 5 (not just build + typecheck).

Rule: adapt only if this project actually uses the changed feature. Internal zfb
changes (Rust internals, docs, other frameworks) need no action — note and move on.

## Step 3 — Bump every @takazudo/* package (lockstep)

```bash
PKGS=$(TARGET="$TARGET" node -p "Object.keys(require('./package.json').dependencies).filter(n=>n.startsWith('@takazudo/')).map(n=>n+'@'+process.env.TARGET).join(' ')")
pnpm add -E $PKGS
```

- `-E` keeps the exact pin (no caret) — this repo tracks one known-good zfb version.
- All `@takazudo/*` packages must land on the SAME version.
- Commit `package.json` AND `pnpm-lock.yaml` together — CI installs with
  `pnpm install --frozen-lockfile` and fails on a stale lockfile.
- pnpm is the package manager; npm is only for reading registry metadata.

## Step 4 — Adapt project code (only if Step 2 flagged something)

Apply what the flagged notes require (config schema, renamed APIs, adapter or
`ctx` changes, island markup, etc.). Update `README.md` if commands or documented
behavior changed. If nothing was flagged, skip.

**Watch this coupling:** the purge route uses the adapter's second generic,
`getCloudflareContext<Env, CacheAwareExecutionContext>()`, with a local interface
extending `CloudflareExecutionContext` and optional `cache`. This replaces the
pre-3.1.0 cast (Takazudo/zudo-front-builder#3387). Keep the runtime `if (!cache)`
501 branch: the generic does not add or detect bindings, and local Wrangler has
no `ctx.cache`.

## Step 5 — Verify

```bash
rm -rf ./dist ./.zfb ./.zfb-build
pnpm typecheck   # zfb check passes — run first; its diagnostics beat build errors
pnpm build       # adapter writes dist/_worker.js + dist/_zfb_inner.mjs + dist/.assetsignore
```

Then assert the header contract against a **local** preview on an explicit free
port (never the default smoke target — that is the live domain):

```bash
P=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
pnpm exec zfb preview --port $P --host 127.0.0.1 &
SMOKE_BASE_URL=http://127.0.0.1:$P SMOKE_ASSERT_CACHE_TAG=1 SMOKE_REQUIRE_LIVE=1 pnpm smoke
# stop it by port: the wrangler/workerd children survive killing zfb alone
pkill -f "dev --port $P"; pkill -f "127.0.0.1:$P"
```

Require "Smoke test passed" — a skip is not a pass. For a **major** bump also:
serve the old version from a `git worktree` side by side and diff the status +
`cache-control` / `cache-tag` / `vary` headers and the parsed HTML of `/`,
`/products`, `/catalog` (with `X-Catalog-Market: jp|eu`), `/api/purge` and an
unknown path (normalize the render timestamp); screenshot both at 375 / 740 /
780 / 1280 px (the one breakpoint is `max-width: 760px`); exercise the purge
branches locally (GET 405, no token 503, wrong token 401, right token 501
because local has no `ctx.cache`) with a throwaway `.dev.vars` you delete
afterwards; and confirm `pnpm why preact` is empty. Never purge or smoke-test
production by hand.

Local Wrangler dev does not simulate Workers Cache (no `Cf-Cache-Status`, repeated
requests re-render), so verify caching behavior on the deployed `*.workers.dev`
URL, per the README.

## Step 6 — Report

Summarize: versions traversed, notable upstream changes per release (one line
each), adaptations made (or "none needed"), and verification results.
