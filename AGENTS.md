# AGENTS

## Documentation First

Documentation is the most important part of this project.

Treat every `AGENTS.md` file as part of the runtime contract, not as optional notes. Poor documentation causes agent behavior drift, architecture drift, and bad changes in the wrong layer.

This repository now uses a documentation hierarchy:

- `/AGENTS.md` owns repo-wide rules, documentation policy, and top-level architecture
- the five core docs are `/AGENTS.md`, `/app/AGENTS.md`, `/server/AGENTS.md`, `/commands/AGENTS.md`, and `/packaging/AGENTS.md`
- deeper `AGENTS.md` files inside `app/` and `server/` own the concrete implementation contracts for the module or subsystem in their subtree
- the closer the doc is to the code, the more technical and specific it should be
- the higher the doc is in the tree, the more it should focus on principles, ownership, stable contracts, and architecture

Always update the relevant docs in the same session as the code change:

- update the closest owning `AGENTS.md` for the files you changed
- reflect stable architecture, workflow, and agent-facing behavior changes into the supplemental docs under `app/L0/_all/mod/_core/documentation/docs/`
- update parent docs too when the higher-level contract, ownership boundary, architecture, or workflow changed
- keep higher-level docs abstract where appropriate and push implementation detail down into local docs
- keep lower-level docs concrete, explicit, and practical
- remove stale or contradictory documentation immediately
- keep `README.md` as the public product source of truth for the project pitch, quick starts, community links, release links, and the high-level documentation map
- do not let `README.md` become a competing implementation contract; durable architecture and workflow contracts belong in `AGENTS.md`, while broader agent-facing narrative docs belong in `app/L0/_all/mod/_core/documentation/docs/`

Documentation depth model:

- level 0 repo doc: mission, top-level architecture, cross-cutting rules, and the documentation policy for the whole tree
- level 1 core domain docs: `app/`, `server/`, `commands/`, and `packaging/` architecture, plus the template for their immediate child docs
- level 2 subsystem or module docs: one major area, its owned files, its stable contracts, and the template for any deeper docs in that subtree
- level 3 leaf docs: one concrete surface, feature, view, or service contract with exact implementation guidance
- if a level 2 or level 3 doc later gains children, it stops being a leaf and must add its own `Documentation Hierarchy` section before those child docs land

Documentation shape rules:

- sibling docs at the same depth should use the same section order unless a domain-specific contract truly needs one extra section
- every `AGENTS.md` should answer, in this order when practical: what this scope owns, which files or surfaces it owns, which stable contracts it enforces, how child docs divide the remaining detail, and what changes require doc updates
- parent docs explain boundaries, ownership maps, and stable seams; child docs explain concrete file-level behavior, state, styles, assets, and API usage
- do not split one ownership boundary across multiple ad hoc notes when one owning `AGENTS.md` can explain the links between code, styles, state, assets, and APIs more clearly

## Introduction

Space Agent is a browser-first AI agent runtime.

The browser app is the primary runtime. The Node.js side exists as thin infrastructure around it for:

- outbound fetch proxying when the browser would otherwise hit CORS limits
- server-owned APIs and other narrow infrastructure contracts
- local development and optional desktop hosting

Default architecture rule:

- prefer frontend changes over backend changes
- treat backend edits as exceptional, not routine
- only move work into `server/`, `commands/`, or `packaging/` when the behavior must be backend-owned for security, integrity, multi-user isolation, or runtime stability and cannot be safely enforced in the browser
- if backend work is needed and the user did not explicitly ask for it, stop and ask for permission before editing backend files
- when asking for that permission, explain that backend work is non-standard for this project, describe the risk that makes frontend-only work insufficient, and state the narrow backend change you need

Implement only what the user explicitly asked for. Do not invent new features, policies, cleanup behavior, or product changes on your own. If a request would require a new behavior or policy that the user did not ask for, stop and ask first.

The five core documentation files remain the project's primary instruction set:

- `/AGENTS.md`
- `/app/AGENTS.md`
- `/server/AGENTS.md`
- `/commands/AGENTS.md`
- `/packaging/AGENTS.md`

## Programming Guide

These rules apply across the codebase:

