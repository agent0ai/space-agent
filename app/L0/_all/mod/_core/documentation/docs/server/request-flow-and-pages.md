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

API dispatch also owns backend error-log policy: explicit handler 4xx statuses are returned quietly, including expected 404s, while unexpected failures and 5xx statuses still emit one backend diagnostic log and keep browser-facing 5xx bodies redacted.

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
- `/share/space/<token>` when guest users are enabled
- anonymous endpoints that explicitly export `allowAnonymous = true`

Request identity comes from `request_context.js`, which resolves the username-hinted `space_session` cookie or the single-user runtime override. In multi-user runtime this resolution may first demand-load only the hinted user's auth files so the worker has the user and session indexes without scanning all users or the full user tree. Routes that need user-owned files use the request context's file-index ensure hook to load the full `L2/<username>` shard separately. Authenticated `user_crypto_session_key` requests derive the browser's localStorage wrapping key from that live session's backend `sessionId` plus the server-held session secret.

When `WORKERS>1`, the HTTP layer runs in multiple worker processes, but request routing order stays the same. The primary process owns the authoritative watchdog and unified replicated state system, while workers handle normal requests with replica indexes. Worker startup snapshots include L0/L1 file-index scope; workers request L2 user shards only when a request needs them.

That same authoritative owner also runs any server-owned periodic jobs from `server/jobs/`. Workers never execute maintenance jobs.

For `/mod/...` and extension resolution, workers should read the replicated shared-state shards they need rather than depending on a worker-local watchdog scan surface.

## Page Shells

Server-owned shells live in `server/pages/`.

Current shells:

- `index.html` for `/`
- `admin.html` for `/admin`
- `login.html` for `/login`
- `enter.html` for `/enter`
- `share_space.html` for `/share/space/<token>`

Important shell contracts:

