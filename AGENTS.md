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

## AGENTS File Index

This root file must keep an exhaustive index of every other repo `AGENTS.md` path so the full contract map is visible without extra filesystem discovery. Update this index whenever an `AGENTS.md` file is added, removed, moved, or renamed.

App docs:
- `/app/AGENTS.md`
- `/app/L0/_admin/mod/_core/overlay_agent/AGENTS.md`
- `/app/L0/_all/mod/_core/admin/AGENTS.md`
- `/app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `/app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `/app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`
- `/app/L0/_all/mod/_core/admin/views/time_travel/AGENTS.md`
- `/app/L0/_all/mod/_core/agent/AGENTS.md`
- `/app/L0/_all/mod/_core/agent-chat/AGENTS.md`
- `/app/L0/_all/mod/_core/agent_prompt/AGENTS.md`
- `/app/L0/_all/mod/_core/dashboard/AGENTS.md`
- `/app/L0/_all/mod/_core/dashboard_welcome/AGENTS.md`
- `/app/L0/_all/mod/_core/documentation/AGENTS.md`
- `/app/L0/_all/mod/_core/file_explorer/AGENTS.md`
- `/app/L0/_all/mod/_core/framework/AGENTS.md`
- `/app/L0/_all/mod/_core/huggingface/AGENTS.md`
- `/app/L0/_all/mod/_core/login_hooks/AGENTS.md`
- `/app/L0/_all/mod/_core/memory/AGENTS.md`
- `/app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `/app/L0/_all/mod/_core/onscreen_agent/prompts/AGENTS.md`
- `/app/L0/_all/mod/_core/onscreen_menu/AGENTS.md`
- `/app/L0/_all/mod/_core/open_router/AGENTS.md`
- `/app/L0/_all/mod/_core/panels/AGENTS.md`
- `/app/L0/_all/mod/_core/promptinclude/AGENTS.md`
- `/app/L0/_all/mod/_core/router/AGENTS.md`
- `/app/L0/_all/mod/_core/skillset/AGENTS.md`
- `/app/L0/_all/mod/_core/skillset/ext/skills/development/AGENTS.md`
- `/app/L0/_all/mod/_core/spaces/AGENTS.md`
- `/app/L0/_all/mod/_core/time_travel/AGENTS.md`
- `/app/L0/_all/mod/_core/user/AGENTS.md`
- `/app/L0/_all/mod/_core/user_crypto/AGENTS.md`
- `/app/L0/_all/mod/_core/visual/AGENTS.md`
- `/app/L0/_all/mod/_core/web_browsing/AGENTS.md`
- `/app/L0/_all/mod/_core/webllm/AGENTS.md`

Commands docs:
- `/commands/AGENTS.md`
- `/commands/lib/supervisor/AGENTS.md`

Packaging docs:
- `/packaging/AGENTS.md`

Server docs:
- `/server/AGENTS.md`
- `/server/api/AGENTS.md`
- `/server/jobs/AGENTS.md`
- `/server/lib/auth/AGENTS.md`
- `/server/lib/customware/AGENTS.md`
- `/server/lib/file_watch/AGENTS.md`
- `/server/lib/git/AGENTS.md`
- `/server/lib/share/AGENTS.md`
- `/server/lib/tmp/AGENTS.md`
- `/server/pages/AGENTS.md`
- `/server/router/AGENTS.md`
- `/server/runtime/AGENTS.md`

Test docs:
- `/tests/AGENTS.md`
- `/tests/agent_llm_performance/AGENTS.md`
- `/tests/browser_component_harness/AGENTS.md`

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
- skills are metadata-driven: when a frontend skill should exist, be gated, or auto-load, define that in its `mod/.../ext/skills/.../SKILL.md` file through normal discovery plus `metadata.when`, `metadata.loaded`, and `metadata.placement`
- do not hardcode specific skill ids into prompt builders or other runtime JS when the shared `ext/skills` discovery contract already covers the behavior
- only add a new runtime-owned skill seam when the existing metadata-driven skill system cannot express the requirement, and document that reason in the owning `AGENTS.md`
- do not create new scratch, temporary, or throwaway directories under the repo as tracked content, especially hidden paths such as `.tmp/`; local verification artifacts must stay outside the published repo or in ignored local paths unless the user explicitly asks for a checked-in fixture
- do not check generated binaries, staged release outputs, or other ephemeral build artifacts into ad hoc repo locations; if a durable fixture is truly required, keep it small, intentional, and in an owned non-hidden test or documentation path
- for visual elements, reusable UI primitives, and dialog chrome, follow `/app/L0/_all/mod/_core/visual/AGENTS.md` as the binding contract instead of inventing feature-local alternatives when the shared visual system already covers the need

## Top-Level Structure

Top-level structure:

- `space`: root CLI router that discovers command modules dynamically
- `.github/`: repo-level automation, tagged desktop release publishing, and lightweight public assets used by the README, including hero, badge, and video thumbnail artwork
- `.vscode/`: workspace editor settings plus the checked-in `npm run dev` debugger launch config for server-side breakpoints during local development
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
- the browser authenticates through the server and uses a server-issued `space_session` cookie for protected API, module, and app-file access; when the current login is allowed to auto-restore `userCrypto` on the same browser profile, the browser keeps one encrypted local blob in `localStorage`, and authenticated browser code fetches a session-derived wrapping key from the backend by hashing the current backend `sessionId` with the server-held session secret
- when `CUSTOMWARE_GIT_HISTORY` is enabled, writable `L1/<group>/` and `L2/<user>/` roots are treated as optional per-owner local Git repositories with adaptive-debounced server-side commits and rollback APIs
- `USER_FOLDER_SIZE_LIMIT_BYTES` optionally caps each `L2/<user>/` folder on disk; app-file mutations are checked against a cached per-user size total and only size-reducing mutations are allowed once a user folder is already over the limit
- runtime parameters are defined in `commands/params.yaml`; `node space serve` resolves them in this order: launch arguments, stored `.env` params written by `node space set`, then process environment variables, then schema defaults; `node space supervise` accepts the same runtime parameters, owns the public `HOST` and `PORT`, requires `CUSTOMWARE_PATH`, enables source auto-update by default, and passes the remaining resolved params to private `space serve` children; `WORKERS` controls clustered HTTP worker count for `serve` and `supervise`; `CUSTOMWARE_PATH` is the parent directory for writable backend `L1/` and `L2/` storage when configured and also hosts backend-owned cloud-share archives under `share/spaces/` when that feature is enabled; `CUSTOMWARE_WATCHDOG` defaults to `true` and controls live backend customware watching, config watching, and the periodic reconcile backstop without disabling startup indexing or explicit clustered mutation sync; `GIT_BACKEND` defaults to `auto` and may force `native` or `isomorphic` for server-owned Git flows such as local history and Git-backed module operations; `LOGIN_ALLOWED` gates the password-login endpoints and login-shell form, `CLOUD_SHARE_ALLOWED` gates hosted cloud-share uploads, `CLOUD_SHARE_URL` tells browser clients which hosted share receiver to use, and page shells receive only `frontend_exposed` values as injected meta tags
- app file APIs use logical app-rooted paths such as `L2/alice/user.yaml` or `/app/L2/alice/user.yaml`, and supported endpoints may also accept `~` or `~/...` for the authenticated user's `L2/<username>/...`; those logical paths do not change when `CUSTOMWARE_PATH` relocates the writable backend roots
- non-`/api` and non-`/mod` browser entry routes are served from `server/pages/`; `/login` and `/enter` are public and the protected page shells live behind the router-side session gate
- detailed browser-runtime rules live in `/app/AGENTS.md`
- detailed server-runtime rules live in `/server/AGENTS.md`

## Supported CLI Surface

- `node space serve`
- `node space supervise`
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
- `.vscode/launch.json` provides a `Dev Server (npm run dev)` debugger entry that launches the local dev supervisor and auto-attaches to its spawned `node space serve` child so `server/` breakpoints keep working after watcher restarts
- `node space serve` to run the server directly
- `node space supervise CUSTOMWARE_PATH=<path>` to run the production-ready zero-downtime auto-update supervisor for source checkouts
- optional root `Dockerfile` plus `docker-entrypoint.sh`: image entrypoint uses `tini`, defaults `HOST`/`PORT`/`CUSTOMWARE_PATH`, persists `CUSTOMWARE_PATH` via `node space set`, optionally seeds `L2/admin` once when that tree is missing, then runs `node space supervise`; set image `CMD` or pass a command to `docker run` to replace the default process (see comments in `docker-entrypoint.sh` for `SPACE_DOCKER_*` bootstrap toggles); root `Justfile` exposes `just docker-build`, `just docker-run`, and `just docker-shell`, with optional env overrides `SPACE_DOCKER_IMAGE`, `SPACE_DOCKER_TAG`, `SPACE_DOCKER_VOLUME`, and `SPACE_DOCKER_PORT`; `.dockerignore` trims the build context for Node/npm layouts; root `docker-compose.yaml` runs `space-agent:local` with a named Docker volume mounted at `/srv/space/customware` (build the image first, e.g. `just docker-build`)
- `npm run install:packaging` to install packaging-only dependencies
- `npm run desktop:dev`, `npm run desktop:pack`, `npm run desktop:dist`, and `npm run package:desktop:macos:dev` for the Electron host and packaging flow, with the macOS dev build command producing the default unpacked local `.app` bundle
- `.github/workflows/release-desktop.yml` builds tagged desktop releases for Windows, macOS, and Linux on both x64 and arm64; automatic tag runs and manual `workflow_dispatch` reruns both require the selected `v*` tag to be on `main` history, and both skip only when a newer `v*` tag is already on `main` after it; every publish updates the GitHub Release for that tag before uploading clobbered artifacts selected by `packaging/release-asset-filters.yaml` with uniform `Space-Agent-<release version>-<platform>-<arch>.<extension>` asset names that collapse a redundant trailing `.0` patch to the project's normal two-segment release version

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

- `/README.md` owns the public-facing project overview, quick starts, call-to-action links, community links, release entry points, video links, DeepWiki discovery link, and public hero artwork; it must point back to the binding `AGENTS.md` contract instead of replacing it
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
