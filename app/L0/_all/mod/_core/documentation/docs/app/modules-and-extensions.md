# Modules And Extensions

This doc covers how browser code is delivered and composed.

## Primary Sources

- `app/AGENTS.md`
- `app/L0/_all/mod/_core/admin/AGENTS.md`
- `app/L0/_all/mod/_core/agent/AGENTS.md`
- `app/L0/_all/mod/_core/dashboard/AGENTS.md`
- `app/L0/_all/mod/_core/file_explorer/AGENTS.md`
- `app/L0/_all/mod/_core/framework/AGENTS.md`
- `app/L0/_all/mod/_core/login_hooks/AGENTS.md`
- `app/L0/_all/mod/_core/open_router/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_menu/AGENTS.md`
- `app/L0/_all/mod/_core/promptinclude/AGENTS.md`
- `app/L0/_all/mod/_core/router/AGENTS.md`
- `app/L0/_all/mod/_core/time_travel/AGENTS.md`
- `server/lib/customware/AGENTS.md`
- `server/api/AGENTS.md`

## Module Paths

Browser modules are namespaced as:

```txt
mod/<author>/<repo>/...
```

Examples:

- `/mod/_core/agent/view.html`
- `/mod/_core/framework/js/initFw.js`
- `/mod/_core/router/view.html`
- `/mod/_core/documentation/documentation.js`
- `/mod/_core/file_explorer/view.html`
- `/mod/_core/huggingface/view.html`
- `/mod/_core/webllm/view.html`

The backend resolves those requests through layered customware inheritance, so the same `/mod/...` URL may be backed by `L0`, `L1`, or `L2`.

## Router Path Resolution

The authenticated router is hash-based.

Important route rules:

- `#/agent` -> `/mod/_core/agent/view.html`
- `#/dashboard` -> `/mod/_core/dashboard/view.html`
- `#/file_explorer` -> `/mod/_core/file_explorer/view.html`
- `#/huggingface` -> `/mod/_core/huggingface/view.html`
- `#/time_travel` -> `/mod/_core/time_travel/view.html`
- `#/webllm` -> `/mod/_core/webllm/view.html`
- `#/author/repo/path` -> `/mod/author/repo/path/view.html`
- if the last route segment already ends in `.html`, the router resolves directly to that file under `/mod/...`

The main router helper surface is published on `space.router` and Alpine `$router`.

## HTML Extension Anchors

HTML extension seams use:

```html
<x-extension id="some/path"></x-extension>
```

Resolution rules:

- the caller names only the seam
- matching files live under `mod/<author>/<repo>/ext/html/some/path/*.html`
- extension files should stay thin and normally mount the real component or view
- `_core/framework` also injects `_core/framework/head/end` into `document.head` during bootstrap so layers can add declarative head-side tags or inline bootstraps without editing page shells
- dynamic extension and component discovery watches the whole document tree, so seams and components inserted under `head` are hydrated the same way as body-mounted ones

Important shared router seams include:

- `_core/router/shell_start`
- `_core/router/shell_end`
- `page/router/route/start`
- `page/router/route/end`
- `page/router/overlay/start`
- `page/router/overlay/end`

The authenticated router backdrop comes from `_core/visual` and stays on fixed viewport layers behind the routed shell, so route-content scrolling should happen inside `.router-stage` without moving the shared canvas gradient or starfield.

Current first-party shell extension example:

- `_core/onscreen_menu` mounts into `_core/router/shell_start`, owns the viewport-fixed centered routed header bar, keeps `_core/onscreen_menu/bar_start` on the left and `_core/onscreen_menu/bar_end` on the right for shell-level controls, allows route-owned teleported controls to target the existing `[id="_core/onscreen_menu/bar_start"]` container, keeps a Home button that routes to the empty default route `#/`, exposes `_core/onscreen_menu/items` for feature-owned dropdown menu buttons, sorts contributed controls or items by numeric `data-order`, renders only the auth-dependent Logout or Leave action locally after the dropdown seam, and styles the shell as a compact glass bar that stays flush to the top edge with only the bottom corners rounded while normal routed pages clear it through the router-owned top inset
- route-owned teleported controls in that left header container should generally inherit the bar's overall chrome and avoid adding their own nested button borders or filled backgrounds unless a feature has a strong reason to call out one control
- `_core/dashboard` now defines one route-owned teleported wrapper in that same left header container and exposes ordered `_core/dashboard/topbar_primary` and `_core/dashboard/topbar_secondary` seams inside it, so dashboard-only controls such as the spaces create action or the welcome restore toggle stay route-scoped without teaching `_core/onscreen_menu` about dashboard features
- `_core/agent`, `_core/file_explorer`, `_core/time_travel`, and `_core/admin` each contribute their own routed header-menu dropdown item through `_core/onscreen_menu/items` with `data-order` values `100`, `200`, `300`, and `400` instead of being hardcoded into the menu shell
- `_core/spaces` now defines its current-space control cluster directly inside the spaces route and teleports it into `[id="_core/onscreen_menu/bar_start"]`; that keeps the controls route-owned so they are removed when the route unmounts, while still keeping Back, the space-title toggle, Rearrange, and a confirmed clear-all-widgets trash action together in shared shell chrome, with the metadata editor popover anchored to the title button instead of owning a separate fixed page overlay
- `_core/time_travel` keeps its page title copy inside the routed page but teleports its route-owned Refresh and repository-picker controls into `[id="_core/onscreen_menu/bar_start"]`, keeping those controls in shared shell chrome without turning them into persistent shell extensions
- the `_core/admin` shell keeps its admin tabs in the left-pane topbar and ends that topbar with a leave-admin icon button that returns to the current iframe URL

## JavaScript Extension Hooks

Behavior seams use `space.extend(import.meta, async function name() {})`.

Rules:

- the wrapped function becomes async
- hooks resolve under `mod/<author>/<repo>/ext/js/<extension-point>/*.js` or `*.mjs`
- wrapped functions expose `/start` and `/end` hook points
- framework-backed page boot also creates the `_core/framework/head/end` HTML seam in `document.head`; use that seam when the integration can stay declarative, and use `_core/framework/initializer.js/initialize/end` when the setup must stay imperative
- feature-specific prompt or execution behavior for the onscreen agent should be supplied from the owning module through `_core/onscreen_agent/...` extension seams, not hardcoded into `_core/onscreen_agent`
- headless helper modules are valid first-party modules too: `_core/promptinclude` has no route or UI, but it extends `_core/onscreen_agent/llm.js/buildOnscreenAgentSystemPromptSections` and `_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections` to auto-inject readable `**/*.system.include.md` files into the overlay system prompt and readable `**/*.transient.include.md` files into the overlay transient context
- `_core/login_hooks` is another headless helper module: it extends `_core/framework/initializer.js/initialize/end`, checks for the client-owned `~/meta/login_hooks.json` marker, dispatches `_core/login_hooks/first_login` once when that marker is absent, and dispatches `_core/login_hooks/any_login` when the authenticated shell was reached directly from `/login`; `_core/spaces` currently consumes `_core/login_hooks/first_login` through `ext/js/_core/login_hooks/first_login/big-bang-space.js` to copy or reuse the module-owned `Big Bang` onboarding space and rewrite the root-shell default route before dashboard loads
- `_core/open_router` is a headless provider-policy module: it extends `_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest/end` and `_core/admin/views/agent/api.js/prepareAdminAgentApiRequest/end`, detects when API mode targets an OpenRouter upstream endpoint, and applies the OpenRouter-specific request headers there instead of hardcoding them inside the chat runtimes

Uncached HTML `<x-extension>` lookups are grouped before they hit `/api/extensions_load`:

- by default the frontend flushes the lookup queue on the next animation frame
- frontend constant `HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS` in `app/L0/_all/mod/_core/framework/js/extensions.js` adds an extra wait window in milliseconds before that frame-aligned flush
- when a frame does not arrive, the frontend falls back to a short timeout so the queue still drains

JS hook lookups do not use that frame wait window. Hook callers await them directly, so the frontend requests JS extension paths immediately instead of delaying them for batching.

## Extension Metadata Manifests

Not every extension-resolved file is an HTML adapter or JS hook.

Modules may also store lightweight metadata manifests under other `ext/` folders when that data should follow the same readable-layer permissions and same-path override rules as HTML and JS extensions.

Current first-party example:

- `_core/pages` discovers dashboard page manifests from `mod/<author>/<repo>/ext/pages/*.yaml` through `extensions_load` and renders them as the dashboard's secondary `PANELS` chip row beneath the spaces launcher instead of as primary content cards
- `_core/agent` publishes `ext/pages/agent.yaml` so the dashboard can launch the routed agent settings page without hardcoding it into dashboard or router; that route stays self-contained inside the module, keeps the astronaut info card, exposes only the external repo CTA, and edits the raw `~/conf/personality.system.include.md` prompt-include file
- `_core/file_explorer` publishes `ext/pages/file_explorer.yaml` for the `#/file_explorer` Files route and also exposes `component.html` so the admin Files tab can reuse the same app-file browser without owning a second implementation
- `_core/huggingface` publishes `ext/pages/huggingface.yaml` so the dashboard can launch the `Local LLM` page backed by the routed Hugging Face browser runtime
- `_core/time_travel` publishes `ext/pages/time_travel.yaml` for the `#/time_travel` route, where the current user starts on their own `~` Git history, can pick another writable `L1` or `L2` history repository, page and filter commits, inspect file diffs, travel back to a commit, or revert a commit as a new change
- `_core/webllm` still has a direct manual `#/webllm` route, but it does not publish a dashboard page manifest
- each page manifest defines display metadata such as `name`, `path`, optional `description`, optional `icon`, and optional `color`
- page `path` values may be shorthand route paths such as `huggingface`, prefixed hash paths such as `#/huggingface`, or direct `/mod/...` HTML paths such as `/mod/_core/huggingface/view.html`
- page manifests are module assets, not writable app-file state

## `<x-skill-context>`

Modules may also export live skill-filter tags with hidden helper elements:

```html
<x-skill-context tag="agent"></x-skill-context>
<x-skill-context tag="admin"></x-skill-context>
<x-skill-context :tags="$store.router.current?.path ? `route:${$store.router.current.path}` : ''"></x-skill-context>
```

Rules:

- these elements are non-visual helpers, not user-facing UI
- the current document's `tag` and `tags` values are unioned at skill-discovery time
- skill frontmatter may use `metadata.when.tags` to require those tags before catalog inclusion or explicit load eligibility
- skill frontmatter may use `metadata.just_loaded` as either `true` or another `{ tags: [...] }` condition for automatic prompt injection after the catalog
- modules own the actual tag names they emit; there is no separate centralized registry in the framework
- Alpine-bound attributes are the normal way to keep those tags synced with routed or store-owned state

## `<x-component>`

The component loader accepts both full HTML documents and fragments.

Behavior:

- styles and stylesheets are appended to the mount target
- module scripts are loaded via dynamic `import()`
- nested `<x-component>` tags are loaded recursively
- dynamic discovery watches `document.documentElement`, so components inserted into `head` after bootstrap are still loaded
- wrapper attributes are exposed to descendants through `xAttrs($el)`

The normal ownership split is:

- component HTML owns structure and Alpine bindings
- store modules own state and async work
- helper modules own dense transforms or protocol logic

## Route-Local Workers

Heavy browser-only runtimes do not have to become global framework dependencies.

Current first-party example:

- `_core/huggingface` keeps its worker, vendored local import shim, and the Transformers.js browser runtime contract inside one module-local singleton manager that the routed page and admin modal can both import inside the same browser context
- `_core/webllm` keeps the vendored WebLLM browser build and its dedicated worker inside the module
- routed pages should keep page-local UI state in their own stores, but reusable browser-runtime ownership can sit in a module-local manager when multiple surfaces need one live state source
- this is the preferred pattern for experimental routed test surfaces that need a large browser runtime but do not yet justify promotion into `_core/framework`

## Shared Visual Primitives

Reusable modal structure lives under `_core/visual`, not inside each feature.

Important dialog rules:

- `app/L0/_all/mod/_core/visual/forms/dialog.css` owns the shared modal shell classes for fixed header/footer chrome
- use `dialog-card-shell` plus `dialog-scroll-body` or `dialog-scroll-frame` when a modal has long content and persistent footer actions
- use `dialog-actions-split` and related dialog action helpers for compact split footers instead of feature-local inline flex layout
- do not put overflow on the full dialog card when the footer must stay reachable; scroll only the inner body or framed content region

Shared dropdown and overflow menus should use `_core/visual/chrome/popover.js`.
Its auto placement flips upward once bottom space drops below `2.2x` the measured panel height and top space is larger, which keeps row menus from opening into cramped bottom-edge space with unnecessary inner scrolling.

## Override Rules

Module and extension resolution follow the same layered model:

- exact same override keys replace lower-ranked entries
- different filenames under the same extension point compose together
- `maxLayer` limits module and extension lookup but not ordinary app-file APIs

This is why modules such as `documentation` and `skillset` can expose ordinary JS helpers that skills import through stable `/mod/...` URLs.
