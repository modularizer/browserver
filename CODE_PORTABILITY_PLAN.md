# Code Portability & Sync Plan

## Why this exists

The in-browser IDE will probably never beat VSCode / JetBrains for raw editor ergonomics. Accept that. Instead, make browserver *maximally interoperable* with the tools users already use:

- Let users move code **between machines** — client↔client, serverside↔clientside, IDE↔IDE — with the same trivial friction as a git push.
- Let users run **the same code** as a client-side (browser-hosted) server OR as a traditional server-side server, with the runtime differences handled by `plat`, not by the user.
- Let the existing peer/authority infrastructure **bridge to HTTP and WebSocket** so browserver projects plug into the ordinary web without pretending to.

All of this must hold browserver's absolute rule: **data transfer happens over plat static file servers (css://) only. No backend is added to browserver.** plat/authority is a plat component (a peer from browserver's perspective), not browserver's backend.

## The four goals

1. **Code sync & sharing** — private / semi-private / public projects, synced machine↔machine over css://.
2. **Client↔server runtime parity** — the same source package runs browser-hosted or server-hosted.
3. **plat/authority HTTP client support** — traditional HTTP clients can reach css:// servers via authority gateway.
4. **site-viewer host pluralism** — site-viewer can render sites served over css://, HTTP, and WS (honestly labeled).

These are related but separable. Each has its own exit criteria below.

---

## Goal 1 — Code sync & sharing over css://

### Mental model

A browserver **project** is already a set of files in a workspace. Publishing a project means packaging it as a plat static folder served over `css://<namespace>/<project>` (this is what `StaticFolder` + `serveClientSideServer` does today for runtime output — we extend it to *source* as well). Consuming a project from another machine is fetching from that css:// path into local workspace storage.

There is no "project registry". Discovery is by css:// name — the same addressability the rest of plat uses.

### Privacy tiers

Default is **private**.

| Tier          | Who can fetch                                                                 | Mechanism                                                                 |
|---------------|-------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| **private**   | Only clients signed into the same Google account (same `googleSub`)           | Authority gate — host checks requesting peer's id_token sub matches owner |
| **semi-private** | Anyone presenting a valid OTP / confirmation code                          | Pre-shared token embedded in trust handshake; single-use or scoped        |
| **public**    | Anyone                                                                        | `dmz/` namespace — no auth (existing plat behavior)                       |

Privacy is a property of the hosting side. The host decides who can fetch. The authority already carries the Google-sub identity (see `AUTHORITY_INTEGRATION_PLAN.md`); we extend its routing/trust rule from "namespace ownership" to include "owner-private project". For semi-private, the OTP is a pre-shared secret the peer presents in the css:// trust challenge; TOFU already has the hook for this.

### Sync model

Each project has two logical stores:

1. **Working tree** — the live, editable state in the active workspace (already exists: `@browserver/storage` IndexedDB).
2. **Sync snapshot** — a committed, addressable version served via css:// as a `StaticFolder`.

Syncing is not git, but it's git-shaped:

- **Push** = build a sync snapshot (archive of workspace files + metadata) into the local project's css:// static folder. The local host keeps serving it as long as the browser tab is open.
- **Pull** = fetch the sync snapshot from a peer's css:// static folder into local workspace storage.
- **Fetch** = same as pull but don't apply; show a diff.
- **Diff** = file-level diff using Monaco diff editor (already loaded in studio).

Conflict resolution is explicit and per-file: no auto-merge. When a pull would overwrite local unsaved changes, show the three-way view and make the user pick. This is consistent with browserver's existing history model (see `PLAN.md` §"Version History").

### The always-online problem

Plat static file servers only serve while the hosting browser tab is open. Three mitigations, in order of ambition:

1. **Self-host persistence** — users keep a tab open, or run the project on a real server via Goal 2 (same code, server-side). This is the honest baseline.
2. **Peer replicas** — the peer-distribution network in `GOALS.md` §11. Multiple peers host the same project with plat's existing peer model. Authority routes to whichever is online.
3. **Authority cache (optional, later)** — authority caches the last-pushed snapshot. This is the most controversial because it looks like storage-as-a-service. It is acceptable only if framed as: authority is already a plat peer, caching is bounded (small size cap, TTL), and browserver still works without it.

**Scope for this plan:** ship 1 and design for 2. Defer 3; flag it as a future decision.

### Deliverables

- `packages/sync` — new package. Push/pull/diff primitives over css:// to plat `StaticFolder`. Addressing = `css://<namespace>/<project>#<snapshotId>`.
- **Sync view** in the workbench — left sidebar section (next to Files) showing project remotes, last push/pull times, dirty state, privacy tier chip.
- **Privacy tier UI** — inline selector in the project header. Default `private`. Changing to `semi-private` surfaces OTP management (generate / revoke / copy).
- **Trust handshake extension** — authority checks sub-match for private, OTP-match for semi-private. Contributed upstream to `plat/authority`, not forked in browserver.
- **Snapshot format** — JSON manifest (file paths, language, content-hashes, metadata) + blob refs. Same shape as existing `WorkspaceSnapshot` so we're not inventing a new format.
- **Import/Export to zip** — fallback transfer path that is not peer-dependent. Works offline.

### Non-goals (this plan)

- No CRDT-style live collaborative editing. Single-writer semantics. (GOALS.md §"Non-goals": collaborative undo is deferred.)
- No generic "project registry" or search UI. Discovery is by css:// name only.
- No authority-side persistent storage (flagged for later; see above).

---

## Goal 2 — Client↔Server runtime parity

### Mental model

A user should be able to:

- open browserver, write a server, run it browser-hosted;
- `npm install` the same package on a VPS and run it with Node / Bun / Deno as a real server;
- in either direction.

Today most of this already works via `plat`/`plat-client`. The gaps are the shims in `apps/studio/src/runtime/tsCompatShims.ts` and `fakeRedisShim.ts` — places where browser-hosted code diverges from server-hosted code.

### Principle

**The divergence lives in `plat`, not in user code, and not in browserver.** When user code does `import { X } from 'plat'`, plat decides at import time (or via a build transform) what `X` resolves to:

- client-side build → browser-compat version (uses IndexedDB, Web Workers, etc.)
- server-side build → native version (uses Redis, Postgres, real fs, etc.)

User code is identical. Browserver's job is to (a) not leak browser-isms into user code, and (b) surface clearly in the IDE which mode is active.

### Deliverables

- **Audit existing shims** in `apps/studio/src/runtime/*Shims.ts`. Anything user code can touch should move upstream to `plat` and become a proper dual-build export. Browserver-only shims are OK if they're for plat's internals, not user code.
- **Dual-target project template** — a sample workspace with a single `server.ts` plus a `browserver.yaml` declaring it as runnable both client-side and server-side. Build and run buttons for both modes.
- **"Run on real server" workflow** — button in the IDE that produces a zip/tar of the server code suitable for `npm install && npm start` on a real box. Includes a generated `package.json` + `README` with run instructions. No backend — it's just `Blob` download.
- **"Import from real server" workflow** — inverse. Drop a zip of a plat server project onto the IDE; the workspace hydrates.
- **Portability lint** — a build-time check that flags user code doing things that won't port (e.g., touching `window`, `indexedDB` directly instead of via a plat abstraction). Surface in the existing Problems panel.

### Non-goals

- No attempt to make non-plat server frameworks (Express, Fastify, FastAPI) run in the browser. Portability is framed around plat; other frameworks are out of scope.
- No full server-side runtime *inside* browserver. The user runs the server-side variant on their own machine.

---

## Goal 3 — plat/authority HTTP client support

### Context

Today, reaching a css:// server requires a plat-aware client: the browserver studio, site-viewer, or a plat-client SDK. A curl user or a traditional HTTP service cannot call a css:// server directly.

