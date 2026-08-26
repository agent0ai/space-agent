# AGENTS

## Purpose

`app/` is the primary Space Agent runtime.

Keep agent orchestration, prompt construction, tool flow, state management, user interaction, and optimistic UX in the browser whenever possible. Server-backed work in this tree should be browser clients for explicit server APIs, not server-side orchestration leaking into the frontend.

Frontend-first policy:

- default to solving product and workflow behavior in `app/`
- do not propose or implement backend edits just because they feel cleaner from a traditional full-stack perspective
- only push behavior into the backend when the browser cannot safely enforce it because other users, shared data, auth boundaries, or runtime integrity would otherwise be at risk
- if such a backend change seems necessary and the user did not explicitly request backend work, stop and ask for permission first, explaining why frontend-only behavior would be insufficient

This is a top-level DOX child doc. It owns app-wide architecture, composition rules, and development principles. Detailed module behavior belongs in deeper module-local docs.

Documentation is top priority for this area. After any change under `app/` or any app-facing contract change owned here, update this file, the closest owning module `AGENTS.md` files, and the relevant supplemental docs under `_core/documentation/docs/` in the same session before finishing.

## Ownership

- Owns the documentation and operating contract for `/app/`.
- Direct child DOX docs listed below own their narrower subtrees.

## Local Contracts

### Structure

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
- `agent-chat/`: headless shared chat helpers that belong to first-party agent features rather than the platform layer, currently including repeated-assistant-message evaluation helpers and hook implementations reused by overlay and admin chat
- `login_hooks/`: headless authenticated-bootstrap lifecycle hooks for first-login and same-origin `/login` arrival events, with a client-owned `~/meta/login_hooks.json` marker and feature-owned onboarding hooks such as the spaces module's first-login `Big Bang` onboarding-space bootstrap
- `visual/`: shared visual language, canvas, chrome, buttons, dialog helpers, conversation rendering primitives, and reusable authenticated-app imagery under `visual/res/`; pre-auth `/login` and `/enter` keep their mirrored astronaut asset under `server/pages/res/`
- `router/`: root routed shell for the authenticated app; route-level frame width, height or scroll policy, the shared shell-owned top-clearance budget, and other shell-owned layout overrides belong here rather than in feature modules, while routed pages own their own vertical spacing, any route-specific bottom breathing room, and local card padding but should avoid shell-compensation horizontal gutters at the route root
- `admin/`: firmware-backed admin shell and panels, including a mirrored `[id="_core/onscreen_menu/bar_start"]` inject host above admin tab content so embedded routed surfaces can reuse their existing injected controls inside `/admin`
- `agent/`: routed first-party agent information and user-local personality include editor, kept self-contained inside the module and advertised to the dashboard through `ext/panels/agent.yaml`
- `agent_prompt/`: headless shared prepared-prompt runtime reused by first-party agent surfaces
- `user/`: routed first-party account settings page that edits `~/user.yaml` directly for `full_name`, keeps password rotation server-owned through `password_change`, and advertises itself through `ext/panels/user.yaml`
- `user_crypto/`: headless per-user encryption helper that restores unlock state from login bootstrap, per-tab `sessionStorage`, and one encrypted `localStorage` blob protected by a session-derived backend key from `/api/user_crypto_session_key`, then exposes `space.utils.userCrypto` for small encrypted user secrets while short-circuiting to plaintext pass-through in `SINGLE_USER_APP=true`
- `file_explorer/`: reusable app-file browser component, routed Files page, dashboard panel manifest, and routed header-menu item
- `documentation/`: supplemental agent-facing documentation docs, the focused-read documentation helper, and the documentation skill that carries the top-level docs map
- `memory/`: headless agent-memory policy module that auto-loads a top-level skill teaching prompt-include-backed user memory under `~/memory/behavior.system.include.md`, `~/memory/memories.transient.include.md`, and other `~/memory/*.transient.include.md` files
- `panels/`: headless panel-manifest discovery plus the dashboard-injected Panels section, backed by permission-aware `ext/panels/*.yaml` metadata discovered through the app-file APIs and batch-read through the shared frontend file runtime
- `promptinclude/`: headless promptinclude discovery and onscreen-agent prompt injection for readable `*.system.include.md` and `*.transient.include.md` app files
- `onscreen_agent/`: floating routed overlay agent and the first-party user-facing chat runtime
- `onscreen_menu/`: reserved routed shell header bar, Home shortcut to the empty default route, left and right shell-control seams, and `_core/onscreen_menu/items` dropdown action seam
- `open_router/`: headless OpenRouter request-policy module that extends the admin and onscreen API transport seams instead of hardcoding provider-specific headers into the chat runtimes
- `web_browsing/`: browser-surface module that contributes a Browser dropdown action, mounts draggable, minimizable, resizable popup browser windows, and defines placement-generic `<x-browser>` elements that can also live inside widgets or other screen DOM; the same element uses an iframe fallback in browser sessions and a DOM-backed desktop `<webview>` in the packaged host, supports optional `controls="true"` address-bar chrome, registers every surface under a unique `browser-N` id exposed through the numeric-id `space.browser` runtime, includes in-app interception of `_blank` or `window.open(...)` requests back into new modals, persists only popup-window geometry across reloads, tracks direct surface focus for prompt-time browser content, and gates app-side browser diagnostics through a shared browser log level that defaults to `error`
- `skillset/`: first-party shared skill packs plus browser helper scripts and shared browser-side skill discovery helpers used by the onscreen and admin agents
- `webllm/`: unlisted routed browser-only WebLLM test surface with a module-local worker, vendored browser runtime, compact searchable prebuilt model loading, expert-only compiled custom model loading, and simple throughput reporting
- `huggingface/`: dashboard-listed Local LLM page backed by a routed browser-only Hugging Face Transformers.js test surface, with a module-local singleton runtime manager and worker, direct Hub model loading, a vendored local browser runtime for upstream testing, shared saved-model state and browser-wide last-loaded selection reused by the admin and onscreen agents in the same browser context, and simple throughput reporting
- `time_travel/`: routed writable-layer history surface that defaults to the authenticated user's local Git commits, can switch to write-accessible `L1` or `L2` history repositories through a permission-aware picker, filters by changed file, opens per-file diffs, and calls the server rollback or revert APIs after explicit confirmation
- `dashboard/`, `dashboard_welcome/`, and `spaces/`: current routed feature surfaces and dashboard-injected surfaces under the router; `_core/dashboard` also injects a route-owned control cluster into `[id="_core/onscreen_menu/bar_start"]` through the framework's delayed-target `x-inject` helper, exposes ordered dashboard-local topbar seams so feature modules can contribute dashboard-only header actions without hardcoding them into the shell, and owns the dashboard route's extra bottom breathing room under the chat overlay

