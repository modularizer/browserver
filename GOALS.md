# browserver Goals and Guardrails

This file exists to keep future contributors, agents, and implementations from “normalizing” `browserver` into a much more ordinary project.

`browserver` is an intentionally unusual product.

If you lose track of the constraints, it will very quickly drift into:

- a generic web IDE
- a pretty dashboard
- a hidden-backend app pretending to be client-side
- a bulky card-based UI
- a watered-down demo instead of a serious tool

Do not let that happen.

## Core Identity

`browserver` is:

- a browser IDE product
- a runtime dashboard
- a client playground
- a local-first project environment
- a host for real browser-run client-side servers

`browserver` is not:

- a normal SaaS app
- a backend-dependent web IDE
- a marketing site with a fancy demo
- a fake local app secretly powered by a hidden server

## Non-Negotiable Truths

### 1. The product is a static website — absolutely no backend

The product is a static site served by a static file server. There is no backend. There will never be a backend.

This is not a soft preference. It is an absolute, non-negotiable constraint.

There must be no:

- application server
- API backend
- cloud control plane
- remote database
- hidden runtime server
- server-side rendering host
- backend process of any kind beyond a static file server

No feature, no convenience, no simplification justifies adding a backend. If a feature cannot be built without a backend, that feature does not ship.

Optional browser-to-browser remote integrations (WebRTC, MQTT signaling, etc.) may exist, but these are peer protocols, not backend dependencies. The product itself must never require anything beyond static file hosting.

### 2. Hosted servers must really run in the browser

This is one of the main reasons the product exists.

Do not replace browser-hosted runtime behavior with:

- server-side execution
- hidden proxy execution
- remote fallback pretending to be local

If a preview or fallback mode ever exists, it must be labeled honestly.

### 3. The app is for other people’s servers, not just ours

`browserver` is a general website that other people should be able to use to host their own client-side servers.

So:

- user config must be browser-owned
- projects must be browser-owned
- workspaces must not depend on our repo layout
- storage must not assume our filesystem

### 4. Configuration is browser-owned and importable/exportable

The source of truth for user projects and settings should live in browser-native storage.

Preferred formats:

- JSON
- YAML

Preferred persistence:

- localStorage
- IndexedDB
- related browser-native storage

Do not assume repo-local config files as the primary model.

### 5. The UI must feel like an IDE, not a dashboard page

This is extremely important.

Lean toward:

- dense panel layouts
- split views
- tabs
- compact inline controls
- context menus
- toolbars
- inspectors
- status bars
- many simultaneous panels

Avoid:

- giant forms
- bulky nested cards
- long vertical marketing-style sections
- one-panel-at-a-time admin dashboards

We should also be explicit about tooling here:

- React + Vite is the app framework
- Monaco is the editor core
- Tailwind is the preferred styling system for the workbench shell and custom `browserver` layer
- React Native Web is not used — this is plain React DOM

### 6. Runtime observability is first-class

The server cannot feel invisible.

Users should be able to see:

- that it started
- that it restarted
- that requests are arriving
- which functions were called
- what logs were emitted
- what peers are connected
- what trust state applies

We need both:

- live reactive feedback
- historical local records

### 7. The product uses Monaco + a custom workbench shell

The IDE foundation is Monaco (browser-native editor) plus a custom workbench shell built in React.

Theia was considered but is not viable because it requires a backend process, which is absolutely prohibited.

The project direction is:

- use Monaco for all editor features (syntax, language services, IntelliSense, diffing)
- build a custom workbench shell in React + Tailwind for panel layout, tabs, command palette, keybindings, theming
- use Vite for the build, including single-file packaging via `vite-plugin-singlefile`

Do not:

- introduce Theia or any framework that assumes a backend
- introduce React Native Web or Expo (this is a plain React DOM app)
- over-engineer the workbench shell into a general-purpose IDE framework — scope it to browserver's actual needs

### 8. `plat` is the framework; `browserver` is the product

`plat` provides:

- runtime model
- client-side servers
- browser Python support
- client surfaces
- `css://`
- identity/trust foundations

`browserver` provides:

- IDE experience
- runtime dashboard
- client playground
- storage/versioning
- trust/session visibility
- data inspection

Do not reimplement **anything** `plat` already provides. This is one of the most critical rules in the entire project.

`plat` handles: transport (`css://`), server hosting, runtime lifecycle, client generation, OpenAPI, identity/trust foundations, Pyodide/Python management, peer communication (MQTT+STUN+WebRTC). All of this is `plat`'s domain.

If you find yourself writing code that does communication, transport, server hosting, client generation, runtime management, or peer signaling — **stop immediately**. You are reimplementing `plat`. Use `plat`'s APIs instead.

browserver's job is strictly: IDE chrome, UI panels, observability surfaces, workbench layout, project persistence, config management, and packaging. It **consumes** `plat`. It never reimplements it.

### 9. Client-side servers need real databases

Most real servers need a database. Browser-hosted servers are no different.

