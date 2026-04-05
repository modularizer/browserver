# browserver Plan

## Purpose

Build `browserver` as a **browser-native IDE product** for writing, launching, hosting, inspecting, and sharing client-side servers.

The key architectural principles:

- we are **not** starting from a generic React app plus a code editor widget
- we are **not** rebuilding a modern IDE from scratch
- we are **not** using a framework that assumes a backend (this rules out Theia — see below)
- we are building on **React + Vite** with **Monaco** (browser-native editor) plus a **custom workbench shell**
- then extending it into a specialized client-side-server studio
- the product is a **static site only** — no backend of any kind, ever

That means `browserver` should feel less like:

- a nice demo page with panels

and more like:

- a real IDE
- with a runtime dashboard
- a client playground
- local project/data persistence
- trust/session visibility
- single-file static export goals

## IDE Foundation: Why Not Theia, and What Instead

The original plan called for Theia as the IDE foundation. Theia is attractive because it provides a full IDE workbench — editor tabs, panel layout, command palette, keybindings, extension model, language tooling — out of the box.

### Why Theia is almost certainly not viable

Theia's architecture is deeply coupled to a Node.js backend:

- The workspace filesystem is served via a backend REST/WebSocket API
- The terminal is a PTY spawned by the backend process
- Language servers run as backend child processes
- The extension host traditionally runs server-side
- Many core services communicate with the backend over JSON-RPC

**browserver cannot have a backend. Period.** Not a thin one, not an optional one, not a development-time one. The only server is a static file server. This has zero room for negotiation.

There are experimental browser-only Theia configurations, but they are not the primary supported path. Fighting Theia's backend assumptions would mean maintaining a fork or a complex set of service replacements against a framework that does not prioritize this use case.

Phase 0 includes a quick spike to confirm this assessment. If Theia can somehow boot from a static file server with zero backend processes and without heroic workarounds, great. But the expected outcome is that it cannot, and the plan must not depend on it.

### The actual path: Monaco + custom workbench shell

The IDE foundation is:

- **React + Vite** as the app framework (single-page app, no routing framework needed — this is a workbench, not a multi-page site)
- **Monaco** for the editor core (fully browser-native, no backend assumptions)
- **A custom workbench shell** (React components) for panel layout, tab management, command palette, keybindings, and theming
- **Tailwind** for the custom browserver product layer styling

This stack has critical advantages:

- zero backend assumptions from day one
- Vite already supports single-file builds via `vite-plugin-singlefile`
- natural fit for static deployment
- full control over the workbench layout model
- lighter total bundle weight than any full IDE framework
- React is the natural component model for the custom panels, dashboards, and inspectors

The workbench shell does not need to be as general-purpose as Theia's. It needs to support:

- multi-file editor tabs
- configurable panel layout (left sidebar, center editor, right inspector, bottom panel stack)
- switchable layout presets
- command palette
- keyboard shortcuts
- dense IDE-like theming
- context menus and toolbars
- split views

These are real engineering work, but they are bounded and well-understood problems. We are not rebuilding a general-purpose extensible IDE platform — we are building a specific product workbench.

### What we still get from the “start from a real IDE” instinct

The point of the Theia plan was never “use Theia specifically.” It was “do not waste time rebuilding generic IDE infrastructure.”

With Monaco + custom shell, we still honor that instinct:

- Monaco gives us the editor, syntax highlighting, code folding, symbol navigation, go-to-definition, language services, auto-import, IntelliSense — all browser-native
- The custom shell is scoped to the product's actual layout needs, not a general IDE framework
- We invest our energy in the browserver-specific surfaces (runtime dashboard, playground, trust panels) rather than generic editor features

### What we explicitly choose not to rebuild

Even without Theia, some generic capabilities should come from existing browser-native libraries rather than custom code:

- code editing → Monaco
- syntax highlighting → Monaco
- language services for TS/JS → Monaco's built-in TypeScript worker
- keyboard shortcut management → consider a lightweight library or scoped custom implementation
- drag-and-drop panel layout → consider existing browser-native layout libraries before building custom

The goal remains: spend product energy on what makes browserver different, not on reimplementing solved problems.

## Tech Stack Summary

- **React + Vite** — app framework, static build, single-file build via `vite-plugin-singlefile`
- **Monaco** — editor core (syntax, language services, IntelliSense, diffing)
- **Tailwind** — styling for the workbench shell and all custom browserver surfaces
- **TypeScript** — primary language for the browserver codebase itself

React Native Web is **not** used. This is a plain React DOM app. There is no cross-platform mobile target — the product is a browser IDE.

### Styling direction

- Monaco handles its own editor chrome and styling
- Tailwind is the preferred styling system for everything else: the workbench shell, product panels, dashboards, inspectors, and all custom browserver surfaces

Tailwind is the right fit because we care about:

- dense utility-driven styling
- strong theme tokens
- compact inline controls
- fast iteration on unusual UI surfaces

### Implementation decisions needed for Phase 0/1

These are browserver-scoped decisions that gate early work. They do not include anything that is `plat`'s responsibility — transport, runtime hosting, client generation, `css://`, identity, and Pyodide management are all `plat`'s domain.

#### State management

The IDE has many interconnected panels sharing live data: runtime events, editor state, workspace state, call history, peer state. A state management approach must be chosen early.

Likely candidates: Zustand (lightweight, good React integration), Jotai (atomic model, good for many independent pieces of state), or React context + reducers. The choice should favor something that handles frequent updates well (runtime telemetry can be high-throughput).

#### In-browser filesystem

Monaco uses a URI-based file model. The workspace model needs persistent multi-file storage. An in-browser filesystem approach must be chosen:

- **OPFS** (Origin Private File System) — modern, fast, good browser support, async API
- **IndexedDB wrapper** — widely supported, can store large blobs
- **BrowserFS / lightning-fs** — existing libraries that provide a Node-like FS API in-browser

The choice affects how Monaco models bridge to storage, how projects persist, and how import/export works.

#### Monaco + Vite wiring

Monaco in Vite requires specific configuration:

- Monaco editor workers need explicit Vite config (editor worker, TS worker, JSON worker, etc.)
- `vite-plugin-monaco-editor` or manual worker setup
- Theme bridging between Monaco's theme API and Tailwind's token system
- Multi-file model: bridging Monaco's URI-based models to the in-browser FS

#### User code transpile pipeline

Users write TypeScript in the editor. That code must be transpiled before it can run as a browser server. Options:

- In-browser TypeScript compiler (`typescript` package loaded in a web worker)
- esbuild-wasm
- SWC-wasm

The transpile step should surface in the IDE: build output panel, compile errors, timing. Python transpile/preparation is `plat_browser`'s responsibility, not ours.

#### Runtime-to-UI event plumbing

`plat` runs the server. The browserver UI needs to observe it: log events, call events, handler activations, peer state changes. The connection between `plat` runtime and React UI needs an explicit design.

Likely approach: `plat` exposes an event emitter or observable stream per server instance. browserver subscribes from React and feeds state management. The design should handle high-throughput events without blocking the UI (buffering, requestAnimationFrame batching, etc.).

#### Build variants and bundling strategy

**What is always bundled:** `plat` and all its dependencies (including MQTT client, STUN/WebRTC helpers, `css://` transport, client generation, OpenAPI tooling) are bundled into every build. These are core — browserver cannot function without them.

**What is never bundled:** Pyodide (~20MB+) is never included in the build output. It is unreasonable to bundle it. When Python support is needed, Pyodide is lazy-loaded at runtime (fetched from CDN or a configured URL). `plat_browser` manages this — browserver does not interact with Pyodide loading directly.

**Build variants:**

