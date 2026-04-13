# AGENTS

## Purpose

`app/` is the primary Space Agent runtime.

Keep agent orchestration, prompt construction, tool flow, state management, user interaction, and optimistic UX in the browser whenever possible. Server-backed work in this tree should be browser clients for explicit server APIs, not server-side orchestration leaking into the frontend.

Frontend-first policy:

- default to solving product and workflow behavior in `app/`
- do not propose or implement backend edits just because they feel cleaner from a traditional full-stack perspective
- only push behavior into the backend when the browser cannot safely enforce it because other users, shared data, auth boundaries, or runtime integrity would otherwise be at risk
- if such a backend change seems necessary and the user did not explicitly request backend work, stop and ask for permission first, explaining why frontend-only behavior would be insufficient

This is one of the five core docs. It owns app-wide architecture, composition rules, and development principles. Detailed module behavior belongs in deeper module-local docs.

Documentation is top priority for this area. After any change under `app/` or any app-facing contract change owned here, update this file, the closest owning module `AGENTS.md` files, and the relevant supplemental docs under `_core/documentation/docs/` in the same session before finishing.

## Documentation Hierarchy

`/app/AGENTS.md` stays high-level. Module-local docs own the implementation details for major frontend modules.

Current module-local docs in the app tree:

- `app/L0/_all/mod/_core/agent/AGENTS.md`
- `app/L0/_all/mod/_core/dashboard/AGENTS.md`
- `app/L0/_all/mod/_core/dashboard_welcome/AGENTS.md`
- `app/L0/_all/mod/_core/documentation/AGENTS.md`
- `app/L0/_all/mod/_core/framework/AGENTS.md`
- `app/L0/_all/mod/_core/pages/AGENTS.md`
- `app/L0/_all/mod/_core/login_hooks/AGENTS.md`
- `app/L0/_all/mod/_core/promptinclude/AGENTS.md`
- `app/L0/_all/mod/_core/router/AGENTS.md`
- `app/L0/_all/mod/_core/skillset/AGENTS.md`
- `app/L0/_all/mod/_core/spaces/AGENTS.md`
- `app/L0/_all/mod/_core/time_travel/AGENTS.md`
- `app/L0/_all/mod/_core/visual/AGENTS.md`
- `app/L0/_all/mod/_core/file_explorer/AGENTS.md`
- `app/L0/_all/mod/_core/huggingface/AGENTS.md`
- `app/L0/_all/mod/_core/webllm/AGENTS.md`
- `app/L0/_all/mod/_core/admin/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_menu/AGENTS.md`
- `app/L0/_all/mod/_core/open_router/AGENTS.md`
- `app/L1/_all/mod/metrics/posthog/AGENTS.md`
- `app/L0/_admin/mod/_core/overlay_agent/AGENTS.md`

Update rules:

- update the nearest module doc when you change a documented module
- update this file only when the app-wide contract, ownership map, composition model, or shared frontend conventions changed
- keep implementation-specific detail out of this file when a deeper doc can own it

## How To Document App Child Docs

All app child docs at the same depth should use the same backbone.

Default module-doc section order:

- `Purpose`
- `Documentation Hierarchy` when the module owns deeper docs or stable sub-areas
- `Ownership`
- one or more concrete contract sections that cover the seams this module exposes
- `Development Guidance`

Required contract coverage for app docs:

- entry points and extension seams: page anchors, routed views, `ext/html/` and `ext/js/` files, module-owned extension metadata folders such as `ext/pages/`, exported runtime namespaces, iframe boundaries, and route mounts
- state and persistence: stores, `init()` or `mount()` or `unmount()` lifecycle, session or local storage keys, app-file paths, backend endpoints, and background async work
- component and DOM ownership: which HTML files mount which JS or store files, which components are thin adapters, and which DOM refs or `x-ref` inputs are required
- visual and style ownership: which CSS is shared versus local, which `_core/visual` primitives are reused, and any mirrored public-shell assets or visual constraints
- cross-module links: which other modules this one may call, extend, or be extended by, and which dependencies are intentionally forbidden

Child-doc split rules:

- parent app docs own domain-wide composition rules and the map of module docs
- module docs own the link between HTML, JS, stores, CSS, assets, and extension seams inside that module
- leaf view or component docs, when added, should own the exact UI, store, and API contract for that surface without re-documenting the whole module