- keep implementations lean; prefer refactoring and simplification over adding bloat
- do not repeat code unnecessarily; when logic repeats, extract a shared implementation
- design new functionality to be reusable when that reuse is realistic
- do not hardwire features directly to each other when a small explicit contract or abstraction will do
- prefer composition, registries, and stable module boundaries over ad hoc cross-dependencies
- code must stay clean, readable, and reusable
- avoid boilerplate and ceremony unless they solve a real maintenance, safety, or clarity problem
- do not keep compatibility shims, wrapper modules, alias seams, or mirrored code paths unless the user explicitly asks for compatibility support; prefer updating callsites and removing the old path so the code stays simple and legible
- use deterministic discovery patterns for pluggable systems
- keep each handler type in one predictable folder and load implementations by explicit name, config, or convention
- apply the same deterministic loading rule to API handlers, watched-file handlers, workers, and other extension points that serve the same role
- do not create one-off loader paths for a single feature when that feature belongs in an existing handler or extension system
- in `server/`, name multiword scripts, modules, handler ids, and endpoint files with the object first and the verb second, and use underscores consistently, for example `file_read`, `login_check`, `user_manage`, and `pages_handler`
- when multiple objects should share the same interface, prefer JavaScript classes with a shared superclass and explicit overridden methods
- do not model shared interfaces as plain objects that are inspected at runtime to see whether a function exists
- use ES module syntax throughout the codebase; prefer `import` and `export` and avoid CommonJS forms such as `require` and `module.exports`
- some legacy CommonJS still exists in the repository; treat it as migration debt, not as a pattern to copy
- keep as much agent logic in the browser as possible
- treat the server as infrastructure, not as the main application runtime
- do not move work to the backend for convenience, symmetry, or habit when the frontend can own it safely
- backend ownership is reserved for security-sensitive enforcement, integrity boundaries, cross-user effects, or runtime-stability concerns that a malicious or buggy frontend could bypass
- prefer explicit, small contracts between browser and server
- prefer maintainable filesystem structure over clever routing shortcuts

## Top-Level Structure

Top-level structure:

- `space`: root CLI router that discovers command modules dynamically
- `.github/`: repo-level automation, including tagged desktop release publishing
- `commands/`: CLI command modules such as `serve`, `help`, `get`, `set`, `version`, and `update`
- `app/`: browser runtime, layered customware model, shared frontend modules, and browser test surfaces
- `server/`: thin local infrastructure runtime, with page shells, request routing, API hosting, fetch proxying, file-watch indexes, auth/session infrastructure, and Git support code
- `tests/`: repo-level verification harnesses, prepared evaluation fixtures, and saved result artifacts
- `packaging/`: optional Electron host and packaging scripts; native hosts should stay thin

Project concepts:

- browser first, server last
- modules are the browser delivery unit for code, markup, styles, and assets
- browser modules are namespaced as `mod/<author>/<repo>/...`
- frontend extensibility is a core runtime primitive; the framework installs `space.extend` first and the browser runtime grows by loading modules and extension points deterministically
- the layered browser model is `app/L0` firmware, `app/L1` group customware, and `app/L2` user customware
- `app/L1` and `app/L2` are the logical writable layers; on disk they default to `app/L1` and `app/L2`, but when `CUSTOMWARE_PATH` is set the backend stores them under `CUSTOMWARE_PATH/L1` and `CUSTOMWARE_PATH/L2`
- writable layer content is transient runtime state and is gitignored when it lives under the repo; do not treat it as durable repo-owned sample content
- `L2/<username>/user.yaml` stores user metadata such as `full_name`; auth state lives under `L2/<username>/meta/`
- the server resolves `/mod/...` requests through the layered inheritance model and honors a `maxLayer` ceiling that defaults to `2`
- the `/admin` frontend clamps module and extension resolution to `L0` with `maxLayer=0` so admin UI assets stay firmware-backed even though app file APIs still operate on normal writable layers
- the browser authenticates through the server and uses a server-issued session cookie for protected API, module, and app-file access
- when `CUSTOMWARE_GIT_HISTORY` is enabled, writable `L1/<group>/` and `L2/<user>/` roots are treated as optional per-owner local Git repositories with adaptive-debounced server-side commits and rollback APIs
- `USER_FOLDER_SIZE_LIMIT_BYTES` optionally caps each `L2/<user>/` folder on disk; app-file mutations are checked against a cached per-user size total and only size-reducing mutations are allowed once a user folder is already over the limit
- runtime parameters are defined in `commands/params.yaml`; `node space serve` resolves them in this order: launch arguments, stored `.env` params written by `node space set`, then process environment variables, then schema defaults; `CUSTOMWARE_PATH` is the parent directory for writable backend `L1/` and `L2/` storage when configured, and page shells receive only `frontend_exposed` values as injected meta tags
- app file APIs use logical app-rooted paths such as `L2/alice/user.yaml` or `/app/L2/alice/user.yaml`, and supported endpoints may also accept `~` or `~/...` for the authenticated user's `L2/<username>/...`; those logical paths do not change when `CUSTOMWARE_PATH` relocates the writable backend roots
- non-`/api` and non-`/mod` browser entry routes are served from `server/pages/`; `/login` and `/enter` are public and the protected page shells live behind the router-side session gate
- detailed browser-runtime rules live in `/app/AGENTS.md`
- detailed server-runtime rules live in `/server/AGENTS.md`

