# AGENTS

## Purpose

`server/` is the thin local infrastructure runtime.

It should not become the main application runtime. Keep browser concerns in `app/` and keep this tree focused on explicit infrastructure contracts that the browser or CLI needs.

Backend changes are exceptional in this project:

- do not edit `server/` unless the user explicitly asked for backend work or later approves it after an explanation
- frontend-first is the default even when a backend solution might look more conventional
- backend work is justified only when security, shared-data integrity, multi-user isolation, or runtime-stability requirements cannot be trusted to browser code alone
- when backend work is needed without an explicit backend request, stop and ask the user for permission, explain why the behavior is non-standard here, and describe the narrow server change required

This is a top-level DOX child doc. It owns server-wide responsibilities, request flow, and infrastructure boundaries. Detailed subsystem contracts belong in deeper docs inside `server/`.

Documentation is top priority for this area. After any change under `server/` or any server contract change owned here, update this file, the closest owning subsystem `AGENTS.md` files, and the relevant supplemental docs under `app/L0/_all/mod/_core/documentation/docs/` in the same session before finishing.

## Ownership

- Owns the documentation and operating contract for `/server/`.
- Direct child DOX docs listed below own their narrower subtrees.

## Local Contracts

### Responsibilities

- serve the root HTML entry shells and public page-shell assets from `server/pages/`, including the public hosted-share clone shell at `/share/space/<token>` when guest users are enabled
- resolve browser-delivered modules from the layered `app/L0`, `app/L1`, and `app/L2` customware model, with writable `L1` and `L2` optionally rooted under `CUSTOMWARE_PATH`
- expose server API modules from `server/api/`
- provide the outbound fetch proxy at `/api/proxy`
- enforce auth, session, module, and app-file access boundaries
- optionally maintain adaptive-debounced per-owner local Git history repositories for writable `L1/<group>/` and `L2/<user>/` roots when `CUSTOMWARE_GIT_HISTORY` is enabled
- resolve server-owned Git operations such as local history and Git-backed module installs through the shared backend abstraction, with `GIT_BACKEND=auto` as the default fallback mode and optional forcing to `native` or `isomorphic`
- optionally enforce `USER_FOLDER_SIZE_LIMIT_BYTES` for each on-disk `L2/<user>/` folder through app-file mutation quota checks that use cached per-user size totals
- run deterministic primary-owned periodic maintenance jobs from `server/jobs/` for backend-enforced cleanup such as guest-account pruning
- keep the backend-only auth secrets outside the logical app tree, using shared environment injection via `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY` plus local gitignored fallback storage under `server/data/` by default or `SPACE_AUTH_DATA_DIR` when that override is set; `userCrypto` also keeps a local backend-share cache there, while the shared `L2/<username>/meta/user_crypto.json` record carries a backend-sealed share copy for multi-instance recovery
- manage `server/tmp/` as janitor-backed transient storage for low-RAM server-side artifacts such as folder-download archives
- resolve runtime parameters from launch overrides, stored `.env` values, process environment variables, and schema defaults, including backend storage parameters such as `CUSTOMWARE_PATH`, password-login gating through `LOGIN_ALLOWED`, and hosted-share receiver settings through `CLOUD_SHARE_ALLOWED` plus `CLOUD_SHARE_URL`
- when `WORKERS>1`, run a clustered primary-plus-worker runtime where the primary owns authoritative shared state and the live watchdog while workers serve HTTP in parallel; `CUSTOMWARE_WATCHDOG=false` keeps primary-owned L0/L1 startup indexing, on-demand L2 loading, and the explicit mutation sync path but disables background `fs.watch`, config watching, and the periodic reconcile loop
- expose distinct OS process titles for operator visibility: `space-serve` for single-process runtime, `space-serve-p` for clustered primary, and `space-serve-w<N>` for clustered workers
- expose `frontend_exposed` runtime parameters to page shells as injected meta tags
- expose the resolved project version string to page shells that declare the `SPACE_PROJECT_VERSION` placeholder, using `server/lib/utils/project_version.js` as the shared resolver
- support local development and source-checkout update flows without turning the server into business-logic orchestration