Module-type emphasis:

- platform modules such as `framework/` and `visual/` should emphasize reusable namespaces, primitives, tokens, and import boundaries
- shell modules such as `router/` and `admin/` should emphasize anchors, routing, layout seams, and child-surface ownership
- feature modules and admin views should emphasize stores, API calls, persistence, component linkage, and local styling rules

When a module later grows multiple independently owned sub-areas, add a local `Documentation Hierarchy` section there before adding new child docs.

## Structure

The browser runtime is organized into three layers:

- `app/package.json`: declares the app tree as an ES module package boundary so Node-side infrastructure can import shared browser utilities without fallback reparsing warnings, must keep minimal package metadata because desktop packaging ships that file inside the bundled app tree, and must not be treated as the Electron app root
- `L0/`: immutable firmware changed through updates
- `L1/`: runtime-editable group customware
- `L2/`: runtime-editable user customware

Current browser entry surfaces are served from `server/pages/`:

- `/`: main app shell from `server/pages/index.html`
- `/admin`: admin shell from `server/pages/admin.html`, with `meta[name="space-max-layer"]` set to `0` so module and extension resolution stay `L0`-only
- `/login`: standalone public auth entry from `server/pages/login.html`
- `/enter`: firmware-backed launcher from `server/pages/enter.html`, available to authenticated sessions and single-user runtime while unauthenticated multi-user requests are redirected to `/login`
- `/logout`: server-side logout action that clears the session cookie and redirects to `/login`

Current major first-party modules under `app/L0/_all/mod/_core/`:

- `framework/`: frontend bootstrap, runtime primitives, component loader, extension system, shared utilities
- `login_hooks/`: headless authenticated-bootstrap lifecycle hooks for first-login and same-origin `/login` arrival events, with a client-owned `~/meta/login_hooks.json` marker and feature-owned onboarding hooks such as the spaces module's first-login `Big Bang` onboarding-space bootstrap
- `visual/`: shared visual language, canvas, chrome, buttons, dialog helpers, and conversation rendering primitives
- `router/`: root routed shell for the authenticated app; route-level frame width, height or scroll policy, and other shell-owned layout overrides belong here rather than in feature modules, but routed pages own their own content padding
- `admin/`: firmware-backed admin shell and panels
- `agent/`: routed first-party agent information and user-local personality include editor, kept self-contained inside the module and advertised to the dashboard through `ext/pages/agent.yaml`
- `file_explorer/`: reusable app-file browser component, routed Files page, dashboard manifest, and routed header-menu item
- `documentation/`: supplemental agent-facing documentation docs, the focused-read documentation helper, and the documentation skill that carries the top-level docs map
- `pages/`: headless page-manifest discovery plus the dashboard-injected pages section, backed by permission-aware `ext/pages/*.yaml` metadata loaded through the shared extension resolver
- `promptinclude/`: headless promptinclude discovery and onscreen-agent prompt injection for readable `*.system.include.md` and `*.transient.include.md` app files
- `onscreen_agent/`: floating routed overlay agent and the first-party user-facing chat runtime
- `onscreen_menu/`: reserved routed shell header bar, Home shortcut to the empty default route, left and right shell-control seams, and `_core/onscreen_menu/items` dropdown action seam
- `open_router/`: headless OpenRouter request-policy module that extends the admin and onscreen API transport seams instead of hardcoding provider-specific headers into the chat runtimes
- `skillset/`: first-party shared skill packs plus browser helper scripts and shared browser-side skill discovery helpers used by the onscreen and admin agents
- `webllm/`: unlisted routed browser-only WebLLM test surface with a module-local worker, vendored browser runtime, compact searchable prebuilt model loading, expert-only compiled custom model loading, and simple throughput reporting
- `huggingface/`: dashboard-listed Local LLM page backed by a routed browser-only Hugging Face Transformers.js test surface, with a module-local singleton runtime manager and worker, direct Hub model loading, a vendored local browser runtime for upstream testing, shared saved-model state and browser-wide last-loaded selection reused by the admin and onscreen agents in the same browser context, and simple throughput reporting
- `time_travel/`: routed writable-layer history surface that defaults to the authenticated user's local Git commits, can switch to write-accessible `L1` or `L2` history repositories through a permission-aware picker, filters by changed file, opens per-file diffs, and calls the server rollback or revert APIs after explicit confirmation
- `dashboard/`, `dashboard_welcome/`, and `spaces/`: current routed feature surfaces and dashboard-injected surfaces under the router; `_core/dashboard` also teleports a route-owned control cluster into `[id="_core/onscreen_menu/bar_start"]` and exposes ordered dashboard-local topbar seams so feature modules can contribute dashboard-only header actions without hardcoding them into the shell

