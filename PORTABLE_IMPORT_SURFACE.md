# Portable Import Surface

This file is the contract between browserver samples and real-server code. Every bare specifier listed here resolves to something real when `npm install`'d on a Node/Bun/Deno server, **and** resolves to a browserver-supplied shim inside the in-browser IDE. Code that imports only from this surface is portable by construction.

## How to read this doc

- **Specifier** — what you type in your `import` statement.
- **Real package** — what Node resolves to after `npm install`.
- **Browserver shim** — the in-browser replacement that makes the specifier work without a real install.

If a specifier isn't on this list, it's either a workspace-relative import (fine — portable automatically) or a non-portable escape hatch. The Problems panel's portability lint flags escape hatches.

## Framework

| Specifier | Real package | Browserver shim |
| --- | --- | --- |
| `@modularizer/plat` | `@modularizer/plat` | aliased to `@modularizer/plat-client` in-browser |
| `@modularizer/plat/client-server` | `@modularizer/plat/client-server` | aliased to `@modularizer/plat-client/client-server` |
| `@modularizer/plat/client` | `@modularizer/plat/client` | aliased to `@modularizer/plat-client` |
| `@modularizer/plat/static` | `@modularizer/plat/static` | rewritten to the workspace's static-folder blob alias |
| `@modularizer/plat/python-browser` | `@modularizer/plat/python-browser` | native in-browser |

Rewriting happens inside `apps/studio/src/store/runtime.ts` (`normalizeLegacyPlatClientImports`) and `apps/studio/src/runtime/localTsRuntime.ts` (`rewriteStaticImports`). Both layers treat `@modularizer/plat/*` as the canonical form. `@modularizer/plat-client/*` still works for backward-compat but is flagged by the lint.

## Datastores

| Specifier | Real package | Browserver shim |
| --- | --- | --- |
| `redis` | `redis` (node-redis v4) | `apps/studio/src/runtime/fakeRedisShim.ts` — localStorage + BroadcastChannel backed, v4-compatible |

`fake-redis` is the shim's internal name; do not import it directly — it's flagged by the lint.

Planned: `pg` (postgres), backed by an `xpdb`-style in-browser SQL engine. Not shipped yet.

## Node-compatible builtins

Registered via `apps/studio/src/runtime/tsCompatShims.ts`. Each specifier is available with or without the `node:` prefix.

| Specifier | Shim behavior |
| --- | --- |
| `dotenv`, `dotenv/config` | Reads the workspace's `.env` files; exposes `process.env` |
| `process`, `node:process` | `process.env` / `process.cwd()` stubs |
| `path`, `node:path` | POSIX path utilities |
| `url`, `node:url` | `URL`, `URLSearchParams`, `fileURLToPath` |
| `buffer`, `node:buffer` | `Buffer` (Uint8Array-backed) |

## Workspace-relative

Relative imports (`./foo`, `../bar`, `./index.ts`) are always portable. Vite bundles them server-side; browserver serves them from the workspace VFS.

## Non-portable specifiers (flagged by lint)

The portability lint (code `9001`-`9003` in the Problems panel) fires on:

- `@modularizer/plat-client` / `@modularizer/plat-client/*` — suggest `@modularizer/plat[*]`
- `fake-redis` — suggest `redis`
- `plat/static` — suggest `@modularizer/plat/static`

These still work in-browser but will fail `npm install` on a real server. Fix them before copying code out.

## Adding to the surface

1. Add the shim under `apps/studio/src/runtime/` following the `fakeRedisShim` pattern.
2. Register it in `tsCompatShims.ts` so both ESM and CJS paths resolve.
3. Add a row to this file.
4. Update `apps/studio/src/runtime/portabilityLint.ts` if the new specifier has a non-portable alias that should be flagged.
5. Add or update a sample that exercises the new specifier end-to-end.

No speculative shims — add modules only when a sample needs them.
