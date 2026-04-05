# AGENTS.md

This file tells future agents and contributors how to work on `browserver` without losing the project’s intent.

Read this before making architectural or UX changes.

## Project Summary

`browserver` is a **browser-native IDE product** (Monaco + custom workbench shell) for:

- writing client-side servers
- launching them in the browser
- monitoring them live
- inspecting historical calls/logs/builds
- testing clients against them
- persisting projects locally
- eventually packaging the whole experience as a single HTML file

This is a static-first product.

## Absolute Priorities

When in doubt, optimize for these:

1. preserve the static-site nature of the product
2. preserve real browser-hosted runtime behavior
3. preserve dense IDE-style workbench UX
4. preserve runtime observability
5. preserve browser-owned config and storage
6. preserve the feasibility of single-file packaging

## Read These Files First

Before doing serious work, read:

- `README.md`
- `PLAN.md`
- `GOALS.md`

Do not skip `GOALS.md`.

## Architectural Rules

### 1. Start from the real IDE foundation

The project direction is React + Vite + Monaco + custom workbench shell + Tailwind.

Do not steer the project back toward:

- React Native Web or Expo (this is plain React DOM)
- Theia or any framework that assumes a backend process
- “we can just add a thin backend for this one thing”

### 2. There is no backend — absolutely none

The product is a static site served by a static file server. There is no backend. There will never be a backend. This has zero room for negotiation.

There must be no:

- application server
- API backend
- cloud control plane
- hidden app server
- server-side rendering host
- “temporary” or “development-only” backend process

If a change requires any server-side process beyond static file hosting, that change is rejected. This is not a judgment call — it is an absolute constraint.

### 3. Never reimplement anything plat provides

This is one of the most critical rules in the project. `plat` handles: transport (`css://`), server hosting, runtime lifecycle, client generation, OpenAPI, identity/trust foundations, Pyodide/Python management, peer communication (MQTT+STUN+WebRTC).

If you are writing code that does communication, transport, server hosting, client generation, runtime management, or peer signaling — **stop immediately**. You are reimplementing `plat`. Use `plat`'s APIs instead.

browserver's scope is strictly: IDE chrome, UI panels, observability surfaces, workbench layout, project persistence, config management, and packaging. It consumes `plat`. It never reimplements it.

### 4. Do not fake browser-hosted runtime behavior

If the user sees a server being launched, that should really mean browser-hosted runtime unless explicitly labeled otherwise.

### 5. User config is browser-owned

Config should be:

- JSON/YAML
- loaded by the user in the browser
- stored in browser-native storage
- exportable/importable

Do not make repo-local files the primary config model for end users.

### 6. The UI should be dense and concise

Use:

- panels
- toolbars
- context menus
- split views
- tabs
- inspectors
- inline affordances

Avoid:

- giant forms
- padded card stacks
- excessive whitespace
- flowery dashboard layouts

Styling/tooling direction:

- Monaco handles its own editor chrome
- Tailwind for the custom `browserver` product layer and workbench shell
- do not drift into bulky custom page layouts when compact utility-driven surfaces are more appropriate

## Product Rules

### Code must be portable to real servers

Code written in browserver must look and feel like normal server code. A user should be able to copy their server code out and run it on a real server with minimal or no changes.

Do not:

- leak browser-specific workarounds into user-authored code
- require browserver-only imports or abstractions in server code
- encourage patterns that only work in-browser

Browser runtime details (Pyodide, `css://`, in-browser DB) should be behind `plat` abstractions, not in user code.

### Runtime visibility is not optional

Every serious implementation should keep in mind:

- live logs
- live calls
- handler highlighting
- peer/session visibility
- historical call/log/build views

If a feature makes runtime behavior less visible, be skeptical.

### Historical state matters

Do not build only for “live now.”

We also need local historical views of:

- calls
- results
- failures
- logs
- builds
- session activity

### TS and Python are both first-class

Do not build the architecture in a way that assumes only TypeScript matters.

The product should support both:

- TypeScript browser servers
- Python browser servers

### The database layer is core, not optional

Client-side servers need real databases. `browserver` provides an in-browser, editable, tabular, SQL-like database per hosted server (via `xpdb` or `xpdb`-inspired approach), plus observability for remote database connections and localhost services.

Do not treat the data layer as a deferred nice-to-have or hard-code a simplistic persistence model.

## Good Work Patterns

When making changes:

- prefer adding reusable product primitives over one-off page logic
- keep runtime/state/telemetry models explicit
- keep layout configurability in mind
- think about how a feature appears in multiple workbench layouts
- think about local persistence from the start

## Bad Work Patterns

Avoid:

- building isolated pretty pages instead of workbench panels
- hiding complexity by moving it to a backend (there is no backend — this is an absolute constraint)
- reimplementing anything `plat` already provides (transport, runtime, communication, client generation, identity — all `plat`'s domain)
- faking runtime flows for convenience
- adding bulky setup UIs where compact inline tools would do
- ignoring the single-file build requirement

## If You Need To Simplify

Simplify by:

- reducing feature scope
- using placeholders honestly
- deferring polish
- keeping extension points clean

Do not simplify by:

- violating the static-only model (no backend, ever)
- removing visibility into runtime behavior
- replacing browser runtime with backend runtime

## Preferred Mindset

Think:

- IDE product
- local-first tool
- browser runtime lab
- observability console
- configurable workbench

Not:

- normal SaaS app
- demo microsite
- fancy frontend around hidden servers

## Final Reminder

This project is weird on purpose.

Treat the weirdness as a design constraint to preserve and clarify, not as something to sand away until the product looks ordinary.