## Layer Rules And Module Model

- `L0` is firmware and should stay update-driven
- `L1` contains per-group customware; `_all` and `_admin` are special groups
- `L2` contains per-user customware; users should only write inside their own `L2/<username>/`
- the writable `L1` and `L2` layers are logical app paths first; on disk they default to `app/L1` and `app/L2`, but the backend may relocate them to `CUSTOMWARE_PATH/L1` and `CUSTOMWARE_PATH/L2`
- repo-local `app/L1` and `app/L2` are transient runtime state and are gitignored; do not document repo-owned example content there as if it were durable framework structure
- `L2/<username>/user.yaml` stores user metadata such as `full_name`; auth state and small client-owned user lifecycle markers live under `L2/<username>/meta/`
- groups may include users and other groups, and may declare managers that can write to that group's `L1` area
- read permissions are explicit: a user can read their own `L2/<username>/`, and can read `L0/<group>/` and `L1/<group>/` for groups they belong to
- write permissions are explicit: a user can write their own `L2/<username>/`; a user can write `L1/<group>/` only when they manage that group directly or through a managing-group include chain; members of `_admin` can write any `L1/` and `L2/` path; nobody writes `L0/`
- modules are the supported browser delivery and extension unit
- each group or user owns a `mod/` folder, and module contents are namespaced as `mod/<author>/<repo>/...`
- browser-facing code and assets should normally be delivered through `/mod/...`
- group-scoped onscreen skill packs may live under readable layer roots such as `L0/_admin/mod/.../ext/skills/`; visibility follows the same readable-root permission model as app-file discovery, and each skill file is named `SKILL.md`
- when a skill needs reusable browser logic, keep that logic in a small module-local JS file and import it from the skill via a stable `/mod/<author>/<repo>/...` path instead of pasting long scripts into `SKILL.md`
- skill files may use `metadata.when.tags` to require live page-owned skill-context tags before they become catalog-loadable, and may use `metadata.just_loaded` as either `true` or another `{ tags: [...] }` condition to auto-inject their body into the prompt after the catalog
- when a stable frontend contract or workflow changes, update the relevant narrative docs under `app/L0/_all/mod/_core/documentation/docs/` alongside the owning `AGENTS.md` files
- page shells may clamp module and extension resolution with `meta[name="space-max-layer"]`; the current admin shell sets `0`
- page shells may also receive injected `meta[name="space-config"]` tags for runtime parameters marked `frontend_exposed`
- authenticated app-file APIs operate on logical app-rooted paths such as `L2/alice/user.yaml` or `/app/L2/alice/user.yaml`, and supported APIs may use `~` or `~/...` as shorthand for the authenticated user's `L2/<username>/...`
- optional `space.api.gitHistoryList(...)`, `space.api.gitHistoryDiff(...)`, `space.api.gitHistoryPreview(...)`, `space.api.gitHistoryRollback(...)`, and `space.api.gitHistoryRevert(...)` helpers expose server-owned writable-layer local history when `CUSTOMWARE_GIT_HISTORY` is enabled
- first-party application development should happen primarily under `app/L0/_all/mod/_core/`
- use `L1` and `L2` for layered overrides and customware behavior, not as the main home for repo-owned first-party features

## Frontend Composition Model

The frontend is built as a chain of shells, modules, and extension seams.

Current boot flow:

1. A page shell in `server/pages/` loads shared framework CSS and `/mod/_core/framework/js/initFw.js`.
2. The shell exposes one top-level HTML anchor in the body.
3. `initFw.js` installs the runtime, injects the framework-owned `_core/framework/head/end` HTML seam into `document.head`, runs the extensible framework bootstrap step in `_core/framework/js/initializer.js`, including framework-wide same-origin `_blank` page-open handling, then installs Alpine helpers and shared bootstrap behavior.
4. The first mounted module owns the next seam and exposes more anchors or wrapped functions.
5. Other modules compose into those explicit seams instead of patching private internals.