### Structure

Current server layout:

- `server/app.js`: server factory and subsystem bootstrap; it normalizes the handling worker number before request routing so `Space-Worker` stays present in both single-process and clustered runtime
- `server/server.js`: startup entry used by the CLI and thin host flows
- `server/runtime/`: clustered worker runtime, unified state replication, request-mutation sync, and worker bootstrap
- `server/jobs/`: primary-only periodic maintenance job discovery, scheduling, and job modules
- `server/config.js`: filesystem roots and static server paths
- `server/dev_server.js`: source-checkout dev supervisor used by `npm run dev`
- `server/lib/utils/runtime_params.js`: shared runtime-parameter schema loading, validation, startup resolution, and frontend-exposure metadata
- `server/pages/`: page shells for `/`, `/login`, `/enter`, `/admin`, and the public hosted-share clone shell at `/share/space/<token>`, plus public shell assets under `server/pages/res/`
- `server/data/`: gitignored backend-only secret storage used as the default local fallback for auth keys and per-user `userCrypto` server shares when shared deployment secrets are not injected and `SPACE_AUTH_DATA_DIR` is unset
- `server/api/`: endpoint modules loaded by endpoint name
- `server/router/`: top-level request routing, page handling, `/mod/...` serving, direct app-file fetches, request context, response helpers, proxy transport, and CORS handling
- `server/lib/utils/process_title.js`: canonical OS process-title helper for direct serve, clustered primary, clustered workers, and supervisor-owned runtime naming
- `server/lib/utils/project_version.js`: shared project-version resolver for Git-tag source checkouts and package-version fallback display in page shells
- `server/lib/customware/`: logical app-path normalization, customware-root resolution, group and inheritance logic, extension override resolution, app-file access, and module management
- `server/lib/customware/git_history.js`: optional writable-layer local Git history scheduling, repository discovery, paginated commit listing, file-diff reads, operation previews, rollback, revert, and commit-loop suppression
- `server/lib/customware/user_quota.js`: optional per-user `L2` folder size accounting and cached quota projection helpers for app-file mutations
- `server/lib/auth/`: password verification, session service, user file helpers, user indexing, and user-management helpers
- `server/lib/file_watch/`: config-driven watchdog plus sharded `file_index` state and derived `group_index` and `user_index`, all keyed by logical `/app/...` project paths
- `server/lib/share/`: backend-owned hosted-share archive storage, ZIP validation, authenticated import, and anonymous guest-clone helpers
- `server/lib/tmp/`: `server/tmp/` lifecycle, stale-entry cleanup, and low-RAM ZIP archive creation for attachment-style downloads
- `server/lib/git/`: Git backend abstraction used by update flows and Git-backed module installs
- `server/tmp/`: transient disk-backed artifacts such as folder-download ZIP files

### Request Flow And Runtime Contracts

Request routing order is:

1. API preflight handling
2. `/api/proxy`
3. `/api/<endpoint>`
4. `/mod/...`
5. `/~/...` and `/L0/...`, `/L1/...`, `/L2/...` app-file fetches
6. page shells and page actions as the final fallback

Core runtime contracts:

- request identity is derived from the server-issued `space_session` cookie via router-side request context plus the auth service
- the raw `space_session` cookie remains a browser bearer token, but `L2/<username>/meta/logins.json` stores only backend-keyed verifiers plus signed metadata, including a stable backend-generated `sessionId`, so reading app-side session files does not reveal a replayable cookie
- when the current login is allowed to auto-restore `userCrypto` on the same browser profile, the browser keeps only one encrypted `localStorage` blob; the authenticated `user_crypto_session_key` endpoint derives the wrapping key from the current backend `sessionId` plus the server-held session secret, and the server never persists that wrapping key or the unwrapped user master key
- password verifiers remain in `L2/<username>/meta/password.json`, but the SCRAM verifier is sealed with a backend-held key so the file is no longer self-sufficient
- per-user wrapped browser-encryption state may also live in `L2/<username>/meta/user_crypto.json`; that record now includes a backend-sealed server-share envelope for multi-instance recovery, while a local backend-share cache may also live under `server/data/user_crypto/` or the matching `SPACE_AUTH_DATA_DIR/user_crypto/` override path; the plaintext share is never stored in the app tree
- `WORKERS` defaults to `1`; when it is greater than `1`, the runtime forks HTTP workers, keeps the primary as the authoritative watchdog and unified state owner, lets workers perform normal request work and filesystem mutations locally, requires workers to publish the exact changed logical app paths back to the primary once, and publishes versioned state deltas or snapshots back out from the primary after those mutations commit; startup snapshots intentionally include only `L0`, `L1`, layer-root file-index shards, already-derived shared state, and tiny L2 file-index version markers, while full `L2/<user>` file-index shards are loaded and transferred to workers on demand; worker-owned writes and primary-owned jobs use that explicit mutation path as the normal freshness mechanism, the same primary post-rebuild path schedules any debounced writable-layer Git history commits, and the watchdog's full-tree reconcile remains an infrequent completion-anchored backstop for missed external or CLI changes in already-loaded scope
- that primary mutation path should rescan only the exact changed path plus the nearest affected or still-missing ancestor directories, then patch just the affected `file_index` shard entries before broadcasting the delta; do not widen routine `L1` or `L2` writes to a whole-layer rebuild
- `CUSTOMWARE_WATCHDOG` defaults to `true`; setting it to `false` disables background `fs.watch` listeners, config-file watching, and the periodic reconcile backstop while preserving L0/L1 startup indexing plus the explicit worker or job mutation-sync path used by clustered writes and CLI or backend changes
- primary-owned background jobs also run only on that authoritative runtime owner: the lone server process when `WORKERS=1`, or the clustered primary when `WORKERS>1`
- responses expose `Space-State-Version` and `Space-Worker`; requests may send `Space-State-Version` as a required minimum replicated version, browser helpers keep the latest floor in per-tab `sessionStorage` plus a short-lived same-origin `space_state_version` cookie for redirect handoffs, and the router may briefly wait for worker catch-up before handling the request
- runtime auth may switch to a single-user mode where every request resolves to the implicit `user` principal
- `/login` stays the public password-login entry when `LOGIN_ALLOWED=true`; when `LOGIN_ALLOWED=false`, the shell stays public but the password-login form and normal password-login entry path are disabled, while guest-session issuance and session-check flows may still complete in the background
- `/enter` is the firmware-backed launcher route for launcher-eligible sessions: always in single-user runtime, and also for authenticated multi-user requests; unauthenticated multi-user requests are redirected to `/login`
- launcher-eligible requests route new browser-opened tabs and windows through `/enter` by a server-injected page-shell guard on `/` and `/admin`, while reloads in the same tab keep their current target; framework-created same-origin `_blank` opens may pre-grant the same tab-access marker before navigation
- `HOST` and `PORT` come from the same runtime-parameter system as other server params instead of a special-case startup path; `PORT=0` is valid when a caller wants the OS to assign a free port, and the started runtime object must publish the resolved bound `port` and `browserUrl` after `listen()`
- `/api/proxy`, `/mod/...`, and direct app-file fetches require an authenticated session unless an endpoint explicitly opts into anonymous access
- `/mod/...` resolution uses the layered customware model and honors `maxLayer`, which defaults to `2`
- `/mod/...`, page-shell HTML, and `server/pages/res/` helper assets should be served with explicit no-store headers so reloads replace stale origin-scoped browser or proxy caches after source updates
- `/admin` requests effectively force `maxLayer=0` for module and extension resolution through explicit request data, query parameters, the `X-Space-Max-Layer` request header, or admin-origin fallback
- `/~/path` maps to the authenticated user's `L2/<username>/path`
- logical `/app/L1/...` and `/app/L2/...` paths may resolve to disk outside the repo when `CUSTOMWARE_PATH` is configured, while `/app/L0/...` remains repo-backed
- `USER_FOLDER_SIZE_LIMIT_BYTES=0` disables user-folder quotas; positive values cap each `L2/<user>/` folder in bytes, block projected growth over the cap, and allow only size-reducing app-file mutations while a folder is already over the cap
- `/L0/...`, `/L1/...`, and `/L2/...` direct fetches require authentication and use the same read permission model as the file APIs
- `/share/space/<token>` is a public multi-segment page route owned by `pages_handler.js`; it is available only when guest users are enabled, otherwise the router should treat it as missing
- non-`/mod`, non-`/api`, and non-app-fetch requests stay limited to the root page shells and page actions owned by `server/pages/`
- `/logout` is handled by the pages layer and clears the current session cookie before redirecting to `/login`
- autoscaled or multi-instance deployments must inject the same `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY` values into every instance; the local `server/data/` or `SPACE_AUTH_DATA_DIR` fallback is for single-instance development and other shared-filesystem setups

