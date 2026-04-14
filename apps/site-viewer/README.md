# @browserver/site-viewer

Standalone, lightweight shell for viewing client-side-served (`css://`) sites
in the browser. **No dependency on the IDE (`@browserver/studio`).** No React,
no Monaco, no samples, no workspace logic.

## URL shape

```
http://host/<namespace>/<project>/<path...>
```

The first one or two path segments name the server; anything after is the
in-site path. The authority resolves the longest-matching registered prefix
so either layout works.

Subresource requests emitted by the hosted site flow through the service
worker at `/__css/<matchedServerName>/...` (unchanged from the studio
convention — same SW protocol, different host page).

## Design

1. Top-level page is the site viewer itself — **no iframe**.
2. The SW (`public/plat-service-worker.js`) intercepts `/__css/...` and
   subresource requests whose referrer is inside `/__css/...`.
3. This page stays alive as the PLAT_REQUEST transport host for its SW.
4. Root HTML is fetched via the authority-backed fetch connection and
   written into `document` with a `<base href="/__css/<name>/">` so relative
   URLs resolve through the SW.

## Run

```
npm install
npm run dev --workspace=@browserver/site-viewer   # :5174
```

Requires `apps/site-viewer/.env.local` with `VITE_AUTHORITY_URL=...`
(same value as `apps/studio/.env`). Visit
`http://localhost:5174/<namespace>/<project>/`.

## Architecture

No `/__css/` prefix, no iframe. Every URL is `/<ns>/<project>/<path>`.

- SW caches the shell on install. On top-level navigation to a site URL it
  serves the shell from cache (zero network to our server after first visit).
- The shell (`src/main.ts`) installs a `PLAT_REQUEST` bridge, ensures it is
  SW-controlled, then does `fetch(location.pathname)`. That fetch is
  intercepted by the SW, posted to the shell over `postMessage`, resolved
  through the WebRTC transport, and returned to the browser. The shell
  `document.write`s the response, which reparses and executes scripts.
- Subsequent subresource fetches (relative via document URL, or absolute
  with site-URL referrer) flow through the SW → bridge → transport.

## Status

Functional end-to-end. Remaining:

- [ ] Extract transport + authority into `packages/css-transport` so this
  app stops reaching into `apps/studio/src`.
- [x] Subresource response caching (stale-while-revalidate keyed by site URL,
  with `If-None-Match` revalidation against the plat-side ETag).
- [ ] In-site pushState handling.
- [ ] Nicer error UI and retry.