Current entry anchors:

- `/` exposes `body/start`, which mounts `_core/router`
- `/admin` exposes `page/admin/body/start`, which mounts `_core/admin`

Default composition guidance:

- keep page shells small
- framework CSS establishes border-box sizing across authenticated app shells, so reusable modules should treat `width: 100%` as including padding and borders unless they explicitly opt out
- mount real features through thin `ext/html/...` adapter files
- let the owning module expose the next seam
- add explicit extension points when downstream customization is realistic

## Extension And Component Contracts

There are two primary extension styles in the frontend runtime.

HTML extension anchors:

- declare a seam with `<x-extension id="some/path">`
- matching HTML files live at `mod/<author>/<repo>/ext/html/some/path/*.html`
- HTML callers name only the seam; the runtime loads `<x-extension>` tags from the module's `ext/html/` tree automatically
- thin extension files should usually mount the real component from the module root instead of containing the entire feature directly
- root page anchors such as `body/start` and `page/admin/body/start` are fixed shell contracts; module-owned anchors should be named after the owning module path, for example `_core/router/shell_start`
- `_core/framework` also creates `_core/framework/head/end` in `document.head` during bootstrap so layers can add declarative head-side tags or inline bootstraps without editing page shells or adding a JS hook
- runtime discovery watches the whole document tree, so `x-extension` and `x-component` insertions under `head` are supported the same way as body-mounted seams
- `_core/onscreen_menu` owns a reserved centered header bar from `_core/router/shell_start`; it keeps `_core/onscreen_menu/bar_start` on the left and `_core/onscreen_menu/bar_end` on the right for shell-level controls, allows route-owned `x-teleport` content to target the existing left-side `[id="_core/onscreen_menu/bar_start"]` container when a feature wants ephemeral controls that disappear with the route, keeps a persistent Home button that routes to the empty route `#/` so the router default decides the home screen, and exposes `_core/onscreen_menu/items` as the dropdown action seam for non-Home feature buttons, whose modules contribute thin button adapters with numeric `data-order` values while `_core/onscreen_menu` sorts them automatically and keeps only the auth exit action local after the seam; `_core/dashboard` is the current first-party example of a route-owned wrapper that teleports into `bar_start` and then exposes ordered dashboard-local seams for dashboard-only topbar actions

JS extension hooks:

- use `space.extend(import.meta, async function name() {})` for behavior seams
- wrapped functions expose `/start` and `/end` hook points
- wrapped functions become async and should be awaited by callers
- JS hook files live at `mod/<author>/<repo>/ext/js/<extension-point>/*.js` or `*.mjs`
- JS callers name only the seam; the runtime loads hooks from the module's `ext/js/` tree automatically
- framework-backed pages expose `_core/framework/initializer.js/initialize`; use `_core/framework/head/end` when the work can stay as declarative head HTML or inline bootstrap code, and prefer the initializer `/end` hook when the setup must stay imperative instead of editing page shells
- framework-backed pages centrally grant `/enter` tab access to same-origin `/` and `/admin` windows opened through normal `target="_blank"` link clicks or `window.open(..., "_blank")`; manual browser opens such as context-menu, middle-click, or modifier-key opens are not intercepted and still route through `/enter`
- use `callJsExtensions("name", data)` only when the seam is an explicit event rather than a function lifecycle
- `_core/login_hooks` is a first-party example of an explicit event seam: it runs from `_core/framework/initializer.js/initialize/end`, checks `~/meta/login_hooks.json`, then dispatches `_core/login_hooks/first_login` once per user and `_core/login_hooks/any_login` when the authenticated shell was reached from `/login`; `_core/spaces` currently uses that first-login seam to copy or reuse the module-owned `Big Bang` onboarding space and rewrite the main-shell default route before the router falls back to `#/dashboard`
- when a feature module needs onscreen-agent prompt shaping, execution-plan validation, or other module-specific chat behavior for its own helpers, add an `ext/js/_core/onscreen_agent/...` hook from the owning module; do not hardcode feature-specific policy into `_core/onscreen_agent`

Module-owned extension metadata:

- modules may also ship lightweight metadata manifests under other `ext/` folders when that data should follow the same readable-layer permissions and same-path override rules as HTML and JS extensions
- the current first-party example is `ext/pages/*.yaml`, which the dashboard page index discovers through `/api/extensions_load`
- keep those metadata manifests small and display-oriented; they are extension-resolved module assets, not a second general-purpose storage system

Skill-context tags:

- modules may export live prompt-skill context through hidden `<x-skill-context>` elements anywhere in mounted DOM
- skill discovery unions the current document's `tag` and `tags` values from those elements each time a skill catalog, just-loaded block, or explicit skill load is resolved
- modules own the actual tag names they emit; the framework does not reserve a hardcoded route or surface tag registry
- current first-party examples are `agent` from the overlay, `admin` from the admin shell, router-owned tags such as `route:<current-path>`, and feature-owned state tags such as `space:open`
- Alpine attribute binding on `<x-skill-context>` is the normal way to make tags follow live routed or store state

Resolution and overrides:

- `/api/extensions_load` resolves extension files from the accessible `L0 -> L1 -> L2` inheritance chain
- uncached HTML `<x-extension>` lookups batch until the next animation frame by default; frontend constant `HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS` in `app/L0/_all/mod/_core/framework/js/extensions.js` adds an extra wait window before that frame-aligned flush
- JS extension hooks do not use that wait window; their lookup requests go out immediately because the wrapped calls await them directly
- `maxLayer` constrains only module and extension resolution
- identical module-relative extension file paths override lower-ranked layers
- different filenames under the same extension point compose together
- prefer additive composition before full same-path replacement

`<x-component>` contract:

- components may be full HTML documents or fragments
- the loader mounts styles, module scripts, and body nodes, then recursively loads nested `<x-component>` tags
- component HTML should stay declarative and bind to stores instead of carrying dense inline logic
- import a feature's store module in the component that owns the feature, not in unrelated parent shells

## Store And Runtime Model

The default frontend pattern is Alpine plus store-backed modules.

Ownership split:

- component HTML owns structure and Alpine bindings
- stores own state, persistence, async work, server calls, and orchestration
- module utilities own rendering helpers, transforms, and protocol logic that would make the store too dense
- `space` owns shared runtime APIs and explicit cross-feature namespaces

Store guidance:

- create stores with `space.fw.createStore(name, model)` on framework-backed pages
- use `init()` for one-time startup and `mount(refs)` plus `unmount()` for DOM-bound lifecycle
- pass DOM references with `x-ref`; do not make stores scan the document when direct refs will do
- gate store-dependent UI with `x-data` plus `template x-if="$store.<name>"`
- keep store names aligned with the exported binding and the `$store.<name>` key

Runtime guidance:

- framework-backed pages that boot through `/mod/_core/framework/js/initFw.js` already initialize the runtime before feature modules mount
- `globalThis.space` is scoped to the current window or iframe only; do not publish it into other browsing contexts
- use `space.api` for authenticated backend calls
- use `space.api.folderDownloadUrl(...)` when a folder download should stay as a browser attachment instead of fetching the archive blob into frontend memory
- first-party framework, shell, skill-helper, and bundled demo assets required for normal app use must be local `/mod/...` files, server page assets, or inline code; do not load required scripts, styles, fonts, images, or other framework assets from CDNs
- keep feature-owned runtime namespaces under `space` explicit and narrow; `_core/spaces` owns `space.current` for current-space widget authoring, compact widget catalog discovery, widget-definition reads that expose plain metadata plus numbered renderer lines directly in the response, live rendered-widget HTML inspection through `seeWidget(...)`, widget patch helpers, explicit widget reload checks, compact widget write results, post-write transient envelopes that carry both stripped rendered HTML and numbered source readback, live widget-state descriptors including render health, and batch layout or toggle or removal helpers plus `space.spaces` for persisted space CRUD, loaded-space collections, lower-level widget or folder-copy duplication or storage helpers, and spaces-owned prompt context injection that is limited to current-space agent instructions while widget workflow guidance and catalog discovery stay tool-driven, `_core/onscreen_agent` owns `space.onscreenAgent` for overlay display control plus both normal prompt submission and guarded preset-button prompt submission, and agent surfaces publish the active thread snapshot at `space.chat`, including the non-persisted `space.chat.transient` registry for mutable prompt context blocks plus a prepared-prompt contract where system prompt text comes first, optional example user or assistant messages follow before live history, real human user turns are framed as `_____user`, framework-generated follow-up turns are framed as `_____framework`, and mutable runtime context is emitted as a separate trailing `_____transient` message
- shared visual helpers may publish small reusable UI entry points under `space.visual`; the current shared selector contract is `_core/visual/icons/icon-color-selector.js`, which registers `space.visual.openIconColorSelector(options)` after that module is imported
- use `space.api.userSelfInfo()` as the canonical browser-side identity snapshot; it returns `{ username, fullName, groups, managedGroups }`, and frontend code should derive writable app roots from that data plus the standard layer rules
- use `space.config` for frontend reads of backend parameters that were explicitly marked `frontend_exposed`
- use `space.utils.markdown.render(text, target)` for lightweight shared markdown rendering into a `.markdown` wrapper and `space.utils.markdown.parseDocument(...)` for frontmatter parsing; keep feature-local presentation in the owning module's CSS
- use `space.utils.yaml.parse(...)` and `space.utils.yaml.stringify(...)` for frontend YAML parsing and serialization owned by browser modules; this runtime surface is backed by the shared project-owned lightweight YAML utility in `_core/framework/js/yaml-lite.js`, which the server also imports directly so nested maps lists block scalars and standard YAML quoting stay consistent across both runtimes
- framework-managed external `fetch(...)` calls and `space.fetchExternal(...)` should prefer a direct browser request first; if the direct cross-origin request fails and the `/api/proxy` retry succeeds, the runtime should remember that origin in memory and route later requests for the same origin through the backend immediately, and frontend code should not hardcode third-party CORS proxy services because that fallback is already owned by the runtime
- online-by-nature features such as API LLM providers, model downloads, external embeds, market or weather widgets, feeds, and user-authored remote fetches may still depend on the internet, but they must fail as feature-level online work rather than blocking framework boot or shell rendering
- browser storage is for small non-authoritative UI state; persistent user state belongs in app files or explicit backend APIs

## Visual Direction

Space Agent frontend work should look like one deliberate system rather than a mix of unrelated component-library defaults.

- minimal first: solve hierarchy with spacing, alignment, type scale, and one strong surface before adding extra chrome
- use the semantic color tokens from `app/L0/_all/mod/_core/framework/css/colors.css`
- use the shared visual system in `app/L0/_all/mod/_core/visual/` before inventing feature-local backgrounds, buttons, dialogs, or menus
- modal chrome should stay compact and understated across the app; prefer the shared flatter dialog-button treatment over oversized pill buttons or feature-local modal button restyling
- when a modal has long content plus footer actions, keep the header and footer outside the scroll area and reuse the shared `_core/visual/forms/dialog.css` shell classes instead of making the whole dialog card scroll
- keep the dark space direction calm and readable; avoid noisy sci-fi chrome and neon overload
- if a style pattern appears in more than one place, move it into `_core/visual`
- public shells that cannot load authenticated `/mod/...` assets should keep mirrored local assets aligned with the shared system rather than re-inventing a second design language

Detailed visual subsystem rules now live in `app/L0/_all/mod/_core/visual/AGENTS.md`.

## App Development Principles

- build new first-party features as modules under `app/L0/_all/mod/_core/<feature>/`
- treat page shells as extension roots, not as the application body
- keep extension files thin and keep real implementation in ordinary module files
- if another feature needs to modify owned behavior, expose a seam in the owner instead of reaching into private internals
- extend the onscreen overlay through the JS seams documented in `_core/onscreen_agent/AGENTS.md` instead of patching `store.js`, `prompt.js`, `skills.js`, or `api.js` from another module
- when a style, helper, or runtime contract will be reused by multiple modules, move it into `_core/visual`, `_core/framework`, or another clearly shared owning module
- do not grow `server/pages/*.html` beyond shell concerns when modules and extension anchors can own the composition
- do not request server-side endpoints, page-shell logic, or auth-service changes for frontend features unless the browser truly cannot enforce the needed boundary safely
- do not build new repo-owned first-party app features directly inside transient `L1` or `L2` customware

## Current Major Module Owners