### Shared Infrastructure Contracts

The server relies on a small set of shared infrastructure contracts. Do not re-implement them inside endpoints or handlers.

- `server/lib/file_watch/` owns the canonical live view of app files through sharded `file_index` state plus derived `group_index` and `user_index`; `path_index` is only an aggregate compatibility view over currently loaded shards
- auth requests may load only the target user's auth files into `user_index` and `session_index`; file, module, extension, quota, and direct app-file paths must request the full user `file_index` shard separately when they need user-owned files
- request-time worker code should consume replicated shared-state shards derived from those indexes instead of depending on watchdog-specific scanning helpers; the watchdog remains the primary-owned producer of those shards
- the watchdog's normal freshness path is exact logical-path commits plus `fs.watch` incremental sync for loaded scope; startup and reconcile must not enumerate all `L2/<user>` roots
- `server/lib/customware/file_access.js` is the canonical entry point for authenticated app-file list, read, write, delete, copy, move, and info operations
- `server/lib/customware/user_quota.js` is the canonical per-user folder-size quota helper; callers must enforce quota through shared app-file mutation helpers instead of adding endpoint-local size checks, and current-size reads should come from loaded `file_index` metadata rather than ad hoc disk crawls
- file listing and pattern discovery may be filtered to writable paths through the shared file-access helper, and Git repository discovery returns writable owner roots without exposing `.git` metadata
- `server/lib/customware/git_history.js` is the canonical entry point for optional per-owner writable-layer Git history and rollback, including L2 auth-file ignore and rollback preservation rules
- `server/lib/git/` owns Git backend selection for source-checkout update flows, Git-backed module installs, and local-history clients; server runtime param `GIT_BACKEND` defaults to `auto` and may force `native` or `isomorphic`
- `server/lib/share/service.js` is the canonical hosted-share helper for backend-owned ZIP storage under `CUSTOMWARE_PATH/share/spaces/`, archive validation, authenticated imports, and guest-clone session issuance; endpoints and page shells must not duplicate that logic
- `server/lib/tmp/` owns the canonical `server/tmp/` janitor and disk-backed archive creation for streamed folder downloads
- `server/lib/customware/module_inheritance.js` and `server/lib/customware/extension_overrides.js` are the canonical module and extension resolution helpers
- `server/lib/customware/module_manage.js` is the canonical module list, info, install, and remove helper
- `server/lib/auth/service.js` is the canonical session and login service
- `server/lib/auth/keys_manage.js` is the canonical backend auth-key loader, with shared-env override support and local `server/data/` or `SPACE_AUTH_DATA_DIR` fallback
- `server/lib/utils/runtime_params.js` is the canonical parameter-resolution layer for startup env overrides, defaults, and frontend exposure
- `server/server.js` owns the human-facing startup banner for direct serve launches and must print the shared Git-derived version without changing the separate listening-URL line that supervisor tooling parses
- `server/runtime/request_mutations.js` is the canonical worker-side mutation capture and commit layer for clustered runtime writes
- `server/runtime/state_system.js` is the canonical primary-owned shared state engine for cross-worker coordination, replicated index shards, primary-only challenge state, delta replay, and named locks
- `server/jobs/job_runner.js` is the canonical primary-owned periodic job scheduler and should reuse `state_system.js` named locks instead of inventing parallel lockfiles or second schedulers
- `server/lib/utils/project_version.js` is the canonical project-version resolver for both the CLI version command and page-shell version display
- `app/L0/_all/mod/_core/framework/js/yaml-lite.js` is the canonical YAML parser and serializer for both browser and server code; server modules import it directly instead of maintaining a duplicate server-side helper
- `server/lib/customware/layout.js` is the canonical logical-to-disk resolver for repo `L0` and configured writable `L1`/`L2` roots

