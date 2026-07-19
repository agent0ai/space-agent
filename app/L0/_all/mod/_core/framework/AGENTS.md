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
- `js/new-window.js`: framework-wide navigation interception for framework-backed pages; it grants `/enter` tab access to same-origin `_blank` opens for `/` and `/admin`, uses the Navigation API `navigate` event when available to catch cancelable current-tab navigations initiated through links, forms, or `window.location`, reroutes best-effort current-tab cross-origin anchor or `window.open(..., "_self")` navigations into a new browser tab during web runtime, and patches `Location.assign(...)`, `Location.replace(...)`, plus `Location.href` where the browser allows it so packaged desktop runs can block same-tab host escapes before the Electron main-process origin guard has to recover
- `js/context.js`: generic `<x-context>` collection helpers plus the framework-owned runtime sync that injects one hidden `data-runtime="browser|app"` context element with a derived `runtime-browser` or `runtime-app` tag on framework-backed pages
- `js/markdown-frontmatter.js`: markdown frontmatter parsing plus safe markdown-to-DOM rendering helpers
- `js/yaml-lite.js`: project-owned lightweight YAML parser and serializer shared directly by browser runtime helpers, server modules, and agent-surface param parsers
- `js/execution-format.js`: shared YAML-first execution transcript formatting helpers used by first-party agent runtimes for console-log and returned-value serialization
- `js/server-config.js`: injected page-meta parsing for frontend-exposed backend runtime parameters
- `js/extensions.js`: `space.extend`, HTML extension loading, the framework-managed `_core/framework/head/end` head seam, JS hook loading, lookup caching, and batching
- `js/moduleResolution.js`: propagation of `maxLayer` into framework-managed module and extension requests
- `js/components.js`: `<x-component>` loading, recursive component imports, and `xAttrs(...)`
- `js/modals.js`: the generic framework modal wrapper used for separately loaded modal documents that are not mounted as feature-owned native dialogs
- `js/AlpineStore.js`: store registration helper used by the runtime and legacy modules
- `js/chat-messages.js`: shared chat-request message folding helpers that collapse consecutive `user` or `assistant` payload turns into alternating messages with blank-line joins
- `js/state-version.js`: browser-side replicated-state version tracking for same-origin fetches, per-tab persistence, and short-lived redirect handoff cookies
- Alpine directives and magic helpers registered during bootstrap, including delayed-target `x-inject`
- shared browser API helpers in `js/api-client.js`, `js/api.js`, `js/fetch-proxy.js`, `js/download.js`, and `js/proxy-url.js`
- small shared parsing and utility helpers such as markdown frontmatter, the browser YAML wrapper, and token counting
- shared framework CSS and icon font assets under `css/`, including non-visual helper-tag defaults such as hidden `x-context` elements

## Local Contracts

### Boot And Runtime Contract

Framework-backed page shells load `/mod/_core/framework/js/initFw.js` once.

Current boot order:

1. `initFw.js` imports `extensions.js` first so `space.extend` exists before other framework modules expose seams and so the framework-managed head HTML seam is present before the initial extension scan.
2. `initializeRuntime(...)` publishes the shared runtime onto `globalThis.space`.
3. `initializer.initialize()` runs the first extensible framework bootstrap step, installs the framework navigation guard, and injects the framework-owned runtime context tag.
4. Alpine and framework support modules are loaded.
5. Framework directives and magic helpers are registered.

`initializeRuntime(...)` currently publishes:

- `space.api`
- `space.config`
- `space.chat` when an agent surface publishes the active thread messages plus attachment handles
- `space.fw.createStore`
- `space.utils.markdown.render(text, target)` as a simple browser wrapper around the shared marked renderer; it replaces `target` contents with a `.markdown` root when a target is provided
- `space.utils.markdown.parseDocument`
- `space.utils.userCrypto`, which exposes per-user encrypt or decrypt helpers plus password-rewrap support for browser-owned secret fields, restores the active login from per-tab `sessionStorage` first and then from one encrypted `localStorage` blob by calling `/api/user_crypto_session_key` for the current session-derived wrapping key, clears both browser caches through `clearSession()`, logs the user out when that local blob cannot be decrypted for the current authenticated session, and falls back to plaintext pass-through when `SINGLE_USER_APP=true`
- `space.utils.yaml.parse` and `stringify`, backed by the shared project-owned lightweight YAML utility in `js/yaml-lite.js` so browser-side YAML behavior matches the server imports while still supporting multiline block scalars, compact list-item maps, and readable nested structured output
- `space.proxy`
- `space.download`
- `space.fetchExternal(...)`

Current API helper contract:

- `space.api.userSelfInfo()` is the canonical frontend identity snapshot; it now also returns the backend `sessionId` plus `userCryptoKeyId` and `userCryptoState`, and frontend agents should still use `username`, `managedGroups`, and `_admin` membership in `groups` to infer writable app roots before choosing where to store files or modules
- `space.api.fileRead(...)` accepts one logical path, one `{ path, encoding? }` entry, or a `files` batch, and `js/api-client.js` now coalesces same-tick file reads into one `/api/file_read` request before re-slicing the returned files back to each caller; when a combined batch fails, it retries the queued reads individually so shorthand paths like `~/...` and optional missing-file callers keep their original per-call behavior
- `space.api.fileList(pathOrOptions, recursive?)` accepts normal path strings and an options object with `access: "write"`, `writableOnly: true`, or `gitRepositories: true` for server-confirmed writable discovery without exposing reserved `.git` metadata
- `space.api.folderDownloadUrl(pathOrOptions)` builds the same-origin attachment URL for a permission-checked folder ZIP download without fetching the archive into browser memory
- `space.api.gitHistoryList(pathOrOptions, limit?)`, `space.api.gitHistoryDiff(...)`, `space.api.gitHistoryPreview(...)`, `space.api.gitHistoryRollback(...)`, and `space.api.gitHistoryRevert(...)` call the optional server-owned writable-layer history endpoints; availability depends on `CUSTOMWARE_GIT_HISTORY`
- `gitHistoryList` accepts `limit`, `offset`, and `fileFilter` when passed an options object, returns only commit metadata for the requested page, and includes `currentHash` so UIs can distinguish the current point from preserved forward-travel refs
- `gitHistoryPreview` accepts `operation: "travel" | "revert"` plus optional `filePath`; it returns affected-file metadata and, when a file is provided, the operation-specific patch
- `js/api-client.js` also dedupes identical in-flight `extensions_load`, `file_read`, `file_info`, `file_list`, `file_paths`, and `user_self_info` requests by request shape so duplicate boot-time callers share one backend round trip
- framework-managed external `fetch(...)` calls and `space.fetchExternal(...)` try the browser's direct request first; when a direct cross-origin attempt fails and the `/api/proxy` retry succeeds, the frontend remembers that origin for the rest of the runtime and routes later requests for the same origin through the backend immediately
- same-origin `fetch(...)` calls made after the fetch proxy is installed automatically carry the highest observed `Space-State-Version`; `js/state-version.js` keeps that floor in per-tab `sessionStorage` and mirrors it into a short-lived same-origin cookie so immediate top-level redirects can reuse the same minimum version without query params, and when the router returns its bounded retryable sync `503` with `Retry-After: 0`, `fetch-proxy.js` retries the request a few times before surfacing the failure to callers
- frontend modules and widgets must not hardcode third-party CORS proxy services; use direct `fetch(...)` or `space.fetchExternal(...)` for remote reads and reserve `space.proxy.buildUrl(...)` for cases that need a same-origin proxied URL string

Current context helper contract:

- `js/context.js` owns generic `<x-context>` discovery for the frontend, not just skill filtering
- stable exports are `getContexts(root?)`, `getAttributeValues(name, root?)`, `getTags(root?)`, and `getContents(root?)` for reading live mounted context elements
- framework bootstrap uses `resolveRuntimeContext(...)` plus `syncRuntimeContext(...)` to keep exactly one hidden runtime-owned `<x-context>` element mounted with `data-runtime="browser"` or `data-runtime="app"` and `data-tags="runtime-browser"` or `data-tags="runtime-app"`
- `resolveRuntimeContext(...)` must prefer the packaged desktop bridge on ordinary app routes, fall back to the launcher-shell `space.getRuntimeInfo()` surface when present, and only then use the frontend `SINGLE_USER_APP` config fallback so packaged app pages cannot be mislabeled as browser runtime just because `window.space` is reserved for the normal frontend runtime

Rules:

