# AGENTS

## Purpose

`_core/framework/` is the shared frontend platform layer.

It owns browser bootstrap, runtime installation, extension loading, component loading, Alpine integration, API client helpers, and small cross-feature utilities. It should stay generic and reusable. Feature-specific behavior belongs in owning modules, not here.

Documentation is top priority for this module. After any change under `_core/framework/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `js/initFw.js`: shared frontend bootstrap entry for framework-backed pages
- `js/initializer.js`: extensible shared bootstrap step that runs before Alpine startup
- `js/runtime.js`: runtime installation onto `globalThis.space`
- `js/new-window.js`: framework-wide same-origin `_blank` handling that lets app-opened new windows skip the `/enter` launcher guard while manual browser-opened windows still route through `/enter`
- `js/markdown-frontmatter.js`: markdown frontmatter parsing plus safe markdown-to-DOM rendering helpers
- `js/yaml-lite.js`: project-owned lightweight YAML parser and serializer shared directly by browser runtime helpers, server modules, and agent-surface param parsers
- `js/server-config.js`: injected page-meta parsing for frontend-exposed backend runtime parameters
- `js/extensions.js`: `space.extend`, HTML extension loading, the framework-managed `_core/framework/head/end` head seam, JS hook loading, lookup caching, and batching
- `js/moduleResolution.js`: propagation of `maxLayer` into framework-managed module and extension requests
- `js/components.js`: `<x-component>` loading, recursive component imports, and `xAttrs(...)`
- `js/AlpineStore.js`: store registration helper used by the runtime and legacy modules
- `js/chat-messages.js`: shared chat-request message folding helpers that collapse consecutive `user` or `assistant` payload turns into alternating messages with blank-line joins
- Alpine directives and magic helpers registered during bootstrap
- shared browser API helpers in `js/api-client.js`, `js/api.js`, `js/fetch-proxy.js`, `js/download.js`, and `js/proxy-url.js`
- small shared parsing and utility helpers such as markdown frontmatter, the browser YAML wrapper, and token counting
- shared framework CSS and icon font assets under `css/`, including non-visual helper-tag defaults such as hidden `x-skill-context` elements

## Boot And Runtime Contract

Framework-backed page shells load `/mod/_core/framework/js/initFw.js` once.

Current boot order:

1. `initFw.js` imports `extensions.js` first so `space.extend` exists before other framework modules expose seams and so the framework-managed head HTML seam is present before the initial extension scan.
2. `initializeRuntime(...)` publishes the shared runtime onto `globalThis.space`.
3. `initializer.initialize()` runs the first extensible framework bootstrap step and installs the framework new-window handler.
4. Alpine and framework support modules are loaded.
5. Framework directives and magic helpers are registered.

`initializeRuntime(...)` currently publishes:

- `space.api`
- `space.config`
- `space.chat` when an agent surface publishes the active thread messages plus attachment handles
- `space.fw.createStore`
- `space.utils.markdown.render(text, target)` as a simple browser wrapper around the shared marked renderer; it replaces `target` contents with a `.markdown` root when a target is provided
- `space.utils.markdown.parseDocument`
- `space.utils.yaml.parse` and `stringify`, backed by the shared project-owned lightweight YAML utility in `js/yaml-lite.js` so browser-side YAML behavior matches the server imports while still supporting multiline block scalars, compact list-item maps, and readable nested structured output
- `space.proxy`
- `space.download`
- `space.fetchExternal(...)`

Current API helper contract:

- `space.api.userSelfInfo()` is the canonical frontend identity snapshot; frontend agents should use `username`, `managedGroups`, and `_admin` membership in `groups` to infer writable app roots before choosing where to store files or modules
- `space.api.fileList(pathOrOptions, recursive?)` accepts normal path strings and an options object with `access: "write"`, `writableOnly: true`, or `gitRepositories: true` for server-confirmed writable discovery without exposing reserved `.git` metadata
- `space.api.folderDownloadUrl(pathOrOptions)` builds the same-origin attachment URL for a permission-checked folder ZIP download without fetching the archive into browser memory
- `space.api.gitHistoryList(pathOrOptions, limit?)`, `space.api.gitHistoryDiff(...)`, `space.api.gitHistoryPreview(...)`, `space.api.gitHistoryRollback(...)`, and `space.api.gitHistoryRevert(...)` call the optional server-owned writable-layer history endpoints; availability depends on `CUSTOMWARE_GIT_HISTORY`
- `gitHistoryList` accepts `limit`, `offset`, and `fileFilter` when passed an options object, returns only commit metadata for the requested page, and includes `currentHash` so UIs can distinguish the current point from preserved forward-travel refs
- `gitHistoryPreview` accepts `operation: "travel" | "revert"` plus optional `filePath`; it returns affected-file metadata and, when a file is provided, the operation-specific patch
- framework-managed external `fetch(...)` calls and `space.fetchExternal(...)` try the browser's direct request first; when a direct cross-origin attempt fails and the `/api/proxy` retry succeeds, the frontend remembers that origin for the rest of the runtime and routes later requests for the same origin through the backend immediately
- frontend modules and widgets must not hardcode third-party CORS proxy services; use direct `fetch(...)` or `space.fetchExternal(...)` for remote reads and reserve `space.proxy.buildUrl(...)` for cases that need a same-origin proxied URL string

Rules:

- do not import `extensions.js` from feature modules just to reach `space.extend`; use `globalThis.space.extend(...)`
- do not publish the runtime into `parent`, `top`, or sibling frames
- `css/index.css` installs the app-wide border-box sizing baseline; modules may rely on `width: 100%` including padding and borders unless they explicitly opt an element back into content-box sizing
- if bootstrap order changes, update this doc and `/app/AGENTS.md`
- shell-level one-time setup that can stay declarative, such as inline analytics bootstrap or static `document.head` tags, should prefer the framework-managed `_core/framework/head/end` HTML seam instead of page-shell edits
- shell-level one-time setup that must stay imperative should prefer the shared `_core/framework/initializer.js/initialize/end` JS hook instead of page-shell edits
- same-origin `/` and `/admin` URLs opened with `_blank` from framework-backed pages are handled centrally by `js/new-window.js`: normal left-clicks on `target="_blank"` links and `window.open(..., "_blank")` receive the current tab's `/enter` access in the child window before navigation, while context-menu opens, middle-clicks, and modifier-key opens are not intercepted and still route through `/enter`

## Extension And Component System

`extensions.js` owns both HTML extension lookup and JS hook execution.

Important contracts:

- `<x-extension id="some/path">` resolves HTML adapters from `mod/<author>/<repo>/ext/html/some/path/*.html`
- `space.extend(import.meta, ...)` requires a valid module ref and wraps standalone functions only
- `space.extend(...)` and `callJsExtensions("some/path", ...)` resolve JS hook files from `mod/<author>/<repo>/ext/js/<extension-point>/*.js` or `*.mjs`
- `extensions.js` injects `_core/framework/head/end` into `document.head` on framework-backed pages before the initial HTML extension scan, so layers can contribute head-side HTML without page-shell edits
- dynamic `<x-extension>` discovery watches the whole `document.documentElement`, not only `body`, so head-side extension seams keep working after bootstrap
- `_core/framework/initializer.js/initialize` is the shared once-per-page bootstrap seam for framework-backed shells, and its `/end` hook is the imperative fallback when a head-side integration cannot stay declarative
- extension callers should name only the seam; the runtime chooses the `html/` or `js/` subfolder implicitly
- wrapped functions expose `/start` and `/end` hook points and become async
- uncached HTML `<x-extension>` lookups are batched to one `/api/extensions_load` request per flush window; by default that window ends on the next animation frame, and frontend constant `HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS` in `js/extensions.js` adds an extra wait window in milliseconds before the frame-aligned flush
- JS hook lookups do not use that frame wait window; they request extension paths immediately because hook callers await them directly
- empty extension lookups are cached as valid results
- `moduleResolution.js` preserves page-level `maxLayer` for `/mod/...` and `/api/extensions_load` requests
- `fetch-proxy.js` also stamps same-origin `fetch("/mod/...")` requests with `X-Space-Max-Layer` when the current page declares a module clamp, so ad hoc module reads follow the same L0 or L1 or L2 ceiling as declarative module loading

`components.js` owns `<x-component>` loading.

Current loader behavior:

- component sources may be full HTML documents or fragments
- stylesheets and styles are appended to the target element
- module scripts are loaded through dynamic `import()`
- nested `<x-component>` nodes are loaded recursively
- dynamic `<x-component>` discovery also watches the whole `document.documentElement`, so components inserted under `head` are hydrated the same way as body-mounted components
- parent wrapper attributes are exposed to descendants through `xAttrs($el)`

Rules:

- keep `ext/html/` adapter files thin and mount real components from owning modules
- keep `ext/js/` hook files focused on hook behavior instead of turning them into alternate feature entry points
- keep components declarative and import feature stores explicitly
- non-visual helper tags such as `<x-skill-context>` may live in mounted DOM for module-owned runtime discovery; framework CSS should keep them out of layout, but the owning module still defines the helper's semantics
- if a hook or component behavior becomes feature-specific, move it out of framework

## Development Guidance

- keep this module focused on platform concerns, not feature logic
- add shared runtime helpers here only when multiple modules genuinely need them
- prefer explicit small runtime namespaces over loose globals
- if a contract is used by only one module, keep it in that module instead of promoting it here too early
- keep the external-fetch fallback cache runtime-local and in-memory; do not persist proxy-needed origins into storage or app files unless a user request explicitly adds that behavior
- when updating `js/yaml-lite.js`, keep the browser runtime surface, direct server imports, and agent param parsers aligned in the same session
- when bootstrap, runtime namespaces, extension loading, or component loading change, also update `app/L0/_all/mod/_core/skillset/ext/skills/development/` because the shared development skill mirrors this module's contract
- when bootstrap, runtime namespaces, extension loading, or component loading change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/app/`
- when changing bootstrap, runtime namespaces, extension loading, or component loading, update `/app/AGENTS.md` in the same session