- `build` — production static build. Includes React, Monaco, workbench shell, `plat` + deps (MQTT, etc.), `plat_browser` (the Python bridge code, not Pyodide itself). Multi-file output, code-split.
- `build:single` — single-file HTML build. Same contents inlined into one file. Pyodide still lazy-loaded at runtime if Python is used.
- (future) `build:lite` — optional TS-only build that excludes `plat_browser` entirely for a smaller footprint when Python support is not needed.

The key insight: the `plat_browser` package itself is small — it's the glue code that knows how to bootstrap Pyodide, detect imports, install packages. That glue code gets bundled. Pyodide itself (the Python runtime WASM blob) is fetched at runtime only when a user actually launches a Python server.

#### Security / sandboxing

Users run arbitrary code in the same origin as the IDE. Consider:

- Running user server code in a Web Worker (isolated thread, no DOM access)
- Or an iframe sandbox (separate context, configurable permissions)
- Protecting the IDE's own IndexedDB/localStorage from user server code corruption

This doesn't need to be solved in Phase 0, but the architecture should not make sandboxing impossible to add later.

## Core Product Direction

`browserver` should become:

- an IDE for browser-hosted servers
- a dashboard for live runtime introspection
- a client playground for exercising the generated/dynamic client surfaces
- a local-first project and versioning environment
- a future local database explorer
- a trust/session visibility tool for `css://` peers

The Monaco editor plus custom workbench shell is the generic IDE foundation.
`browserver` is the specialized product built inside and around that shell.

## Code Portability Principle

Code written inside browserver must feel and look like native server code. It must be easily portable to a real server-side deployment with minimal or no changes.

This means:

- the programming model mirrors conventional server development: define methods, expose endpoints, handle requests
- `plat` abstractions are designed so the same code works both as a client-side browser server and as a traditional server-side server
- browser-specific runtime details (Pyodide, `css://` transport, in-browser DB) are hidden behind abstractions, never leaked into user code
- import paths, API shapes, and patterns are the same whether the server runs in a browser tab or on a VPS
- the IDE should not encourage or require patterns that only work in-browser

If a user writes a server in browserver, they should be able to copy it out and run it on a real server. This is what makes browserver a serious tool rather than a toy.

## Workbench UX Principles

`browserver` should behave like a **dense, reactive IDE workbench**, not a page made of oversized dashboard cards.

This is a product requirement, not visual polish.

The interface should emphasize:

- many panels visible at once
- compact inline controls
- configurable layouts
- reactive runtime feedback
- concise menus and inspectors
- strong theming
- low wasted space

It should avoid:

- giant forms
- bulky stacked cards
- deeply nested padded sections
- one-panel-at-a-time page flows

## Workbench Layout Model

The product should support multiple saved and switchable layouts.

Initial layout families to plan for:

- `Code`
  - editor-first
- `Observe`
  - calls/logs/runtime-first
- `Debug`
  - editor + current request + logs + terminal
- `Client`
  - editor + generated clients + playground
- `Data`
  - editor + runtime + local database inspector
- `Trust`
  - editor + peer/session/identity views
- `Wide`
  - dense many-panel layout for large screens
- custom user-saved layouts

### Default layout shape

The likely default should resemble:

- left sidebar
  - files
  - workspaces/projects
  - symbols
  - trust/session tree
- center
  - editor tabs
  - diffs
  - generated code/docs
- right inspector
  - runtime state
  - selected call
  - selected function
  - selected peer/session
- bottom panel stack
  - terminal
  - logs
  - calls
  - events
  - problems
  - builds

The user should not need to navigate between separate pages just to understand what the server is doing.

## Configurability Model

`browserver` is a general website for other people to host their own client-side servers.

That means the config model should be user-owned and browser-owned.

Configuration should be:

- loaded by the user in the browser
- editable in the browser
- saved locally in browser-native storage
- importable/exportable as files

It should not depend on:

- our repo’s config files
- a local filesystem convention
- hidden backend configuration state

### Preferred config formats

- JSON
- YAML

### What config should cover

The config model should eventually describe:

- project/workspace metadata
- server language and runtime mode
- server source/module entrypoints
- build/transpile preferences
- trust/authority options
- saved client snippets
- preferred layouts and panel visibility
- theme selection
- local database options
- export preferences

### Config source of truth

The source of truth should live in browser-native storage such as:

- localStorage
- IndexedDB
- other browser storage APIs where needed

The app may ship starter examples, but real user projects and preferences should belong to the user and persist in the browser.

## UI Density and Theming

The visual system should be intentionally compact and IDE-like.

### Density rules

- thin separators over bulky cards
- compact headers and toolbars
- compact inspector rows
- inline status chips and badges
- split panes over long vertical stacks
- little wasted padding

### Inline-first controls

Prefer:

- toolbar actions
- context menus
- gutter controls
- compact filters
- quick toggles
- right-click menus
- small inspectors
- keyboard shortcuts

Avoid:

- giant setup forms
- long wizard flows
- modals for common repeated actions

### Theme requirements

We should plan for first-class IDE themes from early on.

That means:

- dark mode that feels serious
- light mode that still feels dense and technical
- runtime/activity colors that are vivid but controlled
- consistent tokens for:
  - syntax
  - logs
  - calls
  - trust state
  - build state
  - handler highlights

## Reactive Runtime UX

The UI should respond live to what the server is doing.

Key behaviors:

- handlers highlight as calls arrive
- function call counters update live
- selected call synchronizes related panels
- logs stream live
- peer/session state updates live
- build/transpile/package state updates live
- server health and connection state stay visible

This should be treated as a telemetry-driven UI, not a set of isolated pages.

## Historical Observability

We need more than live streams.

The product should retain local history for:

- calls received
- results returned
- failures
- logs
- builds
- peer/session activity

That history should be explorable in the workbench through compact list/timeline/inspector views.

## Simultaneous Panel Expectations

The design should assume users may want to see many of these at once:

- file tree
- editor
- outline/symbols
- runtime inspector
- current call inspector
- call history
- live log tail
- terminal
- build output
- generated client code
- client playground
- peer/session list
- trust/identity panel
- local data/database explorer

This is why the workbench and layout model matter so much.

## Non-Negotiable Requirements

### 1. Static-site only — absolutely no backend

The product is a static site. There is no backend. There will never be a backend.

This is not "static-first" or "static-preferred." It is an absolute constraint. The only server involved is a static file server that serves the built assets. Nothing else runs on the server side.

That means:

- no application server, no API backend, no server-side process of any kind
- browser-native storage only
- browser-hosted runtime only
- browser/browser peer communication where needed (WebRTC, MQTT signaling — these are peer protocols, not backends)
- no "temporary" or "optional" or "development-only" backends

If a feature cannot be built without a backend, it does not ship.

### 2. Single-file packaged build

We ultimately want a fully packaged single HTML output.

That output matters because it helps prove:

- the hosted server is really running in the client
- the product is not secretly depending on a hidden server
- the environment is portable and archivable

The single-file build includes everything needed for the IDE and TS runtime: React, Monaco, workbench shell, `plat` + all deps (MQTT, WebRTC helpers, etc.). Pyodide is never inlined — if Python is used, it is lazy-loaded at runtime. The IDE foundation choice must not compromise this requirement. Packaging/export must be treated as a serious workstream early.

### 3. Visible runtime

The server runtime cannot be invisible.

The IDE must make it obvious when:

- the server starts
- the server restarts
- a request arrives
- a handler runs
- logs are emitted
- peers connect
- trust state changes

### 4. Local-first storage

Projects, versions, trust records, and server-local state must survive reloads.

### 5. Browser-owned JSON/YAML config

Users should be able to load, edit, save, and export project/workspace config entirely in the browser.