- `/` exposes `body/start` and then `_core/router` takes over
- `/admin` exposes `page/admin/body/start`, injects `space-max-layer=0`, and then `_core/admin` takes over
- framework bootstrap also injects `_core/framework/head/end` into `document.head` on `/` and `/admin`, so readable layers can add head-side HTML or inline scripts without changing the server-owned shells
- `/login`, `/enter`, and `/share/space/<token>` cannot depend on authenticated `/mod/...` assets
- `/login`, `/enter`, and `/share/space/<token>` keep their mirrored canvas gradient and backdrop scene on fixed viewport layers, so public-shell scrolling moves only the foreground content
- `/share/space/<token>` should use the same `space-theme-canvas` backdrop contract as `/login` and `/enter`, not a one-off body background
- every server-owned shell now declares the shared Space Agent transparent-helmet favicon family with ICO fallback, PNG browser and install icons, Apple touch icon, and app manifest so standard browser tabs, install surfaces, and Apple touch shortcuts use the same badge-free helmet silhouette
- the shared page titles are `Space Agent`, `Admin Mode | Space Agent`, `Login | Space Agent`, `Enter Space | Space Agent`, and `Shared Space | Space Agent`
- every server-owned shell now also declares the same product-level Open Graph and Twitter card, using the title `Space Agent | Browser-First AI Agent Runtime`, the description `Browser-first AI agent runtime for building your own AI spaces, tools, and workflows directly in the browser.`, and the local banner asset `server/pages/res/readme-banner.webp` served publicly at `https://space-agent.ai/pages/res/readme-banner.webp`; keeping that metadata on `/login` too ensures anonymous shares of `https://space-agent.ai/` still resolve to a proper preview after the auth redirect
- page shells can declare `SPACE_PROJECT_VERSION` for server-side version injection; `/login` and `/enter` both place that resolved version value below a centered footer row of outbound GitHub, Discord, X, and Agent Zero-logo icons
- `/login` keeps the public run-it-yourself path inside a recovery-safe two-panel modal with `Native App` and `Own Server` choices, a privacy/security subtitle, and one short explanatory line per option; its app action links to `https://github.com/agent0ai/space-agent/releases/latest`, and server hosting links to the README `#host` section
- `/login` also keeps a navigation-only footer row of local SVG icon links to `https://github.com/agent0ai/space-agent`, `https://discord.gg/B8KZKNsPpj`, `https://agent-zero.ai`, and `https://x.com/Agent0ai`
- `/enter` reuses that same navigation-only footer row of local SVG icon links to `https://github.com/agent0ai/space-agent`, `https://discord.gg/B8KZKNsPpj`, `https://agent-zero.ai`, and `https://x.com/Agent0ai`, and in packaged Electron runs it may also run a recovery-safe fresh background update check on each shell load unless an install is already downloading or ready to restart, reveal an update button below `Admin Mode` only when the preload bridge reports an available or downloaded update, keep all normal update status inside that button label with no second text line underneath, use the downloaded-state label `Restart and update`, open a login-styled confirmation modal before restart-to-install with `Okay, restart` and `Back` actions plus background-update guidance, fade the launcher shell to black only after the user confirms that restart modal, stay visually quiet when no newer bundled release exists, and replace that button only when the update check or download fails by showing a `Could not check updates` disclosure with expandable raw details, displaying redundant updater versions such as `0.44.0` as the two-segment form `v0.44`
- hover and focus emphasis on `/login` and `/enter` launcher actions plus public footer links should keep the clickable box stationary; use color, background, opacity, border, or outline changes instead of translate-based lift
- `/login` and `/enter` both run the shared public-shell browser compatibility gate from `server/pages/res/browser-compat.js` before their page logic starts; the gate renders a blocking message when the browser is missing core runtime features such as modern JavaScript syntax, dynamic module loading, fetch, storage, text codecs, or Web Crypto
- `/login` uses browser Web Crypto for password-login proof generation and `userCrypto` provisioning; when secure-context crypto features are unavailable, the compatibility gate surfaces that missing Web Crypto contract instead of letting raw browser exceptions leak into the shell
- `/login` also uses the public helper at `server/pages/res/user-crypto.js` to provision or unlock the per-user wrapped browser key as part of the same login transaction; successful sign-in stores the unlocked browser crypto cache in `sessionStorage`, keyed by username plus backend `sessionId`, may store one encrypted `localStorage` blob under `space.userCrypto.local` after fetching the current session-derived wrapping key from `/api/user_crypto_session_key`, stores a session-scoped bootstrap secret when the login started from `userCrypto: missing`, and refuses to redirect when login still reports `userCrypto: missing`; that helper keeps base64url encoding browser-safe by checking `globalThis.Buffer` instead of assuming a bare browser `Buffer` global exists or that any optional polyfill supports Node's `base64url` codec alias, and if the first authenticated app boot still cannot recover that missing state, `_core/user_crypto` signs the browser back out so the user does not stay in a half-working app session
- `/login` logs handled sign-in and guest-create failures through `console.error`, keeps non-fatal storage handoff failures visible through `console.warn`, and installs top-level `error` plus `unhandledrejection` listeners so browser debugging retains a raw console trail alongside the shell status text
- when `LOGIN_ALLOWED=false`, `/login` keeps the public shell and outbound links but swaps the form for a visible `Login is disabled in this system.` message; background guest-login and session-check flows may still run outside that form
- `/share/space/<token>` is a public share-clone shell that reads hosted-share metadata, keeps password UI hidden unless the stored ZIP is browser-encrypted, decrypts that ZIP in the browser when needed, previews the shared space title plus optional thumbnail plus widget-name pills directly from the archive, clears idle status text once the preview is ready, and only then asks the backend to validate and clone the clear archive into a fresh guest account
- after a successful clone, the public share shell completes the same background `/api/login_challenge` plus `/api/login` guest login flow that `/login` uses, grants the same-tab launcher-access marker, and carries the resulting minimum replicated state version into the final page navigation so the imported guest space opens directly instead of bouncing back through `/enter` or `/login`
- server page shells must load runtime resources only from local page assets, inline SVG/CSS, or local `/mod/...` module assets; external URLs in page shells are navigation targets only
- `/mod/...`, shell HTML, and `server/pages/res/` helper assets now ship with explicit no-store cache headers so a reload picks up source updates instead of reusing stale origin-scoped browser or proxy caches
- `/logout` is handled by the pages layer and clears the auth cookie before redirecting to `/login`
- `/share/space/<token>` is handled as an explicit multi-segment public route in `pages_handler.js` instead of the simple single-segment page-file mapping used for `/login` or `/enter`; if guest users are disabled, the route resolves as missing
- platform-standard root asset URLs such as `/favicon.ico`, `/apple-touch-icon.png`, and `/site.webmanifest` are page-layer aliases into `server/pages/res/`, so public and authenticated shells can share one transparent-helmet favicon contract without separate per-shell exports
- the page layer also exposes `/robots.txt`, `/llms.txt`, `/llms-full.txt`, and `/sitemap.xml` without authentication from `server/pages/`; `robots.txt` keeps technical and protected routes out of crawler guidance, `sitemap.xml` lists only the intended public entry URLs, and the `llms*.txt` files provide README-derived Space Agent project summaries for LLM-oriented tooling