### What "HTTP client support" means

`plat/authority` gains an HTTP gateway: for a css:// server it knows about, it accepts an HTTP request, proxies it via the WebRTC mesh to the host peer, and returns the response.

```
curl https://authority.example.com/<namespace>/<project>/some/path
  → authority routes request to the live host of css://<namespace>/<project>
  → host peer executes, returns response
  → authority returns HTTP response to curl
```

This is plat-side work, not browserver-side. Browserver benefits: any code written inside browserver becomes reachable from the ordinary web without porting.

### Browserver's role

- **Docs & discoverability** — the project header shows both the css:// URL and the authority HTTP URL. Copy buttons for each.
- **Connection debugging panel** — show which peers are currently hosting this project, which clients are connected, whether they came via css:// or via authority-HTTP. This is an observability extension, not new transport code.
- **Authorization surface** — when a private project is reached via HTTP, the authority needs a way to check auth. browserver's Namespace dashboard is where users manage API tokens / allowed origins for the HTTP gateway. (Tokens live in authority; browserver only provides the UI.)

### Deliverables

- Upstream proposal to `plat/authority` for the HTTP gateway. Spec'd in this plan at the "what it must expose" level; implementation lives in plat.
- Browserver UI: project URL card, peer/connection inspector, HTTP token management.
- Sample: a workspace demonstrating a TS server being called from `curl` against the authority HTTP gateway.

### Non-goals

- No HTTP server written inside browserver. The gateway is authority's; browserver is client-side.
- No transport code in browserver. See `GOALS.md` rule 8.

---

## Goal 4 — site-viewer host pluralism

### Context

`apps/site-viewer` today bridges browser subresource requests to css:// only (service worker → WebRTC → peer). This is already valuable — it lets a css://-hosted site render as a normal web page.

Make site-viewer able to render sites hosted behind:

- **css://** (today)
- **HTTP** (a traditional static file server)
- **WS** (a WebSocket-based host — useful for dev servers, live-reloading backends, plat servers not going through authority)

### Why

- Compatibility: a browserver project might live at any of the three depending on dev stage or environment.
- Honest labeling: when the site is being served from a non-browser host, the viewer should say so. A small indicator in the tab / corner, consistent with `GOALS.md` "do not fake browser-hosted behavior".
- Dogfooding: if browserver itself gets previewed through site-viewer-style tooling, pluralism means dev-time HTTP origin works too.

### Design

site-viewer's transport bridge (`apps/site-viewer/src/main.ts`) already has a clean shape: service worker posts a `PLAT_REQUEST`, bridge returns `PLAT_RESPONSE`. The bridge today always goes to css://. Extend it to pick a backend based on the target's scheme:

```
css://<host>/... → existing path (cssTransport.ts)
http(s)://<host>/... → plain fetch (browser does this natively for same-origin assets; bridge proxies cross-origin)
ws(s)://<host>/... → open a WS, request/response framed over a simple protocol
```

The target scheme is encoded in the site-viewer URL. Today that is implicit (the hostname under the viewer origin maps to `css://<path>`). Extend the URL model:

```
/<scheme>/<host>/<path>    e.g.  /css/myns/myapp/     (default, current)
                                 /http/example.com/path
                                 /ws/myns/myapp/
```

Backward compatibility: if scheme is missing, default to `css`. Existing URLs keep working.

### Deliverables

