# browserver

`browserver` is a fully static in-browser IDE and dashboard for spinning up, hosting, inspecting, and sharing client-side servers.

The core pitch is simple:

- open a website
- write a server
- launch it in the browser
- watch calls come in live
- inspect logs, state, and local data
- test the client surface from the same app

The deeper goal is more ambitious:

- make browser-hosted servers feel real, inspectable, and trustworthy
- prove that a serious local-first dev experience can exist on a static site
- make `plat`-style client-side servers feel like a first-class development target
- make the runtime visible enough that people trust it is actually running in the browser

Eventually, `browserver` should be able to produce a fully packaged single HTML artifact that contains everything needed to run the IDE and the hosted server experience. That matters because the single-file build is part of the proof: there is nowhere else for the server to be hiding.

## What Browserver Is

`browserver` is meant to be:

- an IDE for writing browser-hosted servers
- a runtime dashboard for watching those servers behave live
- a client playground for testing generated and dynamic clients
- a local-first project environment using browser storage
- a database-aware server workbench
- a trust-and-identity aware host for `css://` servers

It is not meant to be:

- a remote cloud IDE
- a server-rendered control panel
- a fake frontend pretending to call a browser server while really calling a hidden backend

## Why This Exists

There is now enough prior work to make this credible:

- [`plat`](https://github.com/modularizer/plat)
  - gives us the core model: write methods, generate interfaces, expose APIs, build clients, and run browser-hosted servers
- [`rtchat`](https://github.com/modularizer/rtchat)
  - proved real MQTT-signaled WebRTC browser peer communication and identity concepts
- [`pyprez`](https://github.com/modularizer/pyprez)
  - proved the browser can host serious editable Python runtime experiences without leaking implementation details into user code
- [`xpdb`](https://github.com/modularizer/xpdb)
  - points toward a usable local database story for browser-hosted servers and for the IDE itself
- [`gameboard`](https://github.com/modularizer/gameboard)
  - represents the kind of browser-native interactive runtime/dashboard thinking that helps here even when the specific domain is different

`browserver` is not replacing those projects. It is the place where their lessons become one coherent developer experience.

## Prior Work We Will Rely On

### plat

[`plat`](https://github.com/modularizer/plat) is the most important dependency conceptually and technically.

We will rely on it for:

- client-side server hosting
- `css://` transport support
- generated and dynamic client surfaces
- OpenAPI-driven client tooling
- browser Python support via `plat_browser`
- identity / known-host / authority foundations

`browserver` should feel like the best possible way to experience `plat` in the browser.

### rtchat

[`rtchat`](https://github.com/modularizer/rtchat) matters because it already explored:

- MQTT signaling
- WebRTC peer relationships
- trust and host identity ideas
- browser-to-browser communication patterns

We should reuse the transport lessons and the identity/trust philosophy, even if the final abstractions in `browserver` are cleaner.

### pyprez

[`pyprez`](https://github.com/modularizer/pyprez) matters because it proved:

- editable in-browser Python experiences are viable
- hidden browser-Python runtime bootstrapping is possible
- import detection and package-install ergonomics matter
- “do not expose the runtime internals to the user” is the right product instinct

For `browserver`, Python support should feel natural, not like “special Pyodide mode.” `browserver` relies on `plat_browser` for Python runtime support — it does not interact with Pyodide directly. `plat_browser` handles Pyodide bootstrapping, import detection, and automatic package installation under the hood.

### xpdb

[`xpdb`](https://github.com/modularizer/xpdb) is especially promising for the data story.

There are really two database needs here:

1. `browserver`’s own local project state
2. the hosted server’s own local database

`xpdb` may be useful for both, but especially for the second.

That opens up powerful possibilities:

- each client-side server can have a real local database
- the IDE can include schema browsing and query inspection
- the hosted server’s local persistence stops being a pile of `localStorage` blobs
- we can expose the server’s data layer as part of the runtime dashboard

### gameboard

[`gameboard`](https://github.com/modularizer/gameboard) is relevant less for a direct code dependency and more for product sensibility:

- live interactivity
- browser-native statefulness
- visible runtime feedback
- treating the browser as a serious application host

`browserver` needs that same confidence.

## Product Direction

At a high level, the app should feel like:

- editor
- debugger
- dashboard
- client playground
- data inspector
- trust/identity console
- local project environment

all fused into one coherent product.

The ideal mental model:

- the left side is where you define the server
- the right side is where you watch it live
- the bottom or side panels let you call it, inspect it, and reason about it
- the storage/versioning system makes it feel safe and recoverable

## Core Features

### 1. Server IDE

The server IDE should support:

- TypeScript server authoring
- Python server authoring
- saved local projects
- versions / snapshots / checkpoints
- quick samples and templates
- inline syntax-aware editing
- visible launch / restart / stop controls

Eventually it should also support:

- richer code intelligence
- server-side-derived docs panels
- schema-derived client forms

### 2. Live Runtime Dashboard

The runtime dashboard should make the server feel alive.

That means:

- connection state
- live log tailing
- function call counters
- handler highlighting as calls arrive
- event stream visualization
- current peer/session list
- current known-host / trust state
- performance-ish telemetry for browser-hosted runtime work

This is one of the most important parts of the product. If the runtime is invisible, the experience feels fake.

### 3. Client Playground

The client playground should support:

- generated and dynamic TypeScript client examples
- generated and dynamic Python client examples
- quick one-line calls
- schema-driven request forms
- exact source snippets users can copy into real code
- peer chat / peer messaging once shared sessions are mature

The point is not just “try the endpoint.” The point is to teach the client surface while also proving it works.

### 4. Database Story

Most real servers need a database. Browser-hosted servers are no different.

`browserver` will provide an in-browser, editable, tabular, SQL-like database for each hosted server — powered by `xpdb` or an `xpdb`-inspired approach. This is core to the product, not optional.

The database layer covers:

- browser-local persistence for the IDE itself (projects, config, versions)
- per-server in-browser databases with schema browsing, row editing, and query execution
- a database explorer panel in the IDE workbench
- observability for remote database connections (when a hosted server talks to Supabase, PlanetScale, Neon, etc.)

Additionally, client-side servers may talk to:

- real remote hosted databases (Supabase, PlanetScale, Neon, etc.)
- processes and databases on `localhost` (Postgres, Redis, dev APIs, etc.) — since the common dev workflow is a browser tab with localhost access

The IDE should surface this activity in the runtime dashboard — the client-side server is making the calls, so they should be visible. The key distinction: these are the *hosted server's* dependencies, not browserver's. browserver itself has no backend.

### 5. Packaging / Export

The build story should support at least two outputs:

- a normal static site build
- a single-file fully packaged HTML build

The single-file build is strategically important.

It helps prove:

- the runtime is truly client-side
- the app is not quietly calling a hidden server
- the entire dev experience can be archived, shared, and opened offline-ish

### 6. Identity / Trust

Because `css://` servers are peer-shaped rather than normal HTTP servers, trust matters.

`browserver` should eventually expose:

- persistent local host identity
- known-host records
- trust-on-first-use behavior
- optional authority server resolution
- visible trust state in the UI

The trust story should be understandable, not buried.

## Monorepo Shape

- `apps/studio`
  - the main browserver app product (Monaco + custom workbench shell)
- `packages/core`
  - product domain models and shared browserver concepts
- `packages/workbench`
  - the custom workbench shell: panel layout, tabs, command palette, keybindings, theming
- `packages/runtime`
  - runtime launchers and browser-hosted-server orchestration
- `packages/storage`
  - local-first persistence, versions, trust records
- `packages/playground`
  - client playground integration
- `packages/export`
  - static and single-file packaging logic
- `packages/database`
  - in-browser SQL-like database layer (`xpdb` or `xpdb`-inspired), database explorer panel

Tech stack:

- **React + Vite** — app framework, static build, single-file build via `vite-plugin-singlefile`
- **Monaco** — editor core (handles its own editor chrome)
- **Tailwind** — styling for the workbench shell and all custom browserver surfaces
- **TypeScript** — primary language
- React Native Web is **not** used — this is plain React DOM

The goal is a dense, concise, IDE-like UI — not bulky dashboard cards.

## Static-Only Constraint — No Backend, Ever

`browserver` is a static site. There is no backend. There will never be a backend. This is an absolute, non-negotiable constraint with zero room for exceptions.

The only server involved is a static file server that serves the built assets. Nothing else runs on the server side.

That means:

- the product is served as static files — no application server, no API backend, no server-side process of any kind
- hosted servers run in the browser
- storage is browser-native (localStorage, IndexedDB)
- trust state is browser-local or fetched via browser-to-browser peer protocols
- no "temporary" or "optional" or "development-only" backends

Optional browser-to-browser integrations (WebRTC, MQTT signaling) may exist. These are peer protocols, not backend dependencies.

## Development Principles

### The browser runtime must be visible

The app should never feel like smoke and mirrors.

People should be able to see:

- when the server starts
- when requests arrive
- when a function ran
- where logs came from
- how the client connected

### The app must stay local-first

Projects, versions, and local data should survive reloads and support recovery.

### The app should teach, not just run

The IDE should be a serious tool, but it should also teach:

- what code shape works
- what the generated client looks like
- what the trust model is
- how browser-hosted servers differ from traditional servers

### Code written in browserver must be portable

Server code authored in the IDE should look and feel like normal server code. A user should be able to copy their code out and deploy it on a real server with minimal or no changes. Browser-specific runtime details (Pyodide, `css://` transport, in-browser DB) are hidden behind `plat` abstractions, not leaked into user code. Import paths, API shapes, and patterns should be the same whether the server runs in a browser tab or on a VPS.

### The app should make weirdness legible

Browser-hosted servers are weird.

That is fine.

The product should explain:

- why it is weird
- why it still works
- which pieces are local
- which pieces are peer-to-peer
- what storage and trust models are involved

## Near-Term Milestones

### Milestone 1: Visual shell

- app shell
- server editor
- dashboard placeholders
- client playground placeholders
- local workspace loading/saving

### Milestone 2: Real TS runtime hosting

- launch a TS client-side server from the IDE
- show connection state
- show live logs
- count calls
- highlight handlers

### Milestone 3: Real Python runtime hosting

- launch a Python client-side server from the IDE
- handle hidden package installs/import resolution
- show runtime logs and errors

### Milestone 4: Client playground maturity

- TypeScript and Python playgrounds
- schema-driven forms
- exact source snippets
- result/event streaming

### Milestone 5: Versioning and recovery

- local versions
- snapshot restore
- project metadata
- durable per-project storage

### Milestone 6: Database story

- in-browser SQL-like editable tabular database per hosted server (via `xpdb` or `xpdb`-inspired)
- database explorer panel: schema browsing, row editing, query execution
- observability for remote database connections made by hosted servers

### Milestone 7: Export and proof

- full static build
- fully packaged single HTML build
- “this is really client-side” proof flow

## Current State

The repo is in transition from an early RN-web placeholder scaffold to the real architecture: Monaco + custom workbench shell.

The next real work is:

- set up the Monaco + workbench shell foundation
- restructure the repo to match the monorepo shape above
- runtime orchestration via `plat`
- IDE state management
- storage design
- dashboard feedback loops
- single-file packaging feasibility spike

## Development

```bash
npm install
npm run dev
npm run build
npm run build:single
```

## Relationship To plat

`browserver` should not turn into “the place where `plat` logic gets reimplemented badly.”

Instead:

- `plat` should continue evolving as the underlying framework/runtime
- `browserver` should be the best development and demonstration environment built on top of it

Small cross-development into `plat` is expected and healthy.
The primary mission of `browserver`, though, is product experience.