## Supported CLI Surface

- `node space serve`
- `node space get`
- `node space get <param>`
- `node space set <param> <value>`
- `node space update`
- `node space help`
- `node space --help`
- `node space version`
- `node space --version`
- `node space user create`
- `node space user password`
- `node space group create`
- `node space group add`
- `node space group remove`

## Development Surface

- Node.js 20 or newer
- `npm install` for the standard source checkout
- `npm install --omit=optional` when native optional dependencies are not expected to work
- `npm run dev` to run the local dev supervisor
- `node space serve` to run the server directly
- `npm run install:packaging` to install packaging-only dependencies
- `npm run desktop:dev`, `npm run desktop:pack`, and `npm run desktop:dist` for the Electron host and packaging flow
- `.github/workflows/release-desktop.yml` builds tagged desktop releases for Windows, macOS, and Linux on both x64 and arm64; automatic runs start only from pushed `v*` tags whose tag commit points at `main` HEAD, manual `workflow_dispatch` reruns accept an existing Git tag on `main` history, and every publish updates the GitHub Release for that tag before uploading clobbered artifacts selected by `packaging/release-asset-filters.yaml` with uniform `Space-Agent-<app version>-<platform>-<arch>.<extension>` asset names

## Documentation System

Use one predictable documentation spine across the tree.

Required section pattern by depth:

- repo root: documentation policy, architecture, top-level structure, ownership map, and the contract for the core docs
- core domain docs: purpose, documentation hierarchy, domain structure, shared contracts, child-doc template, and guidance
- subsystem or module docs that own children: purpose, documentation hierarchy, ownership, local contracts, child-doc template, and development guidance
- leaf docs: purpose, ownership, the concrete local contracts, and development guidance

Core-doc obligations:

- `/app/AGENTS.md` must define how app module docs describe entry anchors, stores, components, styles, visual primitives, and cross-module seams
- `/server/AGENTS.md` must define how server docs describe endpoints, request flow, services, filesystems, permissions, indexes, and mutation side effects
- `/commands/AGENTS.md` must define how command-family docs describe CLI surface, arguments, outputs, state mutations, and shared-helper boundaries
- `/packaging/AGENTS.md` must define how host or platform docs describe preload bridges, startup flow, packaging scripts, assets, and platform-specific behavior

Child-doc obligations:

- every parent doc that has child `AGENTS.md` files must list them explicitly
- every parent doc must state what belongs in the parent versus the child docs
- every parent doc must define the section pattern its child docs should follow
- when a contract crosses parent and child scopes, update both docs in the same session
- when a stable contract change affects the agent-facing documentation map, update the relevant docs under `app/L0/_all/mod/_core/documentation/docs/` and the documentation skill at `app/L0/_all/mod/_core/documentation/ext/skills/documentation/SKILL.md` in the same session

## Documentation Ownership

Core ownership:

- `/README.md` owns the public-facing project overview, quick starts, call-to-action links, community links, release entry points, and DeepWiki discovery link; it must point back to the binding `AGENTS.md` contract instead of replacing it
- `/AGENTS.md` owns repo-wide rules, documentation policy, top-level structure, and cross-cutting principles
- `/app/AGENTS.md` owns browser-runtime architecture, layer rules, frontend composition rules, and app-wide guidance
- `/server/AGENTS.md` owns server responsibilities, request flow, API/module/page boundaries, and server-wide infrastructure guidance
- `/commands/AGENTS.md` owns CLI-module conventions and the command-tree contract under `commands/`
- `/packaging/AGENTS.md` owns native-host and packaging-surface guidance under `packaging/`

Local ownership:

- module-local `AGENTS.md` files inside `app/` own the concrete contracts for major frontend modules and surfaces
- `app/L0/_all/mod/_core/documentation/` owns the supplemental agent-facing documentation module, its fetch helper, and the browsable docs tree under `docs/`
- subsystem-local `AGENTS.md` files inside `server/` own the concrete contracts for router, pages, APIs, customware, auth, file-watch, and Git infrastructure
- `tests/AGENTS.md` owns repo-level test harness rules and child test-harness docs
- see `/app/AGENTS.md` and `/server/AGENTS.md` for the current map of local docs

Documentation rules:

- keep app-specific details in app docs, not in the root file
- keep server-specific details in server docs, not in the root file
- use local docs for implementation-specific module behavior instead of bloating the core docs
- keep `AGENTS.md` files as the binding contract layer and keep the documentation module as the broader narrative and orientation layer; they must not drift
- when a local doc later gains child docs, add a `Documentation Hierarchy` section there before the child docs multiply
- when a code change adds a new stable seam, subsystem, ownership boundary, or workflow, document it where it belongs before finishing
- when code reveals undocumented architecture, document it
- keep all `AGENTS.md` files explicit, current, and high signal