### Layer Rules And Module Model

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
- skill files may use `metadata.when` as either `true` or a `{ tags: [...] }` condition to require live page-owned context tags before they become catalog-loadable, may use `metadata.loaded` as either `true` or another `{ tags: [...] }` condition to auto-inject their body into prompt context after the catalog, and may use `metadata.placement` to route that auto-included or explicitly loaded skill body into the system prompt, transient block, or standard conversation history; auto-loaded discovery is top-level only at `ext/skills/*/SKILL.md`, while nested skill ids remain loadable only through explicit routing skills or direct `space.skills.load(...)`; ordinary skills still default missing or invalid placement to `history`, but auto-loaded skills may land only in `system` or `transient`, so missing or invalid placement and explicit `history` all fall back to `system` unless they explicitly set `transient`
- when a skill belongs in prompt context, add or update its `ext/skills/.../SKILL.md` metadata; do not hardcode individual skill ids into prompt-builder JS when the shared discovery contract already covers the behavior
- the first-party `_core/memory` skill is auto-loaded into agent system prompts and standardizes persistent user memory under `~/memory/behavior.system.include.md`, `~/memory/memories.transient.include.md`, and optional extra `~/memory/*.transient.include.md` files; those files still flow through `_core/promptinclude` rather than a separate storage system
- when a stable frontend contract or workflow changes, update the relevant narrative docs under `app/L0/_all/mod/_core/documentation/docs/` alongside the owning `AGENTS.md` files
- page shells may clamp module and extension resolution with `meta[name="space-max-layer"]`; the current admin shell sets `0`
- page shells may also receive injected `meta[name="space-config"]` tags for runtime parameters marked `frontend_exposed`
- authenticated app-file APIs operate on logical app-rooted paths such as `L2/alice/user.yaml` or `/app/L2/alice/user.yaml`, and supported APIs may use `~` or `~/...` as shorthand for the authenticated user's `L2/<username>/...`
- optional `space.api.gitHistoryList(...)`, `space.api.gitHistoryDiff(...)`, `space.api.gitHistoryPreview(...)`, `space.api.gitHistoryRollback(...)`, and `space.api.gitHistoryRevert(...)` helpers expose server-owned writable-layer local history when `CUSTOMWARE_GIT_HISTORY` is enabled
- first-party application development should happen primarily under `app/L0/_all/mod/_core/`
- use `L1` and `L2` for layered overrides and customware behavior, not as the main home for repo-owned first-party features

### Frontend Composition Model

The frontend is built as a chain of shells, modules, and extension seams.

Current boot flow:

1. A page shell in `server/pages/` loads shared framework CSS and `/mod/_core/framework/js/initFw.js`.
2. The shell exposes one top-level HTML anchor in the body.
3. `initFw.js` installs the runtime, injects the framework-owned `_core/framework/head/end` HTML seam into `document.head`, runs the extensible framework bootstrap step in `_core/framework/js/initializer.js`, including framework-wide navigation interception for same-origin `_blank` app opens and best-effort current-tab cross-origin escape blocking, then installs Alpine helpers and shared bootstrap behavior.
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

### Extension And Component Contracts

There are two primary extension styles in the frontend runtime.

HTML extension anchors:

- declare a seam with `<x-extension id="some/path">`
- matching HTML files live at `mod/<author>/<repo>/ext/html/some/path/*.html`
- HTML callers name only the seam; the runtime loads `<x-extension>` tags from the module's `ext/html/` tree automatically
- thin extension files should usually mount the real component from the module root instead of containing the entire feature directly
- root page anchors such as `body/start` and `page/admin/body/start` are fixed shell contracts; module-owned anchors should be named after the owning module path, for example `_core/router/shell_start`
- `_core/framework` also creates `_core/framework/head/end` in `document.head` during bootstrap so layers can add declarative head-side tags or inline bootstraps without editing page shells or adding a JS hook
- runtime discovery watches the whole document tree, so `x-extension` and `x-component` insertions under `head` are supported the same way as body-mounted seams
- `_core/onscreen_menu` owns a reserved centered header bar from `_core/router/shell_start`; it keeps `_core/onscreen_menu/bar_start` on the left and `_core/onscreen_menu/bar_end` on the right for shell-level controls, allows route-owned `x-inject` content to target the existing left-side `[id="_core/onscreen_menu/bar_start"]` container when a feature wants ephemeral controls that disappear with the route but the shell seam may mount later, keeps a persistent Home button that routes to the empty route `#/` so the router default decides the home screen, and exposes `_core/onscreen_menu/items` as the dropdown action seam for non-Home feature buttons, whose modules contribute thin button adapters with numeric `data-order` values while `_core/onscreen_menu` sorts them automatically and keeps only the auth exit action local after the seam; `_core/dashboard` is the current first-party example of a route-owned wrapper that injects into `bar_start` and then exposes ordered dashboard-local seams for dashboard-only topbar actions
- `_core/web_browsing` is the current first-party example of a module that uses both `_core/onscreen_menu/items` and `page/router/overlay/end`: it contributes a Browser menu action at `data-order="250"`, opens a new floating browser window each time the action is used, keeps each browser surface on a unique internal `browser-N` id while the public `space.browser` runtime surface exposes numeric ids such as `1`, lets widgets or other screen DOM create registered surfaces with plain `<x-browser src="...">` markup, keeps that public runtime surface top-level and id-based only instead of exposing per-window handles, auto-settles open or state or navigation or inspection helpers internally so they can return fresh browser state snapshots without a separate `sync(...)` step while ref-targeted actions return `{ action, state }` with visible-effect flags such as `reacted`, `noObservedEffect`, `validationTextAdded`, or `domChanged`, requires navigation-capable helpers to wait for an observed browser-side navigation or loading transition before they accept a new snapshot, blocks stale old-guest bridge reads during that handoff, exposes `space.browser.setLogLevel(...)` as the runtime-side override for browser diagnostics while leaving the default app browser log level at `error`, persists each open browser window's URL, geometry, minimized state, and stacking data in browser-local storage so reloads can reopen the same window set, reuses the same viewport-fit pass for both live resize and restore so reopened windows clamp back onto the current screen when the viewport changed, and raises a focused browser window to the top of the browser stack even when the click lands inside the iframe or desktop webview page content. It spawns new windows below the fixed shell bar near the left edge of the centered router-stage column at approximately that column width while still allowing later drag movement all the way to the viewport top edge, renders popup windows through `<x-browser controls="true">` with Back, Forward, Reload, and address controls while inline surfaces may omit controls or opt in with the same attribute, keeps its page-side browsing bridge self-contained through `/mod/_core/web_browsing/browser-frame-inject.js` plus matching host helpers, and may also extend the onscreen-agent transient sections seam with a brief `currently open web browsers` status block plus prompt-time `last interacted web browser` content when the remembered interacted browser surface is still open; browser sessions render an iframe fallback inside that element, packaged desktop runs now prefer a DOM `<webview>` inside that same element so modal, widget, and other renderer-owned placement clipping stays aligned with the shell, the desktop host installs a tiny document-start browser guest kernel into the top page and all iframe descendants so shadow roots and nested documents stay crawlable later, the renderer then injects the bridge bootstrap plus an extensible guest runtime script list built through `space.extend(...)`, desktop `_blank` and `window.open(...)` requests are routed back into new in-app browser modals instead of separate OS windows, and the injected runtime must stay transport-agnostic so later browser-extension injection can reuse the same page-side request handlers while readable `content(...)` output stays in the lean typed-ref form like `[disabled muted button 18] Continue`, `[checked checkbox 7] Email updates`, `[error button 9] Delete`, or `[input text 30] Search placeholder=Hledat value=Ethereum` and omits obviously non-visible DOM or CSS-hidden content such as `hidden`, `aria-hidden`, `display:none`, `visibility:hidden|collapse`, `content-visibility:hidden`, or `opacity:0` subtrees