- do not import `extensions.js` from feature modules just to reach `space.extend`; use `globalThis.space.extend(...)`
- do not publish the runtime into `parent`, `top`, or sibling frames
- framework bootstrap registers `x-inject="selector"` for `<template>` roots; it mirrors Alpine `x-teleport`, waits for a matching selector with a `MutationObserver`, and disconnects that wait when the source template cleans up, so route-owned markup can safely target shell seams that may mount later
- `css/index.css` installs the app-wide border-box sizing baseline; modules may rely on `width: 100%` including padding and borders unless they explicitly opt an element back into content-box sizing
- if bootstrap order changes, update this doc and `/app/AGENTS.md`
- shell-level one-time setup that can stay declarative, such as inline analytics bootstrap or static `document.head` tags, should prefer the framework-managed `_core/framework/head/end` HTML seam instead of page-shell edits
- shell-level one-time setup that must stay imperative should prefer the shared `_core/framework/initializer.js/initialize/end` JS hook instead of page-shell edits
- ordinary authenticated feature dialogs must not route through `js/modals.js`; they should stay feature-owned native `<dialog class="chat-dialog">` surfaces using `_core/visual/forms/dialog.css` plus `forms/dialog.js`, while `js/modals.js` stays reserved for generic separately loaded modal documents or platform utilities that truly need it
- framework-backed pages centralize navigation interception in `js/new-window.js`: same-origin `/` and `/admin` URLs opened with `_blank` through normal left-clicks or `window.open(..., "_blank")` receive the current tab's `/enter` access in the child window before navigation, while same-tab cross-origin `http(s)` navigations are first blocked through the Navigation API `navigate` event when that event exists and is cancelable, and otherwise fall back to interception of anchor clicks, `window.open(..., "_self")`, and best-effort `Location.assign(...)`, `Location.replace(...)`, or `Location.href = ...` writes; web runtime tries to move those cross-origin requests into a new browser tab, while packaged desktop runtime blocks them in-place and relies on the Electron host as the hard guarantee; location-bar navigations, manual browser opens such as context-menu or middle-click or modifier-key opens, non-cancelable navigation events, and any browser engines that refuse the location patches still fall back to the page-shell or host guard

### Extension And Component System

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
- `extensions_load` transport keeps `maxLayer` at the top level of the call; grouped requests carry only ordered `patterns` arrays, and grouped responses come back in that same order with the matching `patterns` plus resolved `extensions` instead of synthetic transport keys
- JS hook lookups do not use that frame wait window; they request extension paths immediately because hook callers await them directly
- empty extension lookups are cached as valid results
- `moduleResolution.js` preserves page-level `maxLayer` for `/mod/...` and `/api/extensions_load` requests
- `fetch-proxy.js` also stamps same-origin `fetch("/mod/...")` requests with `X-Space-Max-Layer` when the current page declares a module clamp, so ad hoc module reads follow the same L0 or L1 or L2 ceiling as declarative module loading
- `fetch-proxy.js` is also the canonical retry point for the router's retryable state-sync fence responses; feature modules should not open-code their own retry loops for the standard `Space-State-Version` synchronization path

`components.js` owns `<x-component>` loading.

Current loader behavior:

- component sources may be full HTML documents or fragments
- stylesheets and styles are appended to the target element
- module scripts are loaded through dynamic `import()`
- nested `<x-component>` nodes are loaded recursively
- concurrent scans of the same component target share one in-flight import instead of returning early, so observer-driven rescans cannot strand late-mounted components in a partial loading state
- dynamic `<x-component>` discovery also watches the whole `document.documentElement`, so components inserted under `head` are hydrated the same way as body-mounted components
- parent wrapper attributes are exposed to descendants through `xAttrs($el)`

Rules:

- keep `ext/html/` adapter files thin and mount real components from owning modules
- keep `ext/js/` hook files focused on hook behavior instead of turning them into alternate feature entry points
- keep components declarative and import feature stores explicitly
- non-visual helper tags such as `<x-context>` may live in mounted DOM for module-owned runtime discovery; framework CSS should keep them out of layout, and framework bootstrap now owns the one hidden runtime context element with `data-runtime="browser|app"` plus derived `runtime-browser` or `runtime-app` tags, while other tags remain owned by the emitting module
- if a hook or component behavior becomes feature-specific, move it out of framework

## Work Guidance

### Local Work Rules

- keep this module focused on platform concerns, not feature logic
- add shared runtime helpers here only when multiple modules genuinely need them
- prefer explicit small runtime namespaces over loose globals
- if a contract is used by only one module, keep it in that module instead of promoting it here too early
- keep the external-fetch fallback cache runtime-local and in-memory; do not persist proxy-needed origins into storage or app files unless a user request explicitly adds that behavior
- when updating `js/yaml-lite.js`, keep the browser runtime surface, direct server imports, and agent param parsers aligned in the same session
- when bootstrap, runtime namespaces, extension loading, or component loading change, also update `app/L0/_all/mod/_core/skillset/ext/skills/development/` because the shared development skill mirrors this module's contract
- when bootstrap, runtime namespaces, extension loading, or component loading change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/app/`
- when changing bootstrap, runtime namespaces, extension loading, or component loading, update `/app/AGENTS.md` in the same session

## Verification



## Child DOX Index

- No child DOX docs.
