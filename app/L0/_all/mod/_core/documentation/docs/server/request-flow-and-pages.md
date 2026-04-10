# Request Flow And Pages

This doc covers the top-level server routing order and the page-shell layer.

## Primary Sources

- `server/AGENTS.md`
- `server/router/AGENTS.md`
- `server/pages/AGENTS.md`
- `server/router/router.js`
- `server/router/request_context.js`
- `server/router/pages_handler.js`

## Exact Routing Order

The current server routing order is fixed:

1. API preflight handling
2. `/api/proxy`
3. `/api/<endpoint>`
4. `/mod/...`
5. `/~/...` and `/L0/...`, `/L1/...`, `/L2/...`
6. page shells and page actions

This ordering lives centrally in `server/router/router.js`.

## Auth Gating

Authenticated by default:

- `/api/proxy`
- most `/api/<endpoint>` routes
- `/mod/...`
- direct app-file fetches
- `/`
- `/admin`

Public:

- `/login`
- anonymous endpoints that explicitly export `allowAnonymous = true`

Request identity comes from `request_context.js`, which resolves the `space_session` cookie or the single-user runtime override.

## Page Shells

Server-owned shells live in `server/pages/`.

Current shells:

- `index.html` for `/`
- `admin.html` for `/admin`
- `login.html` for `/login`
- `enter.html` for `/enter`

Important shell contracts:

- `/` exposes `body/start` and then `_core/router` takes over
- `/admin` exposes `page/admin/body/start`, injects `space-max-layer=0`, and then `_core/admin` takes over
- `/login` and `/enter` cannot depend on authenticated `/mod/...` assets
- page shells can declare `SPACE_PROJECT_VERSION` for server-side version injection; `/enter` renders that value as centered white text below the launcher content
- `/login` keeps the public run-it-yourself path inside a recovery-safe two-panel modal with `Native App` and `Own Server` choices, a privacy/security subtitle, and one short explanatory line per option; its app action links to `https://github.com/agent0ai/space-agent/releases/latest`, and server hosting links to the README `#host` section
- server page shells must load runtime resources only from local page assets, inline SVG/CSS, or local `/mod/...` module assets; external URLs in page shells are navigation targets only
- `/logout` is handled by the pages layer and clears the session before redirecting to `/login`

## Launcher Behavior

`/enter` is the firmware-backed launcher shell.

Current rules:

- always available in single-user mode
- available to authenticated multi-user requests
- unauthenticated multi-user requests are redirected to `/login`
- the launcher shell shows `Version <resolved version>` below the launcher content; source checkouts use the Git-derived project version, while package-only runtimes fall back to the package version
- `/` and `/admin` receive a pre-module launcher guard when the current request is launcher-eligible, so browser-opened new tabs route through `/enter?next=<current-url>` while reloads in the same tab keep loading normally
- framework-created same-origin `_blank` opens for `/` and `/admin` may pre-grant the same tab-access marker before navigation so app-requested windows skip `/enter`

## Direct App-File Fetches

The router supports direct authenticated fetches for app files:

- `/~/...` -> current user's `L2/<username>/...`
- `/L0/...`, `/L1/...`, `/L2/...` -> logical layer paths

These paths stay logical even when writable storage is relocated through `CUSTOMWARE_PATH`.