`browserver` must provide an in-browser, editable, tabular, SQL-like database experience for client-side servers — powered by `xpdb` or an `xpdb`-inspired approach. This is not optional or deferred. It is core to the product.

Without a real data layer, client-side servers are toys. With one, they are credible.

The database story covers three related but distinct needs:

- **app/workspace storage** — browserver's own project and config persistence
- **runtime/history storage** — logs, calls, build history
- **per-server app data** — each hosted server's own local database, with schema browsing, querying, and editing from the IDE

The IDE should include a database explorer panel where users can browse tables, inspect schemas, edit rows, and run queries — all in-browser, all local.

Additionally, client-side servers may talk to:

- real remote hosted databases (Supabase, PlanetScale, Neon, etc.)
- processes and databases on `localhost` (Postgres, Redis, dev APIs, etc.) — since the common dev workflow is a browser tab with localhost access

The IDE should support visibility into all of these connections as part of the runtime observability story. The client-side server is the one making the calls, so the dashboard should surface this activity. The key distinction: these are the *hosted server's* dependencies, not browserver's. browserver itself still has no backend.

### 10. Code written in browserver must feel native and be portable to real servers

Code authored inside the browserver IDE should look and feel like normal server code. It should not be littered with browser-specific workarounds, special imports, or browserver-flavored abstractions that only work in-browser.

A user should be able to:

- write a server in browserver
- copy that code out
- run it on a real server with minimal or no changes

This means:

- the programming model should mirror conventional server code (define methods, expose endpoints, handle requests)
- `plat` abstractions should be designed so the same code works both as a client-side server and as a traditional server-side server
- browser-specific runtime details (Pyodide bootstrapping, `css://` transport, in-browser DB) should be hidden behind abstractions, not leaked into user code
- import paths, API shapes, and patterns should be the same whether the server runs in a browser tab or on a VPS

If the code only works inside browserver, the product feels like a toy. If the code is portable, browserver becomes a serious development environment that happens to also run in the browser.

### 11. Future: peer distribution and load sharing

In the future, browserver should support a model where:

- one user writes and hosts a client-side server
- that server's code gets packaged up
- other users can discover it, download it to their own browser storage, and start hosting it themselves
- multiple browser instances hosting the same server can form a distribution network with load balancing across peers

This turns browserver from "one person hosting a server in their browser" into "a mesh of browsers collectively hosting the same service." The server code is portable between browser instances because it is just code — no backend, no special deployment, just peers sharing packaged server bundles.

This is not an immediate priority but it should inform architectural decisions now:

- server code and config must be fully self-contained and packageable
- the identity/trust model must support multiple hosts serving the same logical service
- the `css://` transport and peer discovery model should anticipate multi-host topologies
- the storage model must support importing packaged servers from other peers

### 12. The single-file packaged build matters

This is not just a novelty.

It is part of the proof story:

- the app can be static
- the runtime is truly local
- the environment is portable

Do not make architectural decisions that casually destroy the feasibility of a single-file output.

## Common Wrong Turns

These are the most likely mistakes.

### Wrong turn: “Let’s just add a backend”

This is the single fastest way to kill the project.

There is no backend. There will never be a backend. If a feature is easier with a backend, that does not make it acceptable. The feature must either work without a backend or not exist.

This includes “temporary” backends, “optional” backends, “just for development” backends, and “thin proxy” backends. None of these are allowed.

### Wrong turn: “Let’s simplify the UI with big cards and forms”

That may be easier in the short term, but it would destroy the intended IDE/workbench feel.

### Wrong turn: “The browser runtime is too weird, let’s hide it”

No.

The weirdness should be made legible, not hidden.

### Wrong turn: “We can rebuild the generic IDE bits ourselves”

That is exactly the trap we are trying to avoid.

### Wrong turn: “Let's implement our own communication / transport / runtime”

This is catastrophic. `plat` already does all of this: `css://` transport, MQTT+STUN+WebRTC peer communication, server hosting, runtime lifecycle, client generation, identity/trust, Pyodide management. Reimplementing any of it in browserver is an absolute failure. browserver consumes `plat`. Period.

### Wrong turn: “Config can just come from our project files”

No.

The product is for user-owned browser projects, not our repo.

### Wrong turn: “Live monitoring is enough; history can wait”

No.

Historical visibility is part of the tool’s value.

### Wrong turn: “We can fake part of the flow for now”

Only if it is labeled honestly and treated as temporary.

Do not present fake runtime behavior as real browser-hosted behavior.

## If You Are Unsure

Preserve these invariants:

- keep it static-only (no backend, ever)
- keep runtime real and browser-hosted
- keep config user-owned and browser-local
- keep the UI dense and IDE-like
- keep runtime behavior visible
- keep Monaco + custom workbench shell as the IDE foundation (React + Vite + Tailwind)
- keep `plat` as the underlying framework
- keep single-file export feasibility in mind

If a choice violates one of those, it is probably the wrong choice.

## Short Version

If you only remember one thing, remember this:

`browserver` is a real IDE for real browser-hosted servers, not a pretty fake demo wrapped around hidden backend behavior.