That config should be:

- JSON or YAML
- persisted locally
- user-owned
- decoupled from our repo and filesystem

### 6. Built on plat — never reimplement it

`browserver` is a product on top of `plat`. It consumes `plat`. It **never** reimplements anything `plat` provides.

`plat` owns:

- browser TS client-side servers
- browser Python client-side servers (via `plat_browser` / Pyodide)
- OpenAPI generation
- client generation/playgrounds
- `css://` transport (MQTT+STUN+WebRTC under the hood)
- identity / known-host / authority foundations
- peer communication and signaling
- runtime lifecycle management

browserver owns:

- IDE chrome, workbench shell, panel layout
- observability UI (dashboards, logs, call inspectors — consuming events from `plat`)
- project persistence and config management
- packaging and export
- database explorer UI

If browserver needs runtime/transport/communication functionality that `plat` doesn't yet provide, the correct action is to contribute it upstream to `plat`, not to build a parallel version in browserver. Reimplementing `plat` in browserver is one of the most catastrophic failures possible for this project.

## Prior Work To Rely On

### plat

Contribution to `browserver`:

- browser-hosted server runtime
- OpenAPI-based interfaces
- TS and Python client surfaces
- browser Python via `plat_browser`
- `css://` transport
- identity/trust foundations

### rtchat

Contribution to `browserver`:

- MQTT-signaled WebRTC experience
- host identity challenge instincts
- browser peer lifecycle lessons
- known-host / trust ideas

### pyprez

Contribution to `browserver`:

- browser Python runtime ergonomics
- hidden runtime philosophy
- import detection / package install UX lessons

### xpdb

Contribution to `browserver`:

- likely future local database story for hosted servers
- possible schema/data viewer foundation
- inspiration for durable local storage beyond ad hoc blobs

### gameboard

Contribution to `browserver`:

- live browser-native interactivity
- visible statefulness
- confidence in the browser as a serious host

## What Monaco Gives Us

Monaco provides a strong baseline for the editor features we do not want to reinvent:

- multi-file editor model
- code folding
- syntax highlighting
- symbol navigation
- go to definition / references
- auto-import and language-service features (TS/JS built-in, others via web workers)
- editor commands
- IntelliSense / autocomplete
- diff editor
- minimap
- find and replace

The product should not spend its early energy rebuilding any of these.

What Monaco does **not** give us (and the workbench shell must provide):

- file tree / explorer panel
- editor tabs (multi-file tab bar)
- panel layout and docking
- command palette
- keyboard shortcut management
- theming beyond the editor

These are the workbench shell's responsibilities.

## What Browserver Adds On Top

This is the differentiator.

### 1. Runtime host integration

`browserver` should let the IDE directly launch browser-hosted servers from the active project.

That includes:

- TypeScript browser server launch (via `plat` client-side server APIs)
- Python browser server launch (via `plat_browser` which uses Pyodide under the hood — `browserver` should not interact with Pyodide directly, but rely on `plat`'s abstractions)
- restarts
- lifecycle controls
- runtime state tracking

The Python story is important: `plat_browser` provides browser Python support via Pyodide, including hidden runtime bootstrapping, import detection, and automatic package installation. `browserver` relies on this — it does not manage Pyodide directly. Python servers should feel as natural as TypeScript servers in the IDE, not like a special mode.

### 2. Runtime dashboard

This should be a serious product surface, not a throwaway console.

It should show:

- live logs
- incoming requests
- function call counts
- highlighted handlers as calls arrive
- request/result history
- connection state
- active peer/session state

It should also preserve local historical views of that activity, not just transient live state.

### 3. Client playground

The playground should live inside the IDE environment.

It should support:

- exact TS client snippets
- exact Python client snippets
- schema-driven invocation UI
- result/event streaming
- quick calls against the live server
- trust/session visibility for `css://`

### 4. Trust + session tools

Because browser-hosted servers are peer-shaped, the IDE should expose:

- current server identity
- known-host records
- TOFU/authority status
- connected peers
- shared session state
- eventual peer chat or side-channel communication

### 5. Local project/version model

The IDE should support:

- saved workspaces
- code snapshots
- restore points
- multiple projects
- local-first history
- JSON/YAML config import/export
- browser-native config persistence

### 6. Database explorer

Most real servers need a database. Browser-hosted servers are no different.

Powered by `xpdb` or an `xpdb`-inspired approach, the IDE should provide:

- an in-browser, editable, tabular, SQL-like database for each hosted server
- schema browsing, row editing, and query execution from within the IDE
- a database explorer panel that lives in the workbench alongside the editor and dashboard

Additionally, client-side servers may connect to real remote hosted databases (Supabase, PlanetScale, Neon, etc.). The IDE should surface this database activity as part of runtime observability — the client-side server is making the calls, so the dashboard should show them.

Client-side servers may also talk to processes and databases on `localhost`. The common dev workflow is a browser tab hosting the client-side server, which can reach local services (Postgres, Redis, dev APIs, etc.) running on the developer's machine. The IDE should support visibility into these localhost connections as part of the runtime dashboard.

The key distinction: remote databases and localhost services are the *hosted server's* dependencies, not browserver's. browserver itself has no backend.

## Architecture Shift

## Old assumptions to reject

Do not build `browserver` as:

- a React Native Web app — the earlier scaffold used RN-web; that is being replaced with plain React DOM
- a Theia-based IDE — Theia requires a backend, which is absolutely prohibited
- an Expo or Next.js app with file-based routing — this is a single-page IDE workbench, not a multi-page site

## Current architecture

Build `browserver` as:

- a **React + Vite** single-page app
- with **Monaco** for the editor core
- a **custom workbench shell** (React components + Tailwind) for the IDE chrome
- **no backend of any kind** — static files only

The architecture layers:

1. **App shell** (React + Vite)
   - entry point, static build, single-file build
2. **Editor layer** (Monaco)
   - code editing, syntax, language services (TS/JS built-in, others via web workers)
3. **Workbench shell layer** (React + Tailwind)
   - panel layout / docking
   - editor tabs
   - command palette
   - keybindings
   - file explorer
   - theming
4. **browserver product layer** (React + Tailwind)
   - runtime dashboard
   - plat launchers
   - client API playground
   - trust/session panels
   - local project/version management
   - single-file export logic

## Proposed Repo Shape

The repo should reflect this.

High-level shape:

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

## Main Workstreams

## Workstream 1: IDE foundation (browser-only)

Depends on: nothing (this is the root)

Goal:

- stand up a clean browser-only IDE base we can extend, with zero backend dependencies

Deliverables:

- browser IDE shell with no backend process
- in-browser filesystem (IndexedDB-backed or in-memory)
- file/workspace model
- extension/contribution structure
- dev/build setup
- **packaging feasibility spike**: prove the IDE shell can be inlined into a single HTML file, or identify what blocks it

Hard constraint: the IDE foundation must work when served from a static file server. No Node.js backend, no WebSocket to a server process, no server-side anything.

## Workstream 2: Plat runtime integration

Depends on: WS1 (needs the IDE shell to host UI)

Goal:

- launch and control `plat` browser runtimes from inside the IDE

Deliverables:

- TS browser server launcher
- Python browser server launcher
- runtime lifecycle controls
- runtime status service

## Workstream 3: Dashboard surfaces

Depends on: WS1 (panel infrastructure), WS2 (runtime data to display)

Goal:

- make runtime behavior visible and satisfying

Deliverables:

- logs panel
- request panel
- handler activity panel
- counters and health states
- session/peer panel
- historical call/log/build views
- compact inspector variants for dense layouts

## Workstream 4: Client playground

Depends on: WS1 (panel infrastructure), WS2 (live server to call)

Goal:

- let users exercise the live API surface from the IDE

Deliverables:

- TS client playground
- Python client playground
- schema-driven API forms
- exact code snippets
- concise layout-friendly playground views that do not degrade into giant forms

## Workstream 5: Local-first project model

Depends on: WS1 (workspace model)

Goal:

- make the IDE feel safe and persistent

Deliverables:

- saved workspaces
- snapshots
- restore flow
- trust and identity persistence
- JSON/YAML config import/export
- browser-native config source of truth

## Workstream 6: Export / packaging

Depends on: WS1 (must package the IDE shell)

Goal:

- preserve the static-only and single-file story

Deliverables:

- normal static build
- packaged single-file build
- proof-oriented runtime story

**This workstream starts in Phase 1** with the packaging feasibility spike and continues through the project. It is not a final polish step.

## Workstream 7: Data layer

Depends on: WS1 (panel infrastructure), WS5 (persistence model)

Goal:

- give browser-hosted servers a real in-browser database, and surface database activity (local and remote) in the IDE

Deliverables:

- in-browser SQL-like editable tabular database per server (via `xpdb` or `xpdb`-inspired approach)
- database explorer panel: schema browsing, row editing, query execution
- local data model per project/server
- observability for remote database connections (when a hosted server talks to Supabase, PlanetScale, etc.)
- database activity surfaced in the runtime dashboard

## Phased Plan

## Phase 0: scaffold reset

Theia has been evaluated and is almost certainly not viable due to backend dependencies (see "IDE Foundation" section above). A quick spike may confirm, but the expected path is Monaco + custom workbench shell.

Deliverables:

- remove the current RN-web placeholder scaffold (drop `react-native`, `react-native-web`, RN-style components)
- set up React + Vite + Tailwind + Monaco foundation
- restructure repo around the new architecture
- document package boundaries clearly

Exit criteria:

- a minimal React + Vite app boots with Monaco editor and basic workbench shell
- served from a static file server with zero backend processes
- the repo shape matches the proposed monorepo layout

## Phase 1: minimal browser IDE studio

Deliverables:

- browser IDE shell boots from static files
- basic editor/workspace surfaces exist
- browserver custom contribution points are in place
- initial dense workbench layout
- panel docking strategy
- theme token strategy
- **packaging feasibility spike**: prove the IDE shell can be packaged into a single HTML file, or identify specific blockers and mitigation paths

Exit criteria:

- we are extending a real IDE platform, not simulating one
- the shell runs from a static file server with zero backend
- we have evidence that single-file packaging is feasible or a concrete plan to make it feasible

## Phase 2: real TS runtime hosting inside the IDE

Deliverables:

- launch TS client-side server
- show runtime state
- log capture
- request capture
- handler highlighting

Exit criteria:

- the IDE can host and observe a real browser TS server

## Phase 3: Python runtime hosting

Python browser servers are powered by `plat_browser`, which uses Pyodide under the hood. `browserver` does not interact with Pyodide directly — it uses `plat`'s abstractions for launching, managing, and observing Python runtimes.

Deliverables:

- launch Python client-side server via `plat_browser`
- show Python runtime logs/errors
- manage hidden package/runtime flow (import detection, automatic Pyodide package install — provided by `plat_browser`)

Exit criteria:

- TS and Python both feel native inside the same studio
- Python does not feel like "special Pyodide mode" — it feels like another server language

## Phase 4: playground maturity

Deliverables:

- exact TS/Python client snippets
- generated forms
- event/result streaming
- trust/session visibility

## Phase 5: versioning and persistence

Deliverables:

- projects
- snapshots
- restore
- trust persistence
- JSON/YAML config import/export
- saved layouts and runtime preferences in browser storage

## Phase 6: data tools

Deliverables:

- in-browser SQL-like editable tabular database per hosted server (via `xpdb` or `xpdb`-inspired approach)
- database explorer panel: schema browsing, row editing, query execution
- observability for remote database connections made by hosted servers
- database activity integrated into the runtime dashboard

## Phase 7: export and proof (completion)

The packaging feasibility spike happens in Phase 1. This phase completes the work.

Deliverables:

- full static build with all product surfaces
- single-file packaged build including runtime and data layers
- documented proof that the runtime is really client-side

## Risks

### 1. Workbench shell scope creep

Risk:

- building the custom workbench shell (panel layout, tabs, command palette, keybindings) could absorb too much time if it becomes over-engineered

Mitigation:

- scope the shell to browserver's actual needs, not a general-purpose IDE framework
- use existing browser-native libraries where they exist (layout engines, shortcut managers)
- start with a minimal viable shell and iterate

### 2. Over-customization too early

Risk:

- fighting the IDE platform instead of leveraging it

Mitigation:

- inherit generic IDE behavior whenever possible
- customize only where `browserver` is truly different

### 3. Packaging complexity

Risk:

- Monaco plus custom shell plus single-file packaging is nontrivial

Mitigation:

- start validating packaging assumptions early
- make export a first-class workstream, not a final polish step

### 4. Accidentally reimplementing plat

Risk:

- this is one of the most likely and most catastrophic failures. `plat` provides transport (`css://`), server hosting, runtime lifecycle, client generation, OpenAPI, identity/trust, Pyodide/Python management, peer communication (MQTT+STUN+WebRTC). If browserver reimplements any of this, the project has failed.

Mitigation:

- before writing any code that touches communication, transport, runtime management, client generation, or peer signaling: check if `plat` already does it
- browserver's scope is IDE chrome, UI panels, observability, workbench layout, project persistence, config, and packaging
- if `plat` is missing something browserver needs, contribute it to `plat` — do not build a parallel version in browserver

### 5. Product logic leaking into plat

Risk:

- browserver-specific UX concerns get pushed into `plat` where they don't belong

Mitigation:

- only upstream genuinely reusable primitives
- keep product-shaped UX in `browserver`

## Success Criteria

We should consider the project on track when:

- the studio feels like a real IDE from the start
- browser TS and Python servers can launch inside it
- the dashboard makes runtime activity feel alive
- the client playground teaches the actual client surface
- projects persist locally
- the product still retains a credible static/single-file story
- the layout comfortably shows many useful panels at once without feeling bloated
- the interface feels concise and reactive instead of form-heavy

## Future: Peer Distribution Network

Not an immediate workstream, but a future direction that should inform current architecture.

The vision: one user writes a client-side server in browserver. That server's code gets packaged. Other users can discover it, download it to their own browser storage, and start hosting it themselves. Multiple browsers hosting the same server form a distribution network with peer-to-peer load balancing.

This matters because:

- it turns browserver from a single-user tool into a decentralized hosting mesh
- server code is just code — portable between browser instances with no backend deployment
- it leverages the `css://` transport and WebRTC peer model that already exist

Current decisions that should keep this in mind:

- server code and config must be fully self-contained and packageable (already required for single-file builds)
- the identity/trust model must support multiple hosts serving the same logical service
- peer discovery and `css://` routing should anticipate multi-host topologies
- the storage model must support importing packaged servers from other peers
- the runtime dashboard should eventually show peer topology, not just a single server instance

## Immediate Next Tasks

1. remove the current RN-web placeholder scaffold (drop `react-native`, `react-native-web`)
2. set up React + Vite + Tailwind + Monaco foundation
3. build minimal workbench shell (panel layout, editor tabs, command palette)
4. restructure the repo to match the proposed monorepo shape
5. prove single-file packaging feasibility with the new foundation
6. integrate the first `plat` runtime launch path (TS browser server)

## Guiding Statement

`browserver` should feel like a real modern IDE first, and a browser-hosted server miracle second.

The miracle is more convincing when the surrounding tool feels serious.
