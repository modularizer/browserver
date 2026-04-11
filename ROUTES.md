# browserver route model

This document defines URL routing for static hosting (including GitHub Pages base paths).

## Canonical routes

- IDE route: `/<project-name>/bs`
- Full-page browser preview route: `/<server-name>`

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

## Legacy compatibility

- Legacy preview route `/site/<server-name>` still maps to full-page preview.

## Soft project/server alignment

- Primary pane runtime now prefers server name == project id.
- If runtime resolves a different server name, `browserver` logs a non-blocking event in runtime logs.
- IDE route project selection is also soft: if route project does not exist locally, IDE still loads current workspace with a notice.

