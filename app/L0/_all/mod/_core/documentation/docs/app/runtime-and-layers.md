# App Runtime And Layers

This doc covers the frontend boot flow, the browser runtime namespace, and the layered app model.

## Primary Sources

- `app/AGENTS.md`
- `app/L0/_all/mod/_core/framework/AGENTS.md`
- `app/L0/_all/mod/_core/file_explorer/AGENTS.md`
- `app/L0/_all/mod/_core/login_hooks/AGENTS.md`
- `app/L0/_all/mod/_core/router/AGENTS.md`
- `app/L0/_all/mod/_core/time_travel/AGENTS.md`
- `app/L0/_all/mod/_core/user_crypto/AGENTS.md`
- `app/L0/_all/mod/_core/framework/js/runtime.js`
- `server/pages/*.html`

## Frontend Boot Flow

Authenticated app pages are served by the server shells, then booted by framework code:

1. `server/pages/index.html` or `server/pages/admin.html` loads shared framework assets.
2. `/mod/_core/framework/js/initFw.js` installs the frontend runtime.
3. `_core/framework/js/initializer.js` runs the shared bootstrap setup, including framework-managed same-origin `_blank` page-open handling plus best-effort interception of current-tab cross-origin `http(s)` escapes.
4. The first mounted module takes over the next seam.
5. `_core/router` owns `/` and `_core/admin` owns `/admin`.

Important shell facts:

- `/admin` injects `meta[name="space-max-layer"]` with `0`, so module and extension resolution stay firmware-only
- page shells may inject `meta[name="space-config"]` values for runtime params marked `frontend_exposed`
- `/login` and `/enter` are special recovery-safe shells that do not depend on authenticated `/mod/...` assets
- same-origin `/` and `/admin` URLs opened from framework-backed pages through normal `target="_blank"` link clicks or `window.open(..., "_blank")` receive the current tab's `/enter` access marker before navigation
- same-tab cross-origin `http(s)` anchor clicks plus `window.open(..., "_self")` and `window.location` writes are intercepted centrally by `_core/framework/js/new-window.js`; when the browser exposes the Navigation API it uses the cancelable `navigate` event as the primary hook for those escapes, otherwise it falls back to direct anchor or `window.open` interception plus best-effort `location.assign(...)`, `location.replace(...)`, or `location.href = ...` patching; browser sessions try to move blocked requests into a new tab, while packaged desktop sessions block them in-place and leave the Electron host as the hard guarantee
- manual browser opens such as context-menu, middle-click, or modifier-key opens are left to the `/enter` guard or the packaged host guard
- authenticated framework-backed shells load `_core/framework/css/index.css`, which sets an app-wide border-box sizing baseline so reusable module cards, rows, and form controls do not overflow merely because they combine `width: 100%` with padding or borders
- the authenticated `/` shell inherits a router-owned fixed top inset for shell chrome, while routed pages own any extra route-end breathing room they need under the chat overlay; `_core/dashboard` currently keeps a local `15em` bottom overscroll budget for that purpose
- first-party framework, shell, skill-helper, and bundled demo assets required for normal app use must be local `/mod/...` files, server page assets, or inline code rather than CDN scripts, styles, fonts, images, or other remote runtime assets

## Layer Model

The app is layered as:

- `L0`: repo-owned firmware
- `L1`: group customware
- `L2`: user customware

Logical paths stay stable even when the writable roots move:

- repo default: `app/L1/...` and `app/L2/...`
- relocated writable roots: `CUSTOMWARE_PATH/L1/...` and `CUSTOMWARE_PATH/L2/...`
- logical API paths still look like `L1/...`, `L2/...`, `/app/L1/...`, `/app/L2/...`, or `~/...`
- when `CUSTOMWARE_GIT_HISTORY` is enabled, each writable `L1/<group>/` and `L2/<user>/` root may have its own local Git history repo managed by the server
- L2 history intentionally ignores and preserves `meta/password.json`, `meta/logins.json`, and `meta/user_crypto.json` so rollback does not alter current login, password, or wrapped browser-key state
- the `#/time_travel` page defaults to the current user's `~` history and can switch to other write-accessible `L1` or `L2` local-history roots through a server-filtered repository picker
- rollback preserves newer commits in backend-owned history refs when possible so the Time Travel page can still show forward-travel options after moving back
- Time Travel keeps the same diff, preview, rollback, and revert behavior through the shared history APIs even when the backend falls back from native Git to another supported local-history backend

Permission summary:

- nobody writes `L0`
- users write their own `L2/<username>/...`
- users write `L1/<group>/...` only if they manage that group
- `_admin` members may write any `L1` and `L2` path
- first-party frontend modules may persist small client-owned lifecycle state under the current user's `~/meta/` folder when that state is not backend auth material; `_core/login_hooks` uses `~/meta/login_hooks.json` to remember that first-login hooks already ran, and `_core/spaces` currently consumes that seam to copy or reuse the module-owned `Big Bang` onboarding space before the root app shell would default to dashboard
- first-party frontend modules may also rely on backend-assisted user-owned key records under `~/meta/` when the browser must keep the actual decryptable key material session-scoped; `_core/user_crypto` uses `~/meta/user_crypto.json` plus a backend-only server share to restore a per-login browser key without keeping that plaintext key in app files, and may mirror one encrypted origin-scoped `localStorage` blob under `space.userCrypto.local` when the current authenticated session can fetch its session-derived wrapping key
- first-party frontend modules may edit browser-owned user metadata files when the file itself is part of the layered app model; `_core/user` writes `~/user.yaml` directly for `full_name`, while password rotation still goes through the backend-owned `/api/password_change` endpoint instead of writing `~/meta/password.json`
- first-party frontend modules may also edit small user-authored prompt or settings files under `~/conf/` when that data is intentionally browser-owned; `_core/agent` edits `~/conf/personality.system.include.md` as raw prompt-include text for the current user, while `_core/onscreen_agent` and `_core/admin/views/agent` store their `api_key` fields as `userCrypto:`-prefixed ciphertext when the current browser session has unlocked `space.utils.userCrypto`, except in `SINGLE_USER_APP=true` where `space.utils.userCrypto` intentionally bypasses encryption and leaves new values plaintext while legacy wrapped `userCrypto:` API keys still surface as locked placeholders until the user replaces them
- first-party frontend modules may also keep user-scoped prompt-backed memory under `~/memory/`; `_core/memory` standardizes `behavior.system.include.md` for slower-changing behavior rules, `memories.transient.include.md` for rolling notes, and optional focused `*.transient.include.md` files, all consumed through `_core/promptinclude` rather than a separate storage system
- `_core/file_explorer` is the first-party routed Files page and reusable component for normal authenticated app-file reads and writes; the server remains authoritative for permissions

## `globalThis.space`

Framework boot publishes the shared runtime on `globalThis.space`.

Important namespaces:

- `space.api`: authenticated backend API client helpers
- `space.api.gitHistoryList(...)`, `gitHistoryDiff(...)`, `gitHistoryPreview(...)`, `gitHistoryRollback(...)`, and `gitHistoryRevert(...)`: optional writable-layer local-history helpers backed by server-owned Git APIs
- `space.bundles`: installed customware-bundle metadata helpers plus removable browser action and external bridge-state registries for bundle-owned integrations
- `space.config`: frontend-exposed runtime params
- `space.fw.createStore`: Alpine store helper
- `space.utils.markdown.render(...)` and `parseDocument(...)`
- `space.utils.userCrypto`, which exposes session-scoped `encryptText(...)`, `decryptText(...)`, `encryptBytes(...)`, `decryptBytes(...)`, `status()`, and password-rewrap helpers for browser-owned encrypted user settings; it restores unlock state from per-tab `sessionStorage` first and then from the encrypted `localStorage` blob through `/api/user_crypto_session_key`, and an already-unlocked tab also uses that endpoint to backfill or refresh the persisted local blob for the current backend `sessionId`; `clearSession()` clears those browser caches together, stale local blobs force logout, and in `SINGLE_USER_APP=true` the helper short-circuits to plaintext or raw-byte pass-through while first-party settings loaders still treat any legacy wrapped `userCrypto:` API-key payload as a locked placeholder instead of plaintext
- `space.utils.yaml.parse(...)` and `stringify(...)`, backed by the shared project-owned lightweight YAML utility in `_core/framework/js/yaml-lite.js`, which server modules also import directly
- `space.proxy`, `space.download`, `space.fetchExternal(...)`
- `space.router`: router helper surface on routed app pages
- `space.onscreenAgent`: overlay display, normal prompt submission, and guarded preset-button prompt submission helpers
- `space.current` and `space.spaces`: spaces and widget helper surfaces
- `space.browser`: web-browsing helper surface for registered browser surfaces, including popup windows and inline `<x-browser>` elements in widgets or other app DOM; the public agent-facing API uses numeric ids such as `1` even though the internal store still keeps `browser-N` ids, and it exposes top-level discovery and management helpers such as `ids()`, `list()`, `count()`, `has(id)`, `state(id)`, `open(...)`, `create(...)`, `close(id)`, and `closeAll()`, bridge helpers such as `send(browserId, type, payload)` plus the top-level `evaluate(id, scriptOrPayload)` escape hatch for in-page JavaScript execution, convenience inspection wrappers `dom(id, ...)`, `content(id, ...)`, and `detail(id, ref, ...)`, direct navigation helpers keyed by browser id, ref-targeted helpers such as `click(id, ref)`, `type(id, ref, value)`, `submit(id, ref)`, `typeSubmit(id, ref, value)`, and `scroll(id, ref)`, and the runtime-only `setLogLevel("debug"|"info"|"warn"|"error"|"silent")` override for app-side browser diagnostics; the agent-facing contract no longer exposes per-window handles, `current()`, `get(...)`, or a public `sync(...)` step, because open or state or navigation or inspection helpers settle internally and return fresh browser state snapshots while ref-targeted actions now return `{ action, state }` with page-effect flags such as `reacted`, `noObservedEffect`, `validationTextAdded`, `nearbyTextChanged`, `descriptorChanged`, or `domChanged`, navigation-capable helpers now wait for an observed browser-side navigation or loading transition before they accept the returned snapshot, and app-side browser logging now defaults to `error` until `setLogLevel(...)` raises it; while that navigation handoff is still unobserved, the store refuses to trust the old guest bridge or let it overwrite the optimistic destination with stale page state; popup browser windows persist their URL, size, position, minimized state, internal id, and stacking data in origin-local storage so page reloads or packaged-app reloads reopen the same set, and the store reuses the same viewport-fit pass on restore and on live viewport resize so reopened windows clamp back onto the current screen before that updated geometry is written back. `open(...)`, `create({ url })`, inline `<x-browser src>`, and typed `navigate(...)` also translate bare hosts like `novinky.cz` or `localhost:3000` the way a browser address bar would instead of treating them as app-relative paths, using `https://` for ordinary domains and `http://` for localhost or IP-style targets; `dom(...)` and `content(...)` now accept either `selector` or `selectors` payloads for scoped reads; on native desktop, injected browser pages now run against a document-start guest kernel plus a later guest runtime script list built through `space.extend(...)`, so `dom` can still expose raw helper-backed wrapper markup for debugging while helper-backed `content` uses a content-oriented snapshot that strips synthetic frame or shadow wrapper tags, emits typed ref boxes like `[disabled muted button 18] Continue`, `[checked checkbox 7] Email updates`, `[error button 9] Delete`, or `[input text 30] Search placeholder=Hledat value=Ethereum`, gives images actionable refs, also turns generic event-bound controls into refs when the page exposes handler attributes or helper-managed node ids, omits per-link `-> url` summaries and reference-label quotes by default, suppresses list bullets while keeping indentation, falls back to truncated URL text for otherwise-empty links or images, omits obviously non-visible content such as `hidden`, `aria-hidden`, `display:none`, `visibility:hidden|collapse`, `content-visibility:hidden`, or `opacity:0` subtrees, keeps only readable nested content unless the caller explicitly opts into `includeLinkUrls`, `includeLabelQuotes`, `includeStateTags`, `includeSemanticTags`, `includeListMarkers`, or `includeListIndentation`, and falls back to live DOM capture instead of failing when a page's Trusted Types policy blocks the helper-backed HTML reparse used for readable rendering; ref-targeted actions can still route back to the correct `{ frameChain, nodeId }`; `detail(...)` returns richer state metadata plus descriptor or semantic tags for one referenced node; those agent-facing methods are currently guarded through one module-owned availability stub that resolves native-app runtime from the framework context plus the explicit desktop bridge, returning a structured warning in plain browser runtime and also logging the same warning text to the console instead of attempting native-app-only browser actions; on the onscreen agent, the always-loaded `browser-manager` skill covers stand-alone window open or close guidance, the full `browser-control` skill auto-loads once the page exports `browser:open`, and prompt-time `last interacted web browser` content follows the most recently targeted or focused browser id through the owner-module transient hook
- helper-backed `content(...)` should keep structural containers such as dialogs, regions, groups, forms, or navigation landmarks as readable containers rather than broad typed refs, even when page event metadata makes the desktop helper aware of the container; the actual controls inside those containers keep their own refs
- `space.visual`: small shared UI helpers exposed by visual modules
- `space.chat`: current prepared chat context when an agent surface publishes it, including the live `promptItems` metadata list for the current turn plus `readLongMessage({ id, from, to })` for reading trimmed prompt contributors on demand

The runtime is window-local. It must not be published into `parent`, `top`, or sibling frames.

For external HTTP reads, frontend code should use plain `fetch(externalUrl)` or `space.fetchExternal(externalUrl)`. The runtime already retries blocked cross-origin requests through `/api/proxy` and caches successful fallback origins in memory, so repo-owned frontend code and widgets should not hardcode third-party CORS proxy services.

Online-by-nature features such as API LLM providers, browser model downloads, external embeds, market or weather widgets, feeds, and user-authored remote fetches may still require internet access. Those failures should stay scoped to the feature or widget that requested the network, not framework boot or page-shell rendering.

## Identity And Writable Roots

Frontend code should derive writable roots from `space.api.userSelfInfo()`.

That helper returns:

```txt
{ username, fullName, groups, managedGroups, sessionId, userCryptoKeyId, userCryptoState }
```

That runtime identity shape is camelCase for JavaScript APIs, but the persisted layered user file still uses snake_case: edit `~/user.yaml` `full_name`, not `fullName`.

Use it to decide whether a write belongs in:

- `~/...` or `L2/<username>/...`
- a managed `L1/<group>/...`
- a cross-user or admin-only path only when `_admin` access is explicitly available

## Related Docs

- `app/modules-and-extensions.md`
- `server/customware-layers-and-paths.md`
- `server/request-flow-and-pages.md`