- `framework/` owns frontend bootstrap and runtime primitives; see `app/L0/_all/mod/_core/framework/AGENTS.md`
- `login_hooks/` owns frontend-only authenticated bootstrap hooks for first-login and same-origin `/login` arrival events, plus the client-owned `~/meta/login_hooks.json` marker and the shared first-login onboarding seam used by feature modules such as `_core/spaces`; see `app/L0/_all/mod/_core/login_hooks/AGENTS.md`
- `router/` owns the authenticated app shell, routing, and routed extension anchors; see `app/L0/_all/mod/_core/router/AGENTS.md`
- `dashboard/` owns the routed dashboard shell and its dashboard-local extension seam; see `app/L0/_all/mod/_core/dashboard/AGENTS.md`
- `dashboard_welcome/` owns the dismissible dashboard welcome panel and bundled demo spaces; see `app/L0/_all/mod/_core/dashboard_welcome/AGENTS.md`
- `documentation/` owns the supplemental documentation tree, the documentation skill that carries its compact docs map, and the focused docs helper used by the onscreen agent; see `app/L0/_all/mod/_core/documentation/AGENTS.md`
- `agent/` owns the routed agent information page, its local avatar-card styling, and the user-local personality include editor for `~/conf/personality.system.include.md`; see `app/L0/_all/mod/_core/agent/AGENTS.md`
- `file_explorer/` owns the reusable app-file browser component, routed Files page, dashboard page manifest, and routed header-menu item; see `app/L0/_all/mod/_core/file_explorer/AGENTS.md`
- `promptinclude/` owns readable prompt-include discovery through `file_paths` plus the onscreen-agent hooks that inject stable prompt-include instructions into the system prompt, append readable `*.system.include.md` file bodies there, and inject discovered `*.transient.include.md` file bodies into transient context; see `app/L0/_all/mod/_core/promptinclude/AGENTS.md`
- `visual/` owns the shared visual system, reusable presentation primitives, and shared icon-selection modal helpers; see `app/L0/_all/mod/_core/visual/AGENTS.md`
- `webllm/` owns the unlisted routed WebLLM browser-inference test surface, its route-local worker, and its vendored WebLLM browser runtime; see `app/L0/_all/mod/_core/webllm/AGENTS.md`
- `huggingface/` owns the dashboard-listed Local LLM page, the routed Hugging Face Transformers.js browser-inference test surface, its shared browser-context manager and worker used by local admin or onscreen chat, and its vendored local browser-runtime shim; see `app/L0/_all/mod/_core/huggingface/AGENTS.md`
- `admin/` owns the firmware-backed admin shell, panels, and admin-specific skills/runtime glue; see `app/L0/_all/mod/_core/admin/AGENTS.md`
- `admin/views/agent/` owns the admin-side agent surface; see `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `admin/views/files/` owns the admin Files tab adapter that mounts `_core/file_explorer`; see `app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `admin/views/modules/` owns the firmware-backed modules panel; see `app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`
- `onscreen_agent/` owns the floating routed overlay agent; see `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `onscreen_menu/` owns the routed shell menu extension and feature-owned item seam; see `app/L0/_all/mod/_core/onscreen_menu/AGENTS.md`
- `time_travel/` owns the routed Time Travel page for paginated writable-layer history, repository selection, file filters, diffs, previewed travel, and revert actions; see `app/L0/_all/mod/_core/time_travel/AGENTS.md`
- `spaces/` owns the routed spaces canvas, first-login onboarding-space template bootstrap, empty-canvas prompt, widget SDK and widget-size ceilings, and persisted centered-coordinate space runtime plus dashboard-facing space metadata such as title, icon, color, and agent instructions; see `app/L0/_all/mod/_core/spaces/AGENTS.md`
- `pages/` owns `ext/pages/*.yaml` manifest discovery and the dashboard-facing secondary panels row; see `app/L0/_all/mod/_core/pages/AGENTS.md`

## Guidance

- keep root HTML shells thin and static; session gating belongs in the server router, not in inline frontend boot code
- cache empty extension lookups as valid results; a missing extension point should not cause repeated polling
- because extension lookups are cached in memory, adding new `ext/html/...` or `ext/js/...` files often requires a refresh before the running page discovers them
- browser-side file changes still require a manual browser refresh; live reload is not wired into the app runtime yet
- when you add or change a stable app seam, update the owning local doc and this file if the app-wide composition model changed
