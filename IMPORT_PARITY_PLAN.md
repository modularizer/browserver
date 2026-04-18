# Import Parity Plan

## Why this exists

browserver's "copy code out, run on a real server" promise (`GOALS.md` rule 10) only holds if user code doesn't betray its in-browser origin at the import level. Today samples import from `@modularizer/plat-client/*` — an import path that does not exist on a real server. The goal here is to make browser-authored code use **exactly the same bare specifiers** it would use server-side, and to push all browser-specific adaptation into shims/aliases that browserver installs at runtime.

This is the smallest, most tractable slice of the broader portability work (see `CODE_PORTABILITY_PLAN.md`). Everything else in that plan — sync, privacy tiers, site-viewer pluralism, authority HTTP gateway — is independent and can wait. Import parity is sharp enough to make progress on tomorrow and visible enough to be its own win.

## Current state

`apps/studio/src/runtime/tsCompatShims.ts` already rewrites bare specifiers to runtime shim modules via blob URLs. The rewriter covers both ESM and CommonJS paths. Specifiers currently aliased:

- `dotenv`, `dotenv/config`
- `process`, `node:process`
- `path`, `node:path`
- `url`, `node:url`
- `buffer`, `node:buffer`
- `redis`

The redis shim (`fakeRedisShim.ts`) is a node-redis v4-compatible client backed by `localStorage` and `BroadcastChannel`. It works today; it is simply not used by any sample.

Samples currently import from `@modularizer/plat-client/client-server`, `@modularizer/plat-client/static`, and `@modularizer/plat-client`. `plat-client` is the browser-flavored entry; `@modularizer/plat` is the framework-level package that a real server would depend on.

## What "parity" means precisely

For a given sample, a user should be able to:

1. Copy the server file(s) out of the workspace.
2. `npm install` only packages named in the imports (`@modularizer/plat`, `redis`, etc.).
3. Run the code under Node / Bun / Deno without editing a single import line.

The source file is the contract. Imports that resolve to real npm packages on a real server are allowed. Imports that only exist inside browserver are not.

## Principle

**The divergence between client-side and server-side lives in shims/aliases, not in user code.** browserver's runtime rewrites bare specifiers on the way to esbuild. On a real server, node resolves those same specifiers to real packages. The code is identical in both places.

browserver does the rewriting today. Eventually plat itself should ship conditional exports so the rewriting becomes unnecessary — but that is downstream work in plat, not a blocker here. Ship the rewriting now; delete it later if plat grows dual exports.

## Deliverables, smallest first

Each item is independently reviewable and independently shippable.

### 1. Use the existing redis shim in a sample

Pick `ts-hello` or add a `ts-counter` sample. Write the server as:

```ts
import { serveClientSideServer } from '@modularizer/plat-client/client-server'
import { createClient } from 'redis'

const redis = createClient()
await redis.connect()

class CounterApi {
  async increment() {
    return await redis.incr('count')
  }
}

export default serveClientSideServer('dmz/ts-counter', [CounterApi])
```

No new runtime code. Pure sample work. Validates the shim end-to-end.

### 2. Alias `@modularizer/plat` → `@modularizer/plat-client`

Add entries to `SHIM_SPECIFIERS` in `tsCompatShims.ts`. The target module re-exports everything plat-client exports today. Run `ts-hello` after flipping its imports:

```ts
import { serveClientSideServer } from '@modularizer/plat'
// was: '@modularizer/plat-client/client-server'
```

Subpaths to alias:

- `@modularizer/plat` → plat-client root
- `@modularizer/plat/client-server` → plat-client/client-server
- `@modularizer/plat/static` → plat-client/static
- `@modularizer/plat/authority` → plat-client/authority (if it exists)
- `@modularizer/plat-client` → same as `@modularizer/plat` (back-compat for existing samples)
- `@modularizer/plat-client/*` → same, back-compat

Exit criteria: `ts-hello/server.ts` reads as a normal plat server with no plat-client token anywhere in the source file.

### 3. Flip every sample to the parity imports

Mechanical pass over `apps/studio/src/samples/**`. Replace plat-client specifiers with plat specifiers. Verify each sample still runs. This is where issues will surface if the alias isn't complete.

### 4. Portable-import lint (Problems panel)

A workspace check that flags any import specifier outside the allowlist:

- real npm packages the user would `npm install` (curated list: `@modularizer/plat*`, `redis`, `react`, etc. — extensible per project)
- relative imports within the workspace
- shim'd node builtins (`node:*`, bare `path`, etc.)

Anything else — notably anything starting with `@modularizer/plat-client` once step 3 is done — is a warning: "This import won't resolve on a real server."

Implementation: a pass over workspace files after each edit; surface via the existing Problems panel.

### 5. Add shims only when a sample needs one

When a sample needs a new node module, add the shim in the same PR as the sample. No speculative shims. Candidate modules, in rough order of likelihood:

- `fs` / `node:fs` — read-only first, over `BrowserverFileSystem` (the VFS already sketched in `STATIC_FILES_PLAN.md`). Writes deferred until there's a concrete use case and a story for where the writes land.
- `crypto` / `node:crypto` — thin passthrough to Web Crypto. Probably easy.
- `events` / `node:events` — tiny `EventEmitter` shim.
- `stream` / `node:stream` — minimal `Readable` / `Writable` / `Transform`. Surface is wide; do only what samples actually touch.
- `os` / `node:os` — a handful of stubs (`platform()`, `cpus()`, etc.), enough to stop imports from throwing.
- `util` / `node:util` — `promisify`, `inspect`, etc.

Each shim follows the same recipe as `fakeRedisShim`: match the public API surface node-faithfully, store any state in `localStorage` / `IndexedDB` / `BroadcastChannel`, log activity via the existing `FakeRedisLogger` pattern so the build panel shows what's happening.

### 6. Postgres shim (the next real database)

After redis is proven in a sample, add a `pg`-compatible shim backed by `xpdb` or an `xpdb`-inspired approach. Same pattern: `pg.Client`, `Pool`, parameterized queries. Sample: a TODO app that uses the same SQL against both shim-in-browser and real Postgres server-side. Hardest shim so far — SQL dialect + transactions + prepared statements — but also the most valuable for making browser-hosted servers feel credible.

### 7. Portable import surface doc

Short markdown page in this repo enumerating which bare specifiers are supported. Becomes the contract samples are written against. Becomes the spec plat eventually delivers natively. Ships alongside step 2.

## Upstream work (don't block on it)

The ideal end state is plat's own `package.json` uses conditional exports:

```json
{
  "name": "@modularizer/plat",
  "exports": {
    ".": {
      "browser": "./dist/browser/index.js",
      "default": "./dist/node/index.js"
    },
    "./client-server": {
      "browser": "./dist/browser/client-server.js",
      "default": "./dist/node/client-server.js"
    }
  }
}
```

Vite / esbuild pick the browser variant under browserver. Node picks the default under a real server. When that lands, the `@modularizer/plat*` entries in `SHIM_SPECIFIERS` become dead weight and can be deleted.

**This is plat work, not browserver work.** Propose it upstream in parallel. Do not block the browserver side on it — the specifier rewriting is a perfectly fine interim state and possibly a permanent fallback for older plat versions.

## Hardest pieces

- **`fs` with write semantics.** Reads against the workspace VFS are easy. Writes are ambiguous: do they land back in workspace files (visible in the IDE, persisted), in a separate per-server storage area, or nowhere (in-memory only)? The right answer probably depends on what the server is trying to do. Defer by shipping read-only `fs` first; add writes only when a concrete sample demands them and the semantics are obvious.
- **`http` / `http.createServer` shim.** Tempting to bridge to css://, but the node http surface is huge and the semantics don't map cleanly. Likely not worth it — plat's own server abstraction is the right answer for "expose an HTTP-ish endpoint." Declare `http` out of scope.
- **Postgres shim surface area.** SQL dialect, transactions, prepared statements, connection pooling, `LISTEN`/`NOTIFY`. Each feature adds a chunk. Start with the subset one concrete sample needs and stop there.
- **CommonJS vs ESM edge cases.** Already handled by `tsCompatShims`, but every new shim has to register in both the ESM specifier map and the CJS module record. Easy to forget one. Consider a single registration helper that does both.
- **Dual-build conditional exports in plat.** Not hard per se, but cross-repo coordination and version bumps. Probably the single biggest unblock for the long term.

## What this explicitly does *not* cover

- Code sync between machines — `CODE_PORTABILITY_PLAN.md` Goal 1.
- Privacy tiers — same.
- Authority HTTP gateway — same, Goal 3.
- site-viewer host pluralism — same, Goal 4.
- Any persistence story beyond `localStorage` for shims — per-server database is `xpdb` / Goal 7 in `PLAN.md`, separate track.
- The "Run on real server" export button — useful eventually, but a user who follows import parity can already do this manually with a zip or plain copy-paste. Automate later.

## Suggested sequencing

1. **Day 1** — redis sample (step 1). Proves the existing infrastructure works in anger.
2. **Day 1-2** — `@modularizer/plat*` alias and flip `ts-hello` (step 2).
3. **Day 2-3** — flip remaining samples (step 3), fix whatever breaks.
4. **Day 3-4** — portable-import lint (step 4). First gate against future drift.
5. **Week 2** — portable import surface doc (step 7). As-needed shims (step 5) as samples demand them.
6. **Week 3+** — postgres shim (step 6) with a real sample using it.

## Success criteria

- Every sample's `server.ts` reads as normal plat server code with no `plat-client` token, no `fake-redis` token, no browser-specific shim name visible.
- The portable-import lint is green on every sample.
- At least one sample (e.g., `ts-counter` or a todo app) has been successfully copied out and run under node with nothing more than `npm install` + `node`.
- The portable import surface doc exists and is accurate.

Hitting those criteria means browserver has a credible, testable version of "code written here runs anywhere." Everything else in `CODE_PORTABILITY_PLAN.md` — sync, auth, transport pluralism — is built on that foundation.
