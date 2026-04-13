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

When `WORKERS>1`, the HTTP layer runs in multiple worker processes, but request routing order stays the same. The primary process owns the authoritative watchdog and unified replicated state system, while workers handle normal requests with replica indexes.

That same authoritative owner also runs any server-owned periodic jobs from `server/jobs/`. Workers never execute maintenance jobs.

For `/mod/...` and extension resolution, workers should read the replicated shared-state shards they need rather than depending on a worker-local watchdog scan surface.

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
- framework bootstrap also injects `_core/framework/head/end` into `document.head` on `/` and `/admin`, so readable layers can add head-side HTML or inline scripts without changing the server-owned shells
- `/login` and `/enter` cannot depend on authenticated `/mod/...` assets
- `/login` and `/enter` keep their mirrored canvas gradient and backdrop scene on fixed viewport layers, so public-shell scrolling moves only the foreground content
- every server-owned shell now declares the shared Space Agent favicon family and app manifest so standard browser tabs, install surfaces, and Apple touch shortcuts use the same helmet avatar
- the shared page titles are `Space Agent`, `Admin Mode | Space Agent`, `Login | Space Agent`, and `Enter Space | Space Agent`
- page shells can declare `SPACE_PROJECT_VERSION` for server-side version injection; `/enter` renders that value as centered white text below the launcher content
- `/login` keeps the public run-it-yourself path inside a recovery-safe two-panel modal with `Native App` and `Own Server` choices, a privacy/security subtitle, and one short explanatory line per option; its app action links to `https://github.com/agent0ai/space-agent/releases/latest`, and server hosting links to the README `#host` section
- `/login` uses browser Web Crypto for password-login proof generation; when `crypto.subtle` is unavailable, such as common plain-HTTP remote origins, the shell blocks sign-in and guest-account creation with an explicit HTTPS-or-localhost error instead of surfacing a raw browser exception
- server page shells must load runtime resources only from local page assets, inline SVG/CSS, or local `/mod/...` module assets; external URLs in page shells are navigation targets only
- `/logout` is handled by the pages layer and clears the session before redirecting to `/login`
- platform-standard root asset URLs such as `/favicon.ico`, `/apple-touch-icon.png`, and `/site.webmanifest` are page-layer aliases into `server/pages/res/`, so public and authenticated shells can share one favicon contract

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

## Cross-Worker Visibility

Clustered writes are ordered through the primary watchdog owner and the shared state version.

Current rules:

- after a worker finishes a mutating request, it commits the changed logical app paths to the primary once
- the primary updates the authoritative replicated state, schedules any debounced writable-layer Git history commit for the rebuilt owner roots, and broadcasts deltas or snapshots asynchronously; writes do not wait for every worker to acknowledge
- primary-owned maintenance jobs use that same watchdog mutation path after each filesystem change; they do not bypass the replicated-state refresh flow
- responses advertise the worker's current replicated version through `Space-State-Version`
- responses also advertise the handling worker number through `Space-Worker`
- the frontend fetch wrapper carries the highest seen `Space-State-Version` on follow-up same-origin requests
- if a request lands on a worker that is behind the requested version, the router waits briefly for catch-up before handling the request or returns a retryable `503`
