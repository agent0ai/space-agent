# AGENTS

## Purpose

`server/pages/` contains the server-owned HTML shells and public shell assets.

These files define entry shells and pre-auth presentation only. They should not become a second frontend application runtime.

Documentation is top priority for this subtree. After any change under `server/pages/`, update this file and any affected parent or linked module docs in the same session.

## Ownership

Current page shells:

- `index.html`: authenticated root shell for `/`
- `admin.html`: authenticated admin shell for `/admin`
- `login.html`: public password-login shell for `/login`
- `enter.html`: firmware-backed launcher shell served at `/enter` for launcher-eligible sessions
- `share_space.html`: public hosted-share clone shell for `/share/space/<token>`

Current root discovery files:

- `robots.txt`: public crawler guidance for the live site, disallowing protected or technical routes and advertising the sitemap location
- `llms.txt`: concise README-derived markdown summary plus curated links for LLM-oriented tooling
- `llms-full.txt`: expanded markdown project description for LLM-oriented tooling
- `sitemap.xml`: public sitemap of the small set of intended indexable entry URLs

Current public shell assets:

- `res/space-backdrop.css`
- `res/space-backdrop.js`
- `res/browser-compat.js`
- `res/enter-guard.js`
- `res/state-version.js`
- `res/public-login.js`
- `res/user-crypto.js`
- `res/share-space.js`
- `res/share-crypto.js`
- `res/readme-banner.webp` as the shared social-preview image for page-shell Open Graph and Twitter cards
- login-shell image assets under `res/`
- login-shell social-link SVG assets under `res/`
- shared transparent helmet favicon assets and `res/site.webmanifest`

## Local Contracts

### Shell Contracts

`index.html`:

- loads shared framework CSS and `/mod/_core/framework/js/initFw.js`
- when the current request already has launcher access, receives a page-shell guard before `/mod/...` assets so a new browser-opened tab or window is redirected to `/enter?next=<current-url>` before customware loads; framework-created same-origin `_blank` opens may pre-grant the same tab-access marker before loading this shell
- receives injected `meta[name="space-config"]` tags for any `frontend_exposed` runtime parameters
- declares the shared product-level social-preview metadata for Open Graph and Twitter, using the production card title `Space Agent | Browser-First AI Agent Runtime`, the shared browser-first runtime description, and the local `server/pages/res/readme-banner.webp` asset published at `https://space-agent.ai/pages/res/readme-banner.webp`
- declares the shared Space Agent transparent-helmet favicon set, including ICO fallback, PNG browser and install icons, Apple touch icon, and app manifest metadata
- keeps the body minimal and exposes exactly the `body/start` extension anchor

`admin.html`:

- loads the same framework bootstrap with `?maxLayer=0`
- when the current request already has launcher access, receives the same page-shell guard before `/mod/...` assets so a new browser-opened tab or window is redirected to `/enter?next=<current-url>` before admin shell assets load; framework-created same-origin `_blank` opens may pre-grant the same tab-access marker before loading this shell
- declares `meta[name="space-max-layer"]` with content `0`
- receives the same injected `meta[name="space-config"]` tags for `frontend_exposed` runtime parameters
- declares that same shared product-level Open Graph and Twitter social-preview card so admin-route shares keep the same public Space Agent banner and description
- declares the shared Space Agent transparent-helmet favicon set, including ICO fallback, PNG browser and install icons, Apple touch icon, and the `Admin Mode | Space Agent` document title
- keeps the body minimal and exposes exactly the `page/admin/body/start` extension anchor

`login.html`:

- is public and must not depend on authenticated `/mod/...` assets
- owns the login flow, guest creation flow, login-disabled fallback copy, and pre-auth layout
- declares the same shared product-level Open Graph and Twitter social-preview card as the other shells, so anonymous shares of `https://space-agent.ai/` still resolve to a Space Agent product preview after the server redirects crawlers to `/login`
- renders a centered footer below the main shell content with white semi-transparent outbound icons for GitHub, Discord, X, and a slightly larger Agent Zero logo in the last slot, then places the injected `SPACE_PROJECT_VERSION` value beneath that icon row
- reads injected `meta[name="space-config"]` tags directly so guest-login UI and the password form can follow backend runtime parameters such as `ALLOW_GUEST_USERS` and `LOGIN_ALLOWED` without authenticated module imports
- declares the shared Space Agent transparent-helmet favicon set, including ICO fallback, PNG browser and install icons, Apple touch icon, and the `Login | Space Agent` document title
- runs the shared public-shell browser compatibility gate from `server/pages/res/browser-compat.js` before login logic starts, and renders a visible blocking message when the browser is missing required runtime features such as modern JavaScript syntax, module loading, fetch, storage, text codecs, or Web Crypto
- uses the public `server/pages/res/state-version.js` helper on its background auth requests so successful sign-in can carry the latest replicated-state floor through the final same-tab redirect without a visible URL param
- runs the per-user `userCrypto` provisioning or unlock step inside the same `/api/login_challenge` plus `/api/login` transaction using the public helper in `server/pages/res/user-crypto.js`; the helper must stay public because `/login` cannot depend on authenticated `/mod/...` assets, and its base64url handling must stay browser-safe even when a partial `Buffer` polyfill exists without Node's newer `base64url` codec alias
- logs handled sign-in or guest-creation failures through `console.error`, logs non-fatal session or local storage persistence failures through `console.warn`, and installs top-level `error` plus `unhandledrejection` listeners so browser debugging keeps a raw console trail even when the shell also shows a user-facing status message
- stores the unlocked `userCrypto` session cache in `sessionStorage`, keyed by username plus backend `sessionId`, and may also store one encrypted origin-scoped `localStorage` blob under `space.userCrypto.local`; the shell must fetch the current session-derived wrapping key from `/api/user_crypto_session_key` before writing that blob, and must never store that wrapping key at rest
- when login starts from a `userCrypto: missing` challenge, it also stores a session-scoped bootstrap secret derived from the successful password login so the first authenticated app load can finish provisioning through `/api/user_crypto_bootstrap` if the login-side provisioning write did not stick before redirect
- if that first authenticated recovery pass still leaves `userCrypto` missing, the authenticated bootstrap should sign the browser out instead of leaving the app running in a half-working state
- if login completes without a usable `userCrypto` record, the shell must fail sign-in in place instead of redirecting into an authenticated-page logout loop
- grants same-tab launcher access in `sessionStorage` after successful password sign-in so the tab that just authenticated can land on `/` while fresh tabs still route through `/enter`
- when `LOGIN_ALLOWED=false`, keeps the floating public shell, product copy, self-host CTA, footer links, and version label visible but replaces the login form with a plain `Login is disabled in this system.` message and suppresses guest-account actions
- renders the guest-account removal warning with yellow warning treatment and a recovery-safe inline Google Material Symbols warning icon, without depending on authenticated icon fonts
- keeps the self-host call-to-action visually separated from the sign-in form even when guest account creation is disabled and the guest-only block is hidden
- opens the self-host call-to-action as a two-panel login-styled modal: `Native App` and `Own Server` panels split left-right on desktop and stack top-bottom on mobile, with a privacy/security subtitle, one short explanatory line per panel, a large inline Material icon, and a local inline-icon action button
- keeps the modal's outbound URLs as navigation only: the native app button links to the `agent0ai/space-agent` latest-release redirect, and the server-hosting button links to the README `#host` section
- keeps the footer social links as navigation-only outbound targets to the Space Agent repository, Discord community, Agent Zero website, and X account
- keeps the mobile shell scrollable when the viewport is shorter than the content, and reserves extra small-screen side spacing for the intro column rather than inflating the login card
- keeps the mirrored canvas gradient and star or glow backdrop pinned to fixed viewport layers while the login shell content scrolls
- keeps the public-shell glass shadowless: no painted box-shadow, text-shadow, or drop-shadow treatments on first-party shell chrome, astronaut art, or footer icons
- keeps login-specific styling and motion local

`share_space.html`:

- is public and exists only to unwrap one hosted share into a fresh guest account
- must not depend on authenticated `/mod/...` assets
- reuses the mirrored public backdrop assets from `server/pages/res/space-backdrop.*`
- should use the same `space-theme-canvas` backdrop contract as `/login` and `/enter` so the shared gradient and starfield background stay visually consistent across public shells
- declares the `Shared Space | Space Agent` document title plus the shared favicon family
- reads the share token from the multi-segment `/share/space/<token>` route, checks whether the stored share metadata declares browser-side password protection, downloads the hosted ZIP, decrypts that ZIP in the browser through `server/pages/res/share-crypto.js` when needed, previews the shared space title plus optional thumbnail plus widget-name pills from inside the archive, and only then posts the clear ZIP bytes to `/api/cloud_share_clone`
- should keep the preview explicit and user-readable instead of auto-cloning blindly, using the shared-space title when present and falling back gracefully when preview fields are missing
- should keep the copy explicit and short: shared spaces open in a sandboxed guest environment instead of the visitor's own account
- should keep password UI hidden unless the hosted share metadata declares browser-side encryption, and when a password is required it should use plain continue or show-space wording instead of preview-only jargon
- should clear idle status text once the preview is ready so the steady state is just the preview plus the next real action
- should treat share opens as a normal background guest login: after clone creates the guest account and imports the space, the public shell should run the same `/api/login_challenge` plus `/api/login` password-proof flow used by `/login`, using the returned guest credentials instead of a visible form
- should grant the same-tab launcher-access marker before navigating, and should rely on the public state-version helper's `sessionStorage` plus short-lived cookie handoff so successful public share opens land directly in the imported guest space instead of bouncing back through `/enter` or `/login`
- should surface clone failures in place instead of redirecting into half-initialized guest sessions

`enter.html`:
- must stay safe even when routed customware is broken
- must not depend on authenticated `/mod/...` assets
- is served for launcher-eligible sessions; in multi-user mode, unauthenticated requests are redirected to `/login` before this shell loads
- owns the firmware-backed launcher UI that links to `/` and `/admin`, labeled as Enter Space and Admin Mode, and when the Electron preload bridge reports a packaged desktop runtime with updater support it also runs a fresh background update check on each shell load unless an install is already downloading or ready to restart, reveals an update button below `Admin Mode` only after a newer bundle is available or ready to install, keeps all normal update status inside that button label with no second text line or subtitle underneath, uses the downloaded-state label `Restart and update`, opens a login-styled confirmation modal before restart-to-install with `Okay, restart` and `Back` actions plus copy explaining that the bundled app will quit and update in the background, fades the launcher shell to black only after the user confirms that modal, stays visually quiet when the bundled app is already current, and only replaces the button with a `Could not check updates` disclosure when the update check or download fails, rendering the update button version with a `v` prefix while still collapsing redundant updater versions such as `0.44.0` to the two-segment display form `v0.44`
- declares that same shared product-level Open Graph and Twitter social-preview card so launcher-route shares use the same public Space Agent banner and description
- declares the shared Space Agent transparent-helmet favicon set, including ICO fallback, PNG browser and install icons, Apple touch icon, and the `Enter Space | Space Agent` document title
- runs the shared public-shell browser compatibility gate from `server/pages/res/browser-compat.js` before launcher logic starts, and renders the same blocking message contract as `/login` when the browser is missing required runtime features for the later app shell
- renders the same centered footer treatment as `/login`: white semi-transparent outbound icons for GitHub, Discord, X, and a slightly larger Agent Zero logo in the last slot, followed by the injected `SPACE_PROJECT_VERSION` value beneath that icon row
- accepts an optional `next` query param, grants per-tab launcher access through `sessionStorage`, and routes the Enter or Admin buttons back to the original target when appropriate
- mirrors the login-shell intro layout, floating astronaut, and public backdrop while replacing the right-side form card with direct launcher actions
- keeps the footer social links as navigation-only outbound targets to the Space Agent repository, Discord community, Agent Zero website, and X account
- keeps extra small-screen side spacing around the launcher shell and a generous top and inter-button gap when the launcher actions collapse below the intro copy
- should reuse the mirrored public backdrop assets instead of introducing a second standalone visual system
- `/login` and `/enter` launcher actions plus public footer links must keep a stable clickable hitbox on hover and focus; use opacity, border, background, or outline changes instead of translate-based lift

### Root Discovery File Contracts

