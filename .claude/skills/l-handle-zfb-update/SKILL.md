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
| `defineConfig` schema | `zfb.config.ts` — framework / adapter settings |
| Cloudflare adapter + `ctx` (`ctx.cache.purge()`, `getCloudflareContext()`) | `pages/api/purge.tsx`, `lib/http.tsx` |
| SSR route contract (`export const prerender = false`) | `pages/products.tsx`, `pages/catalog.tsx`, `pages/api/purge.tsx` |
| Page components / data | `components/recipe-page.tsx`, `lib/product-data.ts` |
| CLI (`zfb dev/build/preview/check`) | `package.json` scripts, `wrangler.toml` |

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

**Watch this coupling:** the purge route uses a narrow local widening for
`ctx.cache` because `@takazudo/zfb-adapter-cloudflare` currently exposes a minimal
`ctx` type. If an upstream bump adds `ctx.cache` to the adapter's types, remove
that local widening (see `lib/http.tsx` / `pages/api/purge.tsx`).

## Step 5 — Verify

```bash
rm -rf ./dist ./.zfb ./.zfb-build
pnpm build       # pages build cleanly, adapter writes dist/_worker.js + dist/.assetsignore
pnpm typecheck   # zfb check passes
```

Local Wrangler dev does not simulate Workers Cache (no `Cf-Cache-Status`, repeated
requests re-render), so verify caching behavior on the deployed `*.workers.dev`
URL, per the README.

## Step 6 — Report

Summarize: versions traversed, notable upstream changes per release (one line
each), adaptations made (or "none needed"), and verification results.