Infrastructure rules:

- keep file-access checks in shared helpers, not in endpoint-local logic
- keep group and user access state derived from `group_index` and `user_index`, not re-parsed per request
- keep file-list and path-discovery work index-backed instead of walking the filesystem ad hoc, and keep pattern discovery shard-scoped to the caller's readable or writable `file_index` shards instead of sorting and filtering the whole app index per request
- commit indexed filesystem, group, or auth mutations through the shared watchdog mutation path so the primary publishes versioned state updates to every worker replica
- keep startup and restart indexing bounded to `L0`, `L1`, and layer roots; full `L2/<user>` file-index shards are demand-loaded and must not be preloaded to make stale users visible
- keep periodic full rescans rare and completion-anchored, and route any unavoidable backstop rebuild through the shared yielding reconcile path over currently loaded shards instead of adding new synchronous polling loops

### API Contract

Endpoint files in `server/api/` are loaded by filename. Multiword API route names should use object-first underscore naming so related routes stay grouped together alphabetically, for example `login_check`, `guest_create`, and `extensions_load`.

Endpoint modules may export:

- `get(context)`
- `post(context)`
- `put(context)`
- `patch(context)`
- `delete(context)`
- `head(context)`
- `options(context)`
- `allowAnonymous = true` for explicit public endpoints only

Handlers may return:

- plain JavaScript values, which are serialized as JSON automatically
- explicit HTTP-style response objects when status, headers, binary bodies, or streaming behavior matter
- Web `Response` objects for advanced cases

Endpoint handlers should throw errors with an explicit 4xx `statusCode` for expected client-error responses such as missing resources, invalid input, or denied access. The router returns those responses without backend error-log noise, while unexpected failures and 5xx statuses still produce one backend diagnostic log and keep browser-facing 5xx bodies redacted.

Current endpoint families:

- public auth and health: `health`, `guest_create`, `login_challenge`, `login`, `login_check`
- hosted share and import: `cloud_share_create`, `cloud_share_info`, `cloud_share_download`, `cloud_share_clone`, `space_import`
- app files: `file_list`, `file_paths`, `file_read`, `file_write`, `file_delete`, `file_copy`, `file_move`, `file_info`, `folder_download`
- local history: `git_history_list`, `git_history_diff`, `git_history_preview`, `git_history_rollback`, `git_history_revert`
- modules: `module_list`, `module_info`, `module_install`, `module_remove`
- runtime and identity: `extensions_load`, `debug_path_index`, `password_generate`, `password_change`, `user_crypto_session_key`, `user_self_info`

`file_write` still defaults to whole-file replacement, but it now also supports append, prepend, and text-insert mutations through the shared file-access layer, so browser callers can update ordinary text files incrementally without fetching and rewriting the full file every time.

`user_self_info` is the canonical authenticated identity snapshot for browser clients. It also carries the current backend `sessionId` plus `userCrypto` readiness fields so browser modules can restore session-scoped decryption state before using encrypted user settings, while `user_crypto_session_key` returns the current session-derived wrapping key used only to decrypt the encrypted `localStorage` blob for that live authenticated session.

