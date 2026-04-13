# App Runtime And Layers

This doc covers the frontend boot flow, the browser runtime namespace, and the layered app model.

## Primary Sources

- `app/AGENTS.md`
- `app/L0/_all/mod/_core/framework/AGENTS.md`
- `app/L0/_all/mod/_core/file_explorer/AGENTS.md`
- `app/L0/_all/mod/_core/login_hooks/AGENTS.md`
- `app/L0/_all/mod/_core/router/AGENTS.md`
- `app/L0/_all/mod/_core/time_travel/AGENTS.md`
- `app/L0/_all/mod/_core/framework/js/runtime.js`
- `server/pages/*.html`

## Frontend Boot Flow

Authenticated app pages are served by the server shells, then booted by framework code:

1. `server/pages/index.html` or `server/pages/admin.html` loads shared framework assets.
2. `/mod/_core/framework/js/initFw.js` installs the frontend runtime.
3. `_core/framework/js/initializer.js` runs the shared bootstrap setup, including framework-managed same-origin `_blank` page-open handling.
4. The first mounted module takes over the next seam.
5. `_core/router` owns `/` and `_core/admin` owns `/admin`.

Important shell facts:

- `/admin` injects `meta[name="space-max-layer"]` with `0`, so module and extension resolution stay firmware-only
- page shells may inject `meta[name="space-config"]` values for runtime params marked `frontend_exposed`
- `/login` and `/enter` are special recovery-safe shells that do not depend on authenticated `/mod/...` assets
- same-origin `/` and `/admin` URLs opened from framework-backed pages through normal `target="_blank"` link clicks or `window.open(..., "_blank")` receive the current tab's `/enter` access marker before navigation; manual browser opens are left to the `/enter` guard
- authenticated framework-backed shells load `_core/framework/css/index.css`, which sets an app-wide border-box sizing baseline so reusable module cards, rows, and form controls do not overflow merely because they combine `width: 100%` with padding or borders
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
- L2 history intentionally ignores and preserves `meta/password.json` and `meta/logins.json` so rollback does not alter current login or password state
- the `#/time_travel` page defaults to the current user's `~` history and can switch to other write-accessible `L1` or `L2` local-history roots through a server-filtered repository picker
- rollback preserves newer commits in backend-owned history refs when possible so the Time Travel page can still show forward-travel options after moving back

Permission summary:

- nobody writes `L0`
- users write their own `L2/<username>/...`
- users write `L1/<group>/...` only if they manage that group
- `_admin` members may write any `L1` and `L2` path
- first-party frontend modules may persist small client-owned lifecycle state under the current user's `~/meta/` folder when that state is not backend auth material; `_core/login_hooks` uses `~/meta/login_hooks.json` to remember that first-login hooks already ran, and `_core/spaces` currently consumes that seam to copy or reuse the module-owned `Big Bang` onboarding space before the root app shell would default to dashboard
- first-party frontend modules may also edit small user-authored prompt or settings files under `~/conf/` when that data is intentionally browser-owned; `_core/agent` edits `~/conf/personality.system.include.md` as raw prompt-include text for the current user
- `_core/file_explorer` is the first-party routed Files page and reusable component for normal authenticated app-file reads and writes; the server remains authoritative for permissions

## `globalThis.space`

Framework boot publishes the shared runtime on `globalThis.space`.

Important namespaces:

- `space.api`: authenticated backend API client helpers
- `space.api.gitHistoryList(...)`, `gitHistoryDiff(...)`, `gitHistoryPreview(...)`, `gitHistoryRollback(...)`, and `gitHistoryRevert(...)`: optional writable-layer local-history helpers backed by server-owned Git APIs
- `space.config`: frontend-exposed runtime params
- `space.fw.createStore`: Alpine store helper
- `space.utils.markdown.render(...)` and `parseDocument(...)`
- `space.utils.yaml.parse(...)` and `stringify(...)`, backed by the shared project-owned lightweight YAML utility in `_core/framework/js/yaml-lite.js`, which server modules also import directly
- `space.proxy`, `space.download`, `space.fetchExternal(...)`
- `space.router`: router helper surface on routed app pages
- `space.onscreenAgent`: overlay display, normal prompt submission, and guarded preset-button prompt submission helpers
- `space.current` and `space.spaces`: spaces and widget helper surfaces
- `space.visual`: small shared UI helpers exposed by visual modules
- `space.chat`: current prepared chat context when an agent surface publishes it

The runtime is window-local. It must not be published into `parent`, `top`, or sibling frames.

For external HTTP reads, frontend code should use plain `fetch(externalUrl)` or `space.fetchExternal(externalUrl)`. The runtime already retries blocked cross-origin requests through `/api/proxy` and caches successful fallback origins in memory, so repo-owned frontend code and widgets should not hardcode third-party CORS proxy services.

Online-by-nature features such as API LLM providers, browser model downloads, external embeds, market or weather widgets, feeds, and user-authored remote fetches may still require internet access. Those failures should stay scoped to the feature or widget that requested the network, not framework boot or page-shell rendering.

## Identity And Writable Roots

Frontend code should derive writable roots from `space.api.userSelfInfo()`.

That helper returns:

```txt
{ username, fullName, groups, managedGroups }
```

Use it to decide whether a write belongs in:

- `~/...` or `L2/<username>/...`
- a managed `L1/<group>/...`
- a cross-user or admin-only path only when `_admin` access is explicitly available

## Related Docs

- `app/modules-and-extensions.md`
- `server/customware-layers-and-paths.md`
- `server/request-flow-and-pages.md`