JS extension hooks:

- use `space.extend(import.meta, async function name() {})` for behavior seams
- wrapped functions expose `/start` and `/end` hook points
- wrapped functions become async and should be awaited by callers
- JS hook files live at `mod/<author>/<repo>/ext/js/<extension-point>/*.js` or `*.mjs`
- JS callers name only the seam; the runtime loads hooks from the module's `ext/js/` tree automatically
- framework-backed pages expose `_core/framework/initializer.js/initialize`; use `_core/framework/head/end` when the work can stay as declarative head HTML or inline bootstrap code, and prefer the initializer `/end` hook when the setup must stay imperative instead of editing page shells
- framework-backed pages centrally grant `/enter` tab access to same-origin `/` and `/admin` windows opened through normal `target="_blank"` link clicks or `window.open(..., "_blank")`, and they also intercept same-tab cross-origin `http(s)` escapes through the Navigation API `navigate` event when available plus fallback anchor or `window.open(..., "_self")` and `location`-based hooks so web runtime can move those requests into a new tab while packaged desktop runtime blocks them before the Electron main-window origin guard needs to recover; location-bar navigations and manual browser opens such as context-menu, middle-click, or modifier-key opens are not intercepted and still route through `/enter` or the host guard
- use `callJsExtensions("name", data)` only when the seam is an explicit event rather than a function lifecycle
- `_core/login_hooks` is a first-party example of an explicit event seam: it runs from `_core/framework/initializer.js/initialize/end`, checks `~/meta/login_hooks.json`, then dispatches `_core/login_hooks/first_login` once per user and `_core/login_hooks/any_login` when the authenticated shell was reached from `/login`; `_core/spaces` currently uses that first-login seam to copy or reuse the module-owned `Big Bang` onboarding space and rewrite the main-shell default route before the router falls back to `#/dashboard`
- when a feature module needs onscreen-agent prompt shaping, execution-plan validation, or other module-specific chat behavior for its own helpers, add an `ext/js/_core/onscreen_agent/...` hook from the owning module; do not hardcode feature-specific policy into `_core/onscreen_agent`

Module-owned extension metadata:

- modules may also ship lightweight metadata manifests under other `ext/` folders when that data should follow the same readable-layer permissions and same-path override rules as HTML and JS extensions
- the current first-party example is `ext/panels/*.yaml`, which the dashboard panel index discovers through `file_paths` and batch-reads through `fileRead(...)`
- keep those metadata manifests small and display-oriented; they are extension-resolved module assets, not a second general-purpose storage system

Context tags:

- modules may export live runtime context through hidden `<x-context>` elements anywhere in mounted DOM; skill filtering is one consumer of those tags
- the shared framework helper at `/mod/_core/framework/js/context.js` owns generic DOM reads of those elements through `getContexts(...)`, `getAttributeValues(...)`, `getTags(...)`, and `getContents(...)`
- skill discovery unions the current document's `data-tags` values from those elements each time a skill catalog, auto-loaded block, or explicit skill load is resolved
- the framework reserves `data-runtime` for its own hidden runtime context element; that element also emits `runtime-browser` or `runtime-app` through `data-tags`, derives packaged-app runtime from the desktop bridge or launcher runtime info before it falls back to frontend config, and leaves the rest of the feature or route tags to the owning modules
- current first-party examples are framework-owned runtime tags `runtime-browser` or `runtime-app`, `onscreen` from the overlay, `admin` from the admin shell, router-owned tags such as `route:<current-path>`, and feature-owned state tags such as `space:open` or `browser:open`
- Alpine attribute binding on `<x-context>` is the normal way to make tags follow live routed or store state

Resolution and overrides:

- `/api/extensions_load` resolves extension files from the accessible `L0 -> L1 -> L2` inheritance chain
- uncached HTML `<x-extension>` lookups batch until the next animation frame by default; frontend constant `HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS` in `app/L0/_all/mod/_core/framework/js/extensions.js` adds an extra wait window before that frame-aligned flush
- JS extension hooks do not use that wait window; their lookup requests go out immediately because the wrapped calls await them directly, but the runtime dedupes identical in-flight extension loads
- `maxLayer` constrains only module and extension resolution
- identical module-relative extension file paths override lower-ranked layers
- different filenames under the same extension point compose together
- prefer additive composition before full same-path replacement