- **Transport dispatcher** in site-viewer — pick the right bridge per request based on parsed target.
- **URL parser/builder updates** in `apps/studio/src/runtime/siteViewerUrl.ts` — round-trip the scheme.
- **Host indicator** — small badge in the viewer chrome (not inside the rendered page, so honestly out-of-band).
- **WS framing** — define the simple request/response framing (reuse whatever `plat` already uses for its WS transport if available; don't invent).
- **HTTP mode** — mostly a thin pass-through. Security: same-origin defaults, explicit CORS opt-in; only allow trusted origins per project config.

### Non-goals

- No attempt to make site-viewer into a general reverse proxy. It's a viewer, not a gateway.
- No browserver-side WS server implementation. WS hosts are external.

---

## Cross-cutting concerns

### Identity

All four goals reuse the existing Google OAuth identity model (see `AUTHORITY_INTEGRATION_PLAN.md`). No new auth system.

- Goal 1 "private" tier: `googleSub` match in authority.
- Goal 1 "semi-private" tier: OTP via existing TOFU/known-host channel.
- Goal 3 HTTP tokens: managed in Namespace dashboard, validated by authority.

### Observability

Each goal plugs into the existing dashboard surfaces:

- Sync activity → Logs / Calls panels.
- Dual-mode runs → Runtime panel shows mode chip (client-side vs server-side).
- HTTP gateway traffic → peer/connection inspector.
- Site-viewer host type → badge in viewer + peer inspector in studio.

This is `GOALS.md` rule 6 (runtime observability is first-class) applied consistently.

### Static-site invariant

None of this adds a backend to browserver. The plat-side additions (authority HTTP gateway, etc.) are plat components — plat is a peer, not browserver's backend. Verify at each step:

- Does this require a process running anywhere browserver controls? → violation.
- Does this require more than static file hosting for browserver itself? → violation.
- Does this require plat/authority to grow? → acceptable (contribute upstream).

### Packaging

All deliverables must preserve single-file build feasibility. Sync and portability code is just more TS — no new non-bundleable dependencies.

---

## Phased roadmap

### Phase A — Dual-mode samples & portability lint (Goal 2 core)

Quickest win, lowest risk. Prove the "same code, both runtimes" story with a sample workspace and the export-to-server workflow. Surface portability problems early.

### Phase B — Sync primitives (Goal 1 MVP)

Push / pull / diff over css:// to `StaticFolder`. Public tier only. Snapshot format defined.

### Phase C — Private & semi-private tiers (Goal 1 complete)

Extend authority trust handshake for sub-match and OTP. UI surfaces. This depends on `AUTHORITY_INTEGRATION_PLAN.md` having landed.

### Phase D — site-viewer host pluralism (Goal 4)

URL scheme extension + HTTP mode first (trivial), WS mode second.

### Phase E — authority HTTP gateway (Goal 3)

The biggest plat-side change. Browserver's side is UI and docs; the hard work lives upstream in plat. Timed so it lands after Phase C so HTTP auth has a place to hook.

### Phase F — Peer replicas (Goal 1 durability)

The "more than one browser tab hosting this project" story. Pulls from `GOALS.md` §11 (peer distribution network).

---

## Open questions

1. **Snapshot immutability.** Does each push create a new immutable snapshot (content-addressed, git-like), or does it overwrite? Immutable is more honest for sharing but eats more storage. Suggest: immutable with GC / user-driven pruning, like the existing history model.
2. **OTP scope.** Per-project, per-fetch, or per-peer? A per-peer OTP that, once accepted, is remembered (TOFU) feels right and matches `plat`'s known-host model.
3. **Authority HTTP gateway auth.** Bearer tokens? mTLS-ish with signed Google id_tokens? Needs a plat-side decision before Phase E.
4. **site-viewer trust model for HTTP mode.** Any URL, or allow-listed origins per project? Starting with allow-listed is safer.
5. **Authority cache (at-rest persistence).** Do we ever ship it? Defer the decision until Phase F tells us whether peer replicas are enough.

---

## Summary

The through-line is: **make browserver code indistinguishable from normal code** — portable between machines, portable between runtimes, reachable from ordinary web clients, viewable over any common host transport. The IDE experience can be "worse than VSCode" and the product still wins if the code you write inside it is not a prisoner of the browser.

None of this adds a backend to browserver. All heavy lifting that can't live in the browser (authority HTTP gateway, peer replication coordination) lives in plat, which browserver consumes.
