# AGENTS

## Purpose

`server/` is the thin local infrastructure runtime.

It should not become the main application runtime. Keep browser concerns in `app/` and keep this tree focused on explicit infrastructure contracts that the browser or CLI needs.

Backend changes are exceptional in this project:

- do not edit `server/` unless the user explicitly asked for backend work or later approves it after an explanation
- frontend-first is the default even when a backend solution might look more conventional
- backend work is justified only when security, shared-data integrity, multi-user isolation, or runtime-stability requirements cannot be trusted to browser code alone
- when backend work is needed without an explicit backend request, stop and ask the user for permission, explain why the behavior is non-standard here, and describe the narrow server change required

This is one of the five core docs. It owns server-wide responsibilities, request flow, and infrastructure boundaries. Detailed subsystem contracts belong in deeper docs inside `server/`.

Documentation is top priority for this area. After any change under `server/` or any server contract change owned here, update this file, the closest owning subsystem `AGENTS.md` files, and the relevant supplemental docs under `app/L0/_all/mod/_core/documentation/docs/` in the same session before finishing.

## Documentation Hierarchy

`/server/AGENTS.md` stays high-level. Deeper docs own the technical details for major server subsystems.

Current subsystem-local docs in the server tree:

- `server/api/AGENTS.md`
- `server/jobs/AGENTS.md`
- `server/router/AGENTS.md`
- `server/pages/AGENTS.md`
- `server/runtime/AGENTS.md`
- `server/lib/customware/AGENTS.md`
- `server/lib/auth/AGENTS.md`
- `server/lib/file_watch/AGENTS.md`
- `server/lib/tmp/AGENTS.md`
- `server/lib/git/AGENTS.md`

Update rules:

- update the nearest subsystem doc when you change a documented server area
- update this file only when the server-wide contract, request flow, or ownership map changed
- keep endpoint- or module-specific detail out of this file when a deeper doc can own it
- when a stable server contract changes, keep the matching documentation-module docs aligned in the same session

## How To Document Server Child Docs

All server child docs at the same depth should share one spine.

Default subsystem-doc section order:

- `Purpose`
- `Documentation Hierarchy` when deeper docs exist or are about to be added
- `Ownership`
- concrete contract sections for the area's stable behaviors
- `Development Guidance`

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
- if a subsystem later grows endpoint-family docs, page-specific docs, or handler docs, the parent subsystem doc must first define the template those deeper docs will use

## Responsibilities

- serve the root HTML entry shells and public page-shell assets from `server/pages/`
- resolve browser-delivered modules from the layered `app/L0`, `app/L1`, and `app/L2` customware model, with writable `L1` and `L2` optionally rooted under `CUSTOMWARE_PATH`
- expose server API modules from `server/api/`
- provide the outbound fetch proxy at `/api/proxy`
- enforce auth, session, module, and app-file access boundaries
- optionally maintain adaptive-debounced per-owner local Git history repositories for writable `L1/<group>/` and `L2/<user>/` roots when `CUSTOMWARE_GIT_HISTORY` is enabled
- optionally enforce `USER_FOLDER_SIZE_LIMIT_BYTES` for each on-disk `L2/<user>/` folder through app-file mutation quota checks that use cached per-user size totals
- run deterministic primary-owned periodic maintenance jobs from `server/jobs/` for backend-enforced cleanup such as guest-account pruning
- keep the backend-only auth secret outside the logical app tree, using shared environment injection via `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY` for multi-instance deployments or local fallback storage under `server/data/`
- manage `server/tmp/` as janitor-backed transient storage for low-RAM server-side artifacts such as folder-download archives
- resolve runtime parameters from launch overrides, stored `.env` values, process environment variables, and schema defaults, including backend storage parameters such as `CUSTOMWARE_PATH`
- when `WORKERS>1`, run a clustered primary-plus-worker runtime where the primary owns authoritative shared state and the live watchdog while workers serve HTTP in parallel
- expose distinct OS process titles for operator visibility: `space-serve` for single-process runtime, `space-serve-p` for clustered primary, and `space-serve-w<N>` for clustered workers
- expose `frontend_exposed` runtime parameters to page shells as injected meta tags
- expose the resolved project version string to page shells that declare the `SPACE_PROJECT_VERSION` placeholder, using `server/lib/utils/project_version.js` as the shared resolver
- support local development and source-checkout update flows without turning the server into business-logic orchestration

## Structure