## Launcher Behavior

`/enter` is the firmware-backed launcher shell.

Current rules:

- always available in single-user mode
- available to authenticated multi-user requests
- unauthenticated multi-user requests are redirected to `/login`
- the launcher shell reuses the public footer icon row and then shows the resolved project version beneath it; source checkouts use the Git-derived project version, while package-only runtimes fall back to the package version, and packaged Electron runs can run the native update check from `/enter` automatically while keeping the actual download or restart-to-install action explicit
- `/` and `/admin` receive a pre-module launcher guard when the current request is launcher-eligible, so browser-opened new tabs route through `/enter?next=<current-url>` while reloads in the same tab keep loading normally
- framework-created same-origin `_blank` opens for `/` and `/admin` may pre-grant the same tab-access marker before navigation so app-requested windows skip `/enter`

## Direct App-File Fetches

The router supports direct authenticated fetches for app files:

- `/~/...` -> current user's `L2/<username>/...`
- `/L0/...`, `/L1/...`, `/L2/...` -> logical layer paths

These paths stay logical even when writable storage is relocated through `CUSTOMWARE_PATH`.

Path handling and delivery details:

- direct app-file fetches percent-decode each URL path segment before logical path normalization, so normal browser-encoded filenames such as spaces, brackets, unicode, `#`, and `?` resolve to the actual on-disk file name
- encoded separators such as `%2F` and `%5C` are rejected instead of being allowed to become filesystem path separators during later normalization
- direct app-file fetches, page assets, and module files are streamed from disk after a stat check instead of being fully buffered into server RAM before the response starts

## Cross-Worker Visibility

Clustered writes are ordered through the primary watchdog owner and the shared state version.

Current rules:

- after a worker finishes a mutating request, it commits the changed logical app paths to the primary once
- the normal freshness path is those exact logical-path commits plus `fs.watch` incremental sync for loaded out-of-process changes; the watchdog's reconcile is only an infrequent completion-anchored backstop over L0/L1 plus already-loaded L2 users
- the primary updates the authoritative replicated state, schedules any debounced writable-layer Git history commit for the rebuilt owner roots, and broadcasts deltas or snapshots asynchronously; native local-history work then runs through an async per-owner queue, and writes do not wait for every worker to acknowledge or for Git commits to finish
- primary-owned maintenance jobs use that same watchdog mutation path after each filesystem change; they do not bypass the replicated-state refresh flow
- responses advertise the worker's current replicated version through `Space-State-Version`
- responses also advertise the handling worker number through `Space-Worker`
- the primary watchdog seeds that version space from a long startup epoch and then increments monotonically, so a restarted runtime does not fall behind a browser's previously observed version while delta replay stays exact
- the frontend fetch wrapper carries the highest seen `Space-State-Version` on follow-up same-origin requests, keeps that floor in per-tab `sessionStorage`, mirrors it into a short-lived same-origin `space_state_version` cookie for immediate redirect handoffs, and automatically retries the router's bounded sync `503` responses a few times
- if a request lands on a worker that is behind the requested version, the worker first pulls from the primary immediately, then waits briefly for local catch-up before handling the request or returns a retryable `503`