`<x-component>` contract:

- components may be full HTML documents or fragments
- the loader mounts styles, module scripts, and body nodes, then recursively loads nested `<x-component>` tags
- concurrent scans of the same `<x-component>` target must reuse one in-flight load instead of dropping later callers, so mutation-observer rescans cannot leave a component half-hydrated
- component HTML should stay declarative and bind to stores instead of carrying dense inline logic
- import a feature's store module in the component that owns the feature, not in unrelated parent shells

### Store And Runtime Model

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
- prefer the shared `space.api` helpers over feature-local request batching; same-tick `fileRead(...)` calls coalesce automatically, preserve per-call missing-file behavior by retrying individually when a combined batch fails, and identical in-flight file, identity, and extension-load requests are deduped by the runtime
- use `space.api.folderDownloadUrl(...)` when a folder download should stay as a browser attachment instead of fetching the archive blob into frontend memory
- first-party framework, shell, skill-helper, and bundled demo assets required for normal app use must be local `/mod/...` files, server page assets, or inline code; do not load required scripts, styles, fonts, images, or other framework assets from CDNs
- keep feature-owned runtime namespaces under `space` explicit and narrow; `_core/spaces` owns `space.current` for current-space widget authoring, compact widget catalog discovery, widget-definition reads that expose plain metadata plus numbered renderer lines directly in the response, live rendered-widget HTML inspection through `seeWidget(...)`, widget patch helpers, explicit widget reload checks, camera-only viewport reposition, compact widget write results, post-write transient envelopes that carry both stripped rendered HTML and numbered source readback, live widget-state descriptors including render health, and batch layout or toggle or removal helpers plus `space.spaces` for persisted space CRUD, loaded-space collections, lower-level widget or folder-copy duplication or storage helpers, the matching reload helper that accepts `resetCamera` for single-pass onboarding example installs plus the separate current-space viewport reposition helper for camera-only rescroll, and spaces-owned prompt context injection that is limited to current-space agent instructions while widget workflow guidance and catalog discovery stay tool-driven, `_core/onscreen_agent` owns `space.onscreenAgent` for overlay display control plus both normal prompt submission and guarded preset-button prompt submission, `_core/web_browsing` owns the top-level id-based `space.browser` namespace for console-friendly registered browser-surface discovery, popup open control, close control for any surface, settled state snapshots, narrow bridge plus navigation helpers, an explicit `evaluate(...)` escape hatch for in-page JavaScript execution, convenience inspection wrappers for `dom` or `content` or `detail`, reference-targeted browser actions around the internal `browser-N` surfaces while exposing numeric ids on the public agent-facing API, and the runtime-only `setLogLevel(...)` helper for adjusting app-side browser diagnostics, without exposing per-window handles or a public `sync(...)` step because open or state or navigation or inspection or interaction helpers settle internally and mutations return fresh state snapshots, with navigation-capable helpers now waiting for observed browser-side movement before they accept the returned snapshot and refusing to trust stale old-guest bridge state during that handoff, with app-side browser logging defaulting to `error` until `setLogLevel(...)` opts into more noise, with agent-facing methods gated through one module-owned availability stub that may return a structured warning in unsupported runtimes instead of attempting partial browser-mode behavior, with readable `content(...)` output using low-token typed ref boxes such as `[link 12]`, `[button 18]`, `[image 24]`, or `[input text 30]` while also surfacing generic event-bound controls as refs, with `dom(...)` and `content(...)` accepting either `selector` or `selectors` payloads for scoped reads, and with injected browser pages currently supporting `ping`, raw `dom`, stateful reference-marked `content`, `detail`, `evaluate`, `click`, `type`, `submit`, `type_submit`, `scroll`, and navigation bridge requests, and agent surfaces publish the active thread snapshot at `space.chat`, including the current-turn `promptItems` metadata list, `readLongMessage({ id, from, to })` for trimmed prompt contributors, the non-persisted `space.chat.transient` registry for mutable prompt context blocks, the non-persisted `space.chat.skills` registry for explicitly loaded system or transient skills, and a prepared-prompt contract where system prompt text comes first, optional example user or assistant messages follow before live history, real human user turns are framed as `_____user`, framework-generated follow-up turns are framed as `_____framework`, and mutable runtime context is emitted as a separate trailing `_____transient` message
- shared visual helpers may publish small reusable UI entry points under `space.visual`; the current shared selector contract is `_core/visual/icons/icon-color-selector.js`, which registers `space.visual.openIconColorSelector(options)` after that module is imported
- use `space.api.userSelfInfo()` as the canonical browser-side identity snapshot; it returns `{ username, fullName, groups, managedGroups, sessionId, userCryptoKeyId, userCryptoState }`, and frontend code should derive writable app roots and per-session unlock behavior from that data plus the standard layer rules
- use `space.config` for frontend reads of backend parameters that were explicitly marked `frontend_exposed`
- use `space.utils.markdown.render(text, target)` for lightweight shared markdown rendering into a `.markdown` wrapper and `space.utils.markdown.parseDocument(...)` for frontmatter parsing; keep feature-local presentation in the owning module's CSS
- use `space.utils.yaml.parse(...)` and `space.utils.yaml.stringify(...)` for frontend YAML parsing and serialization owned by browser modules; this runtime surface is backed by the shared project-owned lightweight YAML utility in `_core/framework/js/yaml-lite.js`, which the server also imports directly so nested maps lists block scalars and standard YAML quoting stay consistent across both runtimes
- framework-managed external `fetch(...)` calls and `space.fetchExternal(...)` should prefer a direct browser request first; if the direct cross-origin request fails and the `/api/proxy` retry succeeds, the runtime should remember that origin in memory and route later requests for the same origin through the backend immediately, and frontend code should not hardcode third-party CORS proxy services because that fallback is already owned by the runtime
- online-by-nature features such as API LLM providers, model downloads, external embeds, market or weather widgets, feeds, and user-authored remote fetches may still depend on the internet, but they must fail as feature-level online work rather than blocking framework boot or shell rendering
- browser storage is for small non-authoritative UI state; persistent user state belongs in app files or explicit backend APIs