- `robots.txt` must stay public, static, and conservative: keep public entry pages crawlable while disallowing protected or technical routes such as `/admin`, `/api/`, `/mod/`, and direct app-file paths
- `robots.txt` may advertise the local `sitemap.xml` and mention `llms.txt` files in comments, but should not invent unsupported crawler directives
- `llms.txt` must follow the root-path markdown convention from `llmstxt.org`: H1 title, short blockquote summary, optional explanatory prose, then H2 sections with link lists
- `llms.txt` and `llms-full.txt` should describe the project using the public README plus stable architecture contracts, not ad hoc marketing copy that drifts away from the repo
- `llms.txt` should stay concise and link outward to the local `llms-full.txt`, the GitHub README, the repo-wide `AGENTS.md`, and other stable public references
- `llms-full.txt` should give a fuller project description, runtime model, key commands, and important links without depending on authenticated pages or `/mod/...` assets
- both LLM-oriented files should point only at public URLs or raw public markdown sources, never at authenticated app surfaces
- `sitemap.xml` should list only public URLs that are reasonable to index without authentication; do not include `/admin`, `/api/...`, `/mod/...`, direct app-file paths, or other technical endpoints

### Public Asset Mirroring

`/login`, `/enter`, and `/share/space/<token>` cannot rely on authenticated module assets for recovery-safe shells, and launcher-gated page shells must redirect before customware loads, so `server/pages/res/space-backdrop.css`, `server/pages/res/space-backdrop.js`, `server/pages/res/browser-compat.js`, and `server/pages/res/enter-guard.js` mirror the public-shell recovery behavior.

Rules:

- keep the mirrored public backdrop aligned with `_core/visual`
- keep both the mirrored base canvas gradient and the mirrored star or glow scene fixed to the viewport so public-shell scrolling never drags them
- if the shared backdrop visuals or runtime behavior change, review and update these mirrored files in the same session
- `server/pages/res/share-space.js` owns the public hosted-share preview plus open flow, including browser-side ZIP preview reads for the public shell, background guest login after clone, and the same-tab guest-session handoff into the imported space; `server/pages/res/public-login.js` owns the shared public-shell password-login helpers reused by hosted-share opens; `server/pages/res/state-version.js` owns the public-shell replicated-state floor persistence for same-origin requests and redirect handoffs; and `server/pages/res/share-crypto.js` owns the browser-side password-based ZIP encryption and decryption used by both the public share shell and the authenticated spaces share modal
- keep public-shell assets under `server/pages/res/` instead of embedding large data blobs into page HTML
- keep crawler and LLM discovery files at the root `server/pages/` level so they can be aliased directly to `/<filename>` without going through authenticated page routes
- keep the shared social-preview banner in `server/pages/res/` so page-shell Open Graph and Twitter metadata never depend on `.github/` paths or external asset hosts
- keep the shared favicon asset family in `server/pages/res/`, derive it from the onscreen-agent assistant helmet avatar, keep the background transparent, and scale the helmet to fill the available icon space without reintroducing a badge or circular plate
- keep the manifest icon entries as standard install icons rather than `maskable` assets unless the icon family is intentionally redesigned for adaptive-icon safe zones
- server page shells must not load remote runtime resources; scripts, styles, fonts, images, icons, and recovery visuals must be local files or inline SVG/CSS so `/login`, `/enter`, `/share/space/<token>`, `/`, and `/admin` can load without internet access
- page-shell HTML and mirrored public assets should be served with explicit no-store headers so recovery-safe shells and their helper scripts refresh immediately after source updates on every origin
- external `https://...` URLs in page shells are allowed only as explicit user navigation targets, never as required runtime assets

## Work Guidance

### Local Work Rules

- keep page shells thin and static
- expose stable anchors and let browser modules own dynamic composition
- keep recovery-safe shell behavior local to `login.html`, `enter.html`, and `server/pages/res/`
- do not hardwire authenticated app structure into page shells when an extension seam can own it
- if page-shell contracts or mirrored public assets change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/server/`
- if page-shell contracts or mirrored public assets change, update this file and the related app docs

## Verification



## Child DOX Index

- No child DOX docs.