Detailed endpoint behavior now lives in `server/api/AGENTS.md`.

## Work Guidance

### Child DOX Guidance

All server child docs at the same depth should share the DOX spine:

- `Purpose`
- `Ownership`
- `Local Contracts`
- `Work Guidance`
- `Verification`
- `Child DOX Index`

Required contract coverage for server docs:

- discovery and ownership: which files are discovered dynamically, which files are canonical entry points, and which helper modules are authoritative
- input and output contract: request methods, handler context, return shapes, function APIs, CLI-facing exports, and caller expectations
- storage or path or index contract: logical paths, on-disk locations, watched sources, caches, indexes, and naming rules
- security and permission contract: auth defaults, anonymous exceptions, read or write boundaries, and trust assumptions
- mutation and refresh side effects: watchdog refreshes, cache invalidation, session revocation, derived-index rebuild expectations, and any ordering requirements
- dependency boundaries: which shared helpers must be reused and which duplicate local implementations are forbidden

Subsystem-type emphasis:

- endpoint docs should enumerate families, auth mode, request body or query expectations, response shapes, and delegated helper owners
- router and pages docs should document routing order, gating, shell assets, injected meta tags, public-versus-authenticated behavior, and mirrored assets
- service or library docs should document canonical helpers, data files, path normalization, invariants, and who may call them
- filesystem or index docs should document watched inputs, derived outputs, rebuild triggers, and how logical paths relate to disk paths

Parent and child split rules:

- `/server/AGENTS.md` owns cross-subtree request flow and shared infrastructure boundaries
- subsystem docs own the precise contracts for one server area
- if a subsystem later grows endpoint-family docs, page-specific docs, or handler docs, the parent subsystem doc must first refresh its `Child DOX Index` and state which local contracts stay parent-owned

### Server Implementation Guide

- keep endpoints narrow and explicit
- keep routing order explicit and easy to reason about
- keep page-shell behavior in `server/pages/` plus `server/router/pages_handler.js`, not spread across unrelated files
- keep backend modules in `server/` on ES module syntax with `import` and `export`
- use underscores consistently for multiword server-side module files, handler ids, and helper entry points
- keep inheritance resolution explicit and small
- keep new persistence APIs explicit, small, and integrity-safe
- do not move browser-side agent logic onto the server by default
- reject backend convenience changes that merely duplicate frontend orchestration or UI workflow logic
- when server responsibilities, request flow, API contracts, watched-file behavior, or persistence architecture change, update this file and the owning subsystem docs in the same session

## Verification



## Child DOX Index

- `/server/api/AGENTS.md` - server/api/ contains the HTTP endpoint modules loaded under /api/<endpoint>.
- `/server/jobs/AGENTS.md` - server/jobs/ owns primary-run periodic maintenance jobs.
- `/server/lib/auth/AGENTS.md` - server/lib/auth/ owns the local auth and session system.
- `/server/lib/customware/AGENTS.md` - server/lib/customware/ owns the layered app filesystem and module model.
- `/server/lib/file_watch/AGENTS.md` - server/lib/file_watch/ owns the config-driven watchdog and the derived live indexes built from the logical app tree.
- `/server/lib/git/AGENTS.md` - server/lib/git/ owns the Git backend abstraction used by source-checkout update flows and Git-backed module installs.
- `/server/lib/share/AGENTS.md` - server/lib/share/ owns the backend-hosted space-share helper.
- `/server/lib/tmp/AGENTS.md` - server/lib/tmp/ owns transient server-side file storage under server/tmp/.
- `/server/pages/AGENTS.md` - server/pages/ contains the server-owned HTML shells and public shell assets.
- `/server/router/AGENTS.md` - server/router/ owns top-level HTTP request handling for the local server runtime.
- `/server/runtime/AGENTS.md` - server/runtime/ owns the multi-worker server runtime glue.