### Visual Direction

Space Agent frontend work should look like one deliberate system rather than a mix of unrelated component-library defaults.

- minimal first: solve hierarchy with spacing, alignment, type scale, and one strong surface before adding extra chrome
- use the semantic color tokens from `app/L0/_all/mod/_core/framework/css/colors.css`
- use the shared visual system in `app/L0/_all/mod/_core/visual/` before inventing feature-local backgrounds, buttons, dialogs, or menus
- for visual elements, treat `app/L0/_all/mod/_core/visual/AGENTS.md` as the binding guide for dialog shells, cards, buttons, popovers, and shared visual primitives
- authenticated app and mirrored public-shell surfaces use a shadowless glass treatment; do not rely on box-shadow, text-shadow, or drop-shadow for depth or emphasis
- interactive hover or focus emphasis must keep the pointer hitbox stationary across app and mirrored public-shell surfaces; use border, background, outline, or opacity changes instead of translate- or position-based lift
- authenticated app feature dialogs should default to feature-owned native `<dialog class="chat-dialog">` markup plus `_core/visual/forms/dialog.css` and `_core/visual/forms/dialog.js`; reserve `_core/framework/js/modals.js` for generic separately loaded modal documents or shared utility pickers that truly need that wrapper
- modal chrome should stay compact and understated across the app; prefer the shared flatter dialog-button treatment over oversized pill buttons or feature-local modal button restyling
- when a modal has long content plus footer actions, keep the header and footer outside the scroll area and reuse the shared `_core/visual/forms/dialog.css` shell classes instead of making the whole dialog card scroll
- keep the dark space direction calm and readable; avoid noisy sci-fi chrome and neon overload
- if a style pattern appears in more than one place, move it into `_core/visual`
- public shells that cannot load authenticated `/mod/...` assets should keep mirrored local assets aligned with the shared system rather than re-inventing a second design language

Detailed visual subsystem rules now live in `app/L0/_all/mod/_core/visual/AGENTS.md`.

### Current Major Module Owners