Current server layout:

- `server/app.js`: server factory and subsystem bootstrap; it normalizes the handling worker number before request routing so `Space-Worker` stays present in both single-process and clustered runtime
- `server/server.js`: startup entry used by the CLI and thin host flows
- `server/runtime/`: clustered worker runtime, unified state replication, request-mutation sync, and worker bootstrap
- `server/jobs/`: primary-only periodic maintenance job discovery, scheduling, and job modules
- `server/config.js`: filesystem roots and static server paths
- `server/dev_server.js`: source-checkout dev supervisor used by `npm run dev`
- `server/lib/utils/runtime_params.js`: shared runtime-parameter schema loading, validation, startup resolution, and frontend-exposure metadata
- `server/pages/`: page shells for `/`, `/login`, `/enter`, and `/admin`, plus public shell assets under `server/pages/res/`
- `server/data/`: gitignored backend-only secret storage used as the local fallback for auth keys when shared deployment secrets are not injected
- `server/api/`: endpoint modules loaded by endpoint name
- `server/router/`: top-level request routing, page handling, `/mod/...` serving, direct app-file fetches, request context, response helpers, proxy transport, and CORS handling
- `server/lib/utils/process_title.js`: canonical OS process-title helper for direct serve, clustered primary, clustered workers, and supervisor-owned runtime naming
- `server/lib/utils/project_version.js`: shared project-version resolver for Git-tag source checkouts and package-version fallback display in page shells
- `server/lib/customware/`: logical app-path normalization, customware-root resolution, group and inheritance logic, extension override resolution, app-file access, and module management
- `server/lib/customware/git_history.js`: optional writable-layer local Git history scheduling, repository discovery, paginated commit listing, file-diff reads, operation previews, rollback, revert, and commit-loop suppression
- `server/lib/customware/user_quota.js`: optional per-user `L2` folder size accounting and cached quota projection helpers for app-file mutations
- `server/lib/auth/`: password verification, session service, user file helpers, user indexing, and user-management helpers
- `server/lib/file_watch/`: config-driven watchdog plus derived indexes such as `path_index`, `group_index`, and `user_index`, all keyed by logical `/app/...` project paths
- `server/lib/tmp/`: `server/tmp/` lifecycle, stale-entry cleanup, and low-RAM ZIP archive creation for attachment-style downloads
- `server/lib/git/`: Git backend abstraction used by update flows and Git-backed module installs
- `server/tmp/`: transient disk-backed artifacts such as folder-download ZIP files

## Request Flow And Runtime Contracts

Request routing order is:

1. API preflight handling
2. `/api/proxy`
3. `/api/<endpoint>`
4. `/mod/...`
5. `/~/...` and `/L0/...`, `/L1/...`, `/L2/...` app-file fetches
6. page shells and page actions as the final fallback

Core runtime contracts:

- request identity is derived from the server-issued `space_session` cookie via router-side request context plus the auth service
- the raw `space_session` cookie remains a browser bearer token, but `L2/<username>/meta/logins.json` stores only backend-keyed verifiers plus signed metadata, so reading app-side session files does not reveal a replayable cookie
- password verifiers remain in `L2/<username>/meta/password.json`, but the SCRAM verifier is sealed with a backend-held key so the file is no longer self-sufficient
- `WORKERS` defaults to `1`; when it is greater than `1`, the runtime forks HTTP workers, keeps the primary as the authoritative watchdog and unified state owner, lets workers perform normal request work and filesystem mutations locally, and publishes versioned state deltas or snapshots back out from the primary after those mutations commit; worker-owned writes also rely on that same primary post-rebuild path to schedule any debounced writable-layer Git history commits
- primary-owned background jobs also run only on that authoritative runtime owner: the lone server process when `WORKERS=1`, or the clustered primary when `WORKERS>1`
- responses expose `Space-State-Version` and `Space-Worker`; requests may send `Space-State-Version` as a required minimum replicated version, and the router may briefly wait for worker catch-up before handling the request
- runtime auth may switch to a single-user mode where every request resolves to the implicit `user` principal
- `/login` stays the public password-login entry
- `/enter` is the firmware-backed launcher route for launcher-eligible sessions: always in single-user runtime, and also for authenticated multi-user requests; unauthenticated multi-user requests are redirected to `/login`
- launcher-eligible requests route new browser-opened tabs and windows through `/enter` by a server-injected page-shell guard on `/` and `/admin`, while reloads in the same tab keep their current target; framework-created same-origin `_blank` opens may pre-grant the same tab-access marker before navigation
- `HOST` and `PORT` come from the same runtime-parameter system as other server params instead of a special-case startup path; `PORT=0` is valid when a caller wants the OS to assign a free port, and the started runtime object must publish the resolved bound `port` and `browserUrl` after `listen()`
- `/api/proxy`, `/mod/...`, and direct app-file fetches require an authenticated session unless an endpoint explicitly opts into anonymous access
- `/mod/...` resolution uses the layered customware model and honors `maxLayer`, which defaults to `2`
- `/admin` requests effectively force `maxLayer=0` for module and extension resolution through explicit request data, query parameters, the `X-Space-Max-Layer` request header, or admin-origin fallback
- `/~/path` maps to the authenticated user's `L2/<username>/path`
- logical `/app/L1/...` and `/app/L2/...` paths may resolve to disk outside the repo when `CUSTOMWARE_PATH` is configured, while `/app/L0/...` remains repo-backed
- `USER_FOLDER_SIZE_LIMIT_BYTES=0` disables user-folder quotas; positive values cap each `L2/<user>/` folder in bytes, block projected growth over the cap, and allow only size-reducing app-file mutations while a folder is already over the cap
- `/L0/...`, `/L1/...`, and `/L2/...` direct fetches require authentication and use the same read permission model as the file APIs
- non-`/mod`, non-`/api`, and non-app-fetch requests stay limited to the root page shells and page actions owned by `server/pages/`
- `/logout` is handled by the pages layer and clears the current session before redirecting to `/login`
- autoscaled or multi-instance deployments must inject the same `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY` values into every instance; the local `server/data/` fallback is for single-instance development and other shared-filesystem setups

## Shared Infrastructure Contracts

The server relies on a small set of shared infrastructure contracts. Do not re-implement them inside endpoints or handlers.

- `server/lib/file_watch/` owns the canonical live view of app files through `path_index`, `group_index`, and `user_index`
- request-time worker code should consume replicated shared-state shards derived from those indexes instead of depending on watchdog-specific scanning helpers; the watchdog remains the primary-owned producer of those shards
- `server/lib/customware/file_access.js` is the canonical entry point for authenticated app-file list, read, write, delete, copy, move, and info operations
- `server/lib/customware/user_quota.js` is the canonical per-user folder-size quota helper; callers must enforce quota through shared app-file mutation helpers instead of adding endpoint-local size checks
- file listing and pattern discovery may be filtered to writable paths through the shared file-access helper, and Git repository discovery returns writable owner roots without exposing `.git` metadata
- `server/lib/customware/git_history.js` is the canonical entry point for optional per-owner writable-layer Git history and rollback, including L2 auth-file ignore and rollback preservation rules
- `server/lib/tmp/` owns the canonical `server/tmp/` janitor and disk-backed archive creation for streamed folder downloads
- `server/lib/customware/module_inheritance.js` and `server/lib/customware/extension_overrides.js` are the canonical module and extension resolution helpers
- `server/lib/customware/module_manage.js` is the canonical module list, info, install, and remove helper
- `server/lib/auth/service.js` is the canonical session and login service
- `server/lib/auth/keys_manage.js` is the canonical backend auth-key loader, with shared-env override support and local `server/data/` fallback
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
- keep file-list and path-discovery work index-backed instead of walking the filesystem ad hoc
- commit indexed filesystem, group, or auth mutations through the shared watchdog mutation path so the primary publishes versioned state updates to every worker replica

## API Contract

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

Current endpoint families:

- public auth and health: `health`, `guest_create`, `login_challenge`, `login`, `login_check`
- app files: `file_list`, `file_paths`, `file_read`, `file_write`, `file_delete`, `file_copy`, `file_move`, `file_info`, `folder_download`
- local history: `git_history_list`, `git_history_diff`, `git_history_preview`, `git_history_rollback`, `git_history_revert`
- modules: `module_list`, `module_info`, `module_install`, `module_remove`
- runtime and identity: `extensions_load`, `debug_path_index`, `password_generate`, `user_self_info`

`user_self_info` is the canonical authenticated identity snapshot for browser clients. Frontend callers infer writable app roots from `username`, `managedGroups`, and `_admin` membership in `groups` using the shared layer rules.

Detailed endpoint behavior now lives in `server/api/AGENTS.md`.

## Server Implementation Guide

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
