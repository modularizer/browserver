# browserver route model

This document defines URL routing for static hosting (including GitHub Pages base paths).

## Canonical routes

- IDE route: `/<project-name>/bs`
- Full-page browser preview route: `/<server-name>`
- Full-page API explorer route for regular servers: `/http/<host-or-base>`, `/https/<host-or-base>`, `/h/<host-or-base>`

The bare app root `/` is never a long-lived IDE location. It immediately redirects to the canonical IDE route for the current project:

- `/` -> `/<project-name>/bs`

That redirect uses the browser's last active workspace only to choose the landing route. Once a page is already on `/<project-name>/bs`, that route becomes authoritative.

Examples (GitHub Pages under `/browserver`):

- `https://modularizer.github.io/browserver/ts-static-site/bs` -> IDE for project `ts-static-site`
- `https://modularizer.github.io/browserver/ts-static-site` -> full-page preview for server `ts-static-site`

## Base path support

Runtime route parsing strips `import.meta.env.BASE_URL` first, so these work equivalently:

- `/ts-static-site/bs` (local dev base `/`)
- `/browserver/ts-static-site/bs` (GitHub Pages base `/browserver/`)

## Server names with namespaces (`/`)

Server names may contain slashes (for example `bob/gametime`).

- Route form: `/bob/gametime`
- CSS connection form: `css://bob%2Fgametime`

`browserver` builds/parses CSS targets using shared helpers so namespaced server names remain compatible with `plat-client` transport.

## API docs route suffixes

These suffixes open fullscreen API explorer views instead of the browser preview:

- `/<server-name>/swagger`
- `/<server-name>/redoc`
- `/<server-name>/json`
- `/<server-name>/yaml`
- `/<server-name>/client`

The same suffixes also work for standard HTTP(S) targets:

- `/https/petstore.swagger.io/swagger`
- `/h/api.example.com/redoc`
- `/http/localhost:8000/json`

`/h/...` is an alias for `https://...`.

## Legacy compatibility

- Legacy preview route `/site/<server-name>` still maps to full-page preview.

## Soft project/server alignment

- Primary pane runtime now prefers server name == project id.
- If runtime resolves a different server name, `browserver` logs a non-blocking event in runtime logs.
- IDE route project selection is also soft: if route project does not exist locally, IDE still loads current workspace with a notice.

## Route ownership rules for IDE tabs

These are intentional and important:

- Loading `/<project-name>/bs` must load that exact project, not whichever project was most recently active in another tab.
- Switching projects inside the IDE updates the URL to the new canonical `/<project-name>/bs` route.
- Two tabs on two different project routes can be reloaded independently without taking over each other.

`browserver:active-workspace` is only used to decide where `/` should redirect. It does not override an explicit routed project page.