- `framework/` owns frontend bootstrap and runtime primitives; see `app/L0/_all/mod/_core/framework/AGENTS.md`
- `login_hooks/` owns frontend-only authenticated bootstrap hooks for first-login and same-origin `/login` arrival events, plus the client-owned `~/meta/login_hooks.json` marker and the shared first-login onboarding seam used by feature modules such as `_core/spaces`; see `app/L0/_all/mod/_core/login_hooks/AGENTS.md`
- `router/` owns the authenticated app shell, routing, and routed extension anchors; see `app/L0/_all/mod/_core/router/AGENTS.md`
- `dashboard/` owns the routed dashboard shell and its dashboard-local extension seam; see `app/L0/_all/mod/_core/dashboard/AGENTS.md`
- `dashboard_welcome/` owns the dismissible dashboard welcome panel and bundled demo spaces; see `app/L0/_all/mod/_core/dashboard_welcome/AGENTS.md`
- `documentation/` owns the supplemental documentation tree, the documentation skill that carries its compact docs map, and the focused docs helper used by the onscreen agent; see `app/L0/_all/mod/_core/documentation/AGENTS.md`
- `agent/` owns the routed agent information page, its local avatar-card styling, and the user-local personality include editor for `~/conf/personality.system.include.md`; see `app/L0/_all/mod/_core/agent/AGENTS.md`
- `file_explorer/` owns the reusable app-file browser component, routed Files page, dashboard panel manifest, and routed header-menu item; see `app/L0/_all/mod/_core/file_explorer/AGENTS.md`
- `promptinclude/` owns readable prompt-include discovery through `file_paths` plus the onscreen-agent hooks that inject stable prompt-include instructions into the system prompt, append readable `*.system.include.md` file bodies there, and inject discovered `*.transient.include.md` file bodies into transient context; see `app/L0/_all/mod/_core/promptinclude/AGENTS.md`
- `visual/` owns the shared visual system, reusable presentation primitives, and shared icon-selection modal helpers; see `app/L0/_all/mod/_core/visual/AGENTS.md`
- `webllm/` owns the unlisted routed WebLLM browser-inference test surface, its route-local worker, and its vendored WebLLM browser runtime; see `app/L0/_all/mod/_core/webllm/AGENTS.md`
- `huggingface/` owns the dashboard-listed Local LLM page, the routed Hugging Face Transformers.js browser-inference test surface, its shared browser-context manager and worker used by local admin or onscreen chat, and its vendored local browser-runtime shim; see `app/L0/_all/mod/_core/huggingface/AGENTS.md`
- `admin/` owns the firmware-backed admin shell, panels, and admin-specific skills/runtime glue; see `app/L0/_all/mod/_core/admin/AGENTS.md`
- `admin/views/agent/` owns the admin-side agent surface; see `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `admin/views/files/` owns the admin Files tab adapter that mounts `_core/file_explorer`; see `app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `admin/views/time_travel/` owns the admin Time Travel tab adapter that mounts `_core/time_travel`; see `app/L0/_all/mod/_core/admin/views/time_travel/AGENTS.md`
- `admin/views/modules/` owns the firmware-backed modules panel; see `app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`
- `onscreen_agent/` owns the floating routed overlay agent; see `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `onscreen_menu/` owns the routed shell menu extension and feature-owned item seam; see `app/L0/_all/mod/_core/onscreen_menu/AGENTS.md`
- `time_travel/` owns the routed Time Travel page for paginated writable-layer history, repository selection, file filters, diffs, previewed travel, and revert actions; see `app/L0/_all/mod/_core/time_travel/AGENTS.md`
- `spaces/` owns the routed spaces canvas, first-login onboarding-space template bootstrap, empty-canvas prompt, widget SDK and widget-size ceilings, the default spaces camera contract that opens occupied cells horizontally centered with the top-most occupied row on the first visible grid row below the fixed shell bar with `0.5em` breathing room and only clamps panning once an outer occupied cell would leave view, and persisted centered-coordinate space runtime plus dashboard-facing space metadata such as title, icon, color, and agent instructions; see `app/L0/_all/mod/_core/spaces/AGENTS.md`
- `panels/` owns `ext/panels/*.yaml` manifest discovery and the dashboard-facing secondary panels row; see `app/L0/_all/mod/_core/panels/AGENTS.md`

## Work Guidance

### Child DOX Guidance

All app child docs at the same depth should use the same DOX backbone:

- `Purpose`
- `Ownership`
- `Local Contracts`
- `Work Guidance`
- `Verification`
- `Child DOX Index`

Required contract coverage for app docs:

- entry points and extension seams: page anchors, routed views, `ext/html/` and `ext/js/` files, module-owned extension metadata folders such as `ext/panels/`, exported runtime namespaces, iframe boundaries, and route mounts
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

When a module later grows multiple independently owned sub-areas, create or update the child DOX docs and refresh the parent's `Child DOX Index` before spreading implementation detail across files.

### App Development Principles

- build new first-party features as modules under `app/L0/_all/mod/_core/<feature>/`
- treat page shells as extension roots, not as the application body
- keep extension files thin and keep real implementation in ordinary module files
- if another feature needs to modify owned behavior, expose a seam in the owner instead of reaching into private internals
- extend the onscreen overlay through the JS seams documented in `_core/onscreen_agent/AGENTS.md` instead of patching `store.js`, `prompt.js`, `skills.js`, or `api.js` from another module
- when a style, helper, or runtime contract will be reused by multiple modules, move it into `_core/visual`, `_core/framework`, or another clearly shared owning module
- do not grow `server/pages/*.html` beyond shell concerns when modules and extension anchors can own the composition
- do not request server-side endpoints, page-shell logic, or auth-service changes for frontend features unless the browser truly cannot enforce the needed boundary safely
- do not build new repo-owned first-party app features directly inside transient `L1` or `L2` customware

### Local Work Rules

- keep root HTML shells thin and static; session gating belongs in the server router, not in inline frontend boot code
- cache empty extension lookups as valid results; a missing extension point should not cause repeated polling
- because extension lookups are cached in memory, adding new `ext/html/...` or `ext/js/...` files often requires a refresh before the running page discovers them
- browser-side file changes still require a manual browser refresh; live reload is not wired into the app runtime yet
- when you add or change a stable app seam, update the owning local doc and this file if the app-wide composition model changed

## Verification



## Child DOX Index

- `/app/L0/_admin/mod/_core/overlay_agent/AGENTS.md` - L0/_admin/mod/_core/overlay_agent/ owns admin-only skill content for the onscreen overlay agent.
- `/app/L0/_all/mod/_core/admin/AGENTS.md` - _core/admin/ owns the firmware-backed admin area.
- `/app/L0/_all/mod/_core/agent-chat/AGENTS.md` - _core/agent-chat/ owns shared feature-level chat helpers reused by first-party agent surfaces.
- `/app/L0/_all/mod/_core/agent/AGENTS.md` - _core/agent/ owns the routed browser page for basic agent information and personal agent settings.
- `/app/L0/_all/mod/_core/agent_prompt/AGENTS.md` - _core/agent_prompt/ owns the shared prepared-prompt runtime used by first-party agent surfaces.
- `/app/L0/_all/mod/_core/dashboard/AGENTS.md` - _core/dashboard/ owns the default routed dashboard view.
- `/app/L0/_all/mod/_core/dashboard_welcome/AGENTS.md` - _core/dashboard_welcome/ owns the dashboard-injected welcome surface.
- `/app/L0/_all/mod/_core/documentation/AGENTS.md` - _core/documentation/ owns the supplemental agent-facing documentation module.
- `/app/L0/_all/mod/_core/file_explorer/AGENTS.md` - _core/file_explorer/ owns the first-party app file explorer.
- `/app/L0/_all/mod/_core/framework/AGENTS.md` - _core/framework/ is the shared frontend platform layer.
- `/app/L0/_all/mod/_core/huggingface/AGENTS.md` - _core/huggingface/ owns the first-party browser inference test surface for Hugging Face Transformers.js.
- `/app/L0/_all/mod/_core/login_hooks/AGENTS.md` - _core/login_hooks/ owns frontend-only login lifecycle hooks for authenticated framework-backed pages.
- `/app/L0/_all/mod/_core/memory/AGENTS.md` - _core/memory/ owns the first-party persistent-memory workflow for agent surfaces.
- `/app/L0/_all/mod/_core/onscreen_agent/AGENTS.md` - _core/onscreen_agent/ owns the floating routed overlay agent.
- `/app/L0/_all/mod/_core/onscreen_menu/AGENTS.md` - _core/onscreen_menu/ owns the viewport-fixed routed header bar, page menu, and Home shortcut.
- `/app/L0/_all/mod/_core/open_router/AGENTS.md` - _core/open_router/ owns OpenRouter-specific frontend request customization.
- `/app/L0/_all/mod/_core/panels/AGENTS.md` - _core/panels/ owns the panel-manifest index used by the dashboard.
- `/app/L0/_all/mod/_core/promptinclude/AGENTS.md` - _core/promptinclude/ owns prompt-include discovery for the onscreen agent.
- `/app/L0/_all/mod/_core/router/AGENTS.md` - _core/router/ owns the authenticated root app shell.
- `/app/L0/_all/mod/_core/skillset/AGENTS.md` - _core/skillset/ owns first-party reusable skill packs, skill-local browser helper modules stored inside those skill folders, shared vendored browser assets reused by those helpers, and the shared browser-side skill discovery helper used by both agent surfaces.
- `/app/L0/_all/mod/_core/spaces/AGENTS.md` - _core/spaces/ owns the main user-facing spaces canvas.
- `/app/L0/_all/mod/_core/time_travel/AGENTS.md` - _core/time_travel/ owns the user-facing Time Travel page for writable-layer local history.
- `/app/L0/_all/mod/_core/user/AGENTS.md` - _core/user/ owns the routed browser page for user account settings.
- `/app/L0/_all/mod/_core/user_crypto/AGENTS.md` - _core/user_crypto/ owns session-scoped frontend decryption state for user-encrypted values.
- `/app/L0/_all/mod/_core/visual/AGENTS.md` - _core/visual/ owns the shared Space Agent visual system.
- `/app/L0/_all/mod/_core/web_browsing/AGENTS.md` - _core/web_browsing/ owns the browser overlay module and the generic <x-browser> browser surface element.
- `/app/L0/_all/mod/_core/webllm/AGENTS.md` - _core/webllm/ owns the first-party browser inference test surface for WebLLM.
