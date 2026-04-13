# AGENTS

## Purpose

`server/api/` contains the HTTP endpoint modules loaded under `/api/<endpoint>`.

This folder should stay thin. Endpoints should validate input, call shared infrastructure helpers, and return explicit results. They should not duplicate auth, filesystem, inheritance, or permission logic that already exists elsewhere in `server/lib/`.

Documentation is top priority for this subtree. After any change under `server/api/`, update this file and any affected parent or helper docs in the same session.

## Discovery Contract

API endpoint modules are discovered dynamically from `server/api/*.js` by `server/lib/api/registry.js`.

Current loader rules:

- every `.js` file in this folder is treated as an endpoint module
- the route name comes from the filename, for example `file_read.js` -> `/api/file_read`
- multiword endpoint names must use object-first underscore naming
- supported exported handlers are `get`, `post`, `put`, `patch`, `delete`, `head`, and `options`
- endpoints are authenticated by default
- endpoints opt into public access only by exporting `allowAnonymous = true`

## Endpoint Families

Public auth and health endpoints:

- `health`
- `guest_create`
- `login_challenge`
- `login`
- `login_check`

Current rules:

- these are the only explicit anonymous endpoints today
- login uses the shared auth service challenge and proof flow unless runtime config disables password login
- successful login sets the `space_session` cookie through the auth service, while the durable session verifier stays in `L2/<username>/meta/logins.json`
- `guest_create` creates an `L2` guest user only when runtime config allows guest accounts and must publish the concrete new auth files through the shared mutation path so `user_index` sees the account immediately
- in clustered runtime, login challenges are stored in the primary-only `login_challenge` state area while workers still validate cookies from replicated auth index shards

App-file endpoints:

- `file_list`
- `file_paths`
- `file_read`
- `file_write`
- `file_delete`
- `file_copy`
- `file_move`
- `file_info`
- `folder_download`
- `git_history_diff`
- `git_history_list`
- `git_history_preview`
- `git_history_rollback`
- `git_history_revert`

Current rules:

- these endpoints delegate to `server/lib/customware/file_access.js`
- they operate on app-rooted paths and supported endpoints also accept `~` or `~/...`
- `file_list` and `file_paths` accept `access: "write"` or `writableOnly: true` when callers need only writable app paths instead of the default readable path set
- `file_list` and `file_paths` accept `gitRepositories: true`; with patterns such as `**/.git/`, `file_paths` returns matching local-history owner roots like `L1/<group>/` or `L2/<user>/` while keeping `.git` metadata reserved and hidden
- `file_paths` also accepts an optional explicit `maxLayer` body or query value when module-oriented discovery should ignore higher writable layers; this is used by the admin agent skill catalog so firmware-backed `ext/skills/` files are not shadowed by L1 or L2 customware
- batch operations validate all targets before any mutation begins
- when `USER_FOLDER_SIZE_LIMIT_BYTES` is positive, `file_write`, `file_copy`, `file_move`, `file_delete`, and module removal through `file_access.js` enforce the per-`L2/<user>/` folder quota before mutation; quota errors return `413`
- single-file or single-folder copy and move requests must keep working when request plumbing omits `entries`; only real batch calls should forward an `entries` array to the shared helper
- endpoint-specific validation should stay thin and reuse the shared helper contract
- `folder_download` supports `HEAD` for permission-only validation and `GET` or `POST` for the actual streamed ZIP response
- `folder_download` validates readable folder paths through the shared file-access permission model, creates a ZIP archive in `server/tmp/`, and returns a streamed attachment response without buffering the archive in memory
- `git_history_list` returns paginated local-history commit metadata for a readable or writable `L1/<group>/` or `L2/<user>/` owner root when `CUSTOMWARE_GIT_HISTORY` is enabled; it accepts `limit`, `offset`, and `fileFilter`, returns full per-commit file action metadata for listed commits, and does not return patch bodies
- `git_history_diff` returns the patch body for one file in one commit after read permission is verified
- `git_history_preview` returns affected-file metadata for a travel or revert operation after write permission is verified, and returns an operation-specific patch when `filePath` is provided
- `git_history_rollback` hard-resets a writable owner-root history repository to a requested commit, preserves ignored L2 auth files, preserves the previous head for forward travel when possible, and publishes the changed owner root through the shared mutation path after the reset
- `git_history_revert` creates a new commit that undoes a selected commit, preserves ignored L2 auth files, and publishes the changed owner root through the shared mutation path after the revert
- history endpoints delegate path normalization, permission checks, commit listing, diff reads, rollback, revert, and commit-loop suppression to `server/lib/customware/git_history.js`
- mutating endpoints should go through `server/runtime/request_mutations.js` so clustered workers perform the local write first, then commit changed logical paths back to the primary once before the response finishes
- cross-worker follow-up freshness comes from `Space-State-Version` request or response fencing, not from waiting for every worker to acknowledge each write

Module endpoints:

- `module_list`
- `module_info`
- `module_install`
- `module_remove`

Current rules:

- these endpoints delegate to `server/lib/customware/module_manage.js`
- request-time reads should consume replicated shared-state shards instead of calling watchdog scan helpers directly
- writable operations must reuse the shared permission model and publish concrete changed logical paths through the shared mutation flow so the primary refreshes replicated module state
- when `USER_FOLDER_SIZE_LIMIT_BYTES` is positive, new `module_install` writes into `L2/<user>/` are measured in a system temp directory and quota-checked before the module tree is moved into the user folder

Runtime and identity endpoints:

- `extensions_load`
- `debug_path_index`
- `password_generate`
- `user_self_info`

Important notes:

- `extensions_load` resolves module-owned `ext/...` request paths through the shared layered override system and supports grouped request batches
- `extensions_load` should read the replicated shared-state shards for the caller's visible module owners rather than scanning watchdog paths directly
- `debug_path_index` is an authenticated debugging endpoint for clustered-runtime verification; it returns filtered local `path_index` entries plus a stable hash so tests can compare worker replicas without walking the filesystem directly
- frontend HTML anchors and JS hooks resolve through `ext/html/...` and `ext/js/...` request paths respectively
- frontend modules may also enumerate other extension-resolved metadata assets through this endpoint when those files should honor readable-layer permissions plus same-path layered overrides; the current first-party example is `ext/pages/*.yaml`
- `user_self_info` returns the authenticated user's derived identity only: `{ username, fullName, groups, managedGroups }`
- `password_generate` is an authenticated utility endpoint that returns the backend-sealed `password.json` payload and should stay narrow

## Handler Contract

Handlers receive the request context assembled by `server/router/router.js`, including:

- parsed body
- query params
- headers
- request and response objects
- request URL
- authenticated user
- project directories
- auth service
- shared request infrastructure such as `stateSystem`, mutation sync, and any helper-owned indexes needed by the delegated subsystem

Handlers may return:

- plain JavaScript values
- explicit HTTP-style `{ status, headers, body }` or `{ status, headers, stream }` shapes
- Web `Response` objects

Throw errors with a `statusCode` when the route should return a non-500 error.

## Development Guidance

- keep endpoints narrow and explicit
- keep auth, permission, inheritance, and filesystem policy in shared helpers
- do not add endpoint-local filesystem walks when `path_index` or shared helpers already answer the question
- if frontend-facing API or extension-resolution semantics change, also update `app/L0/_all/mod/_core/skillset/ext/skills/development/` because the shared development skill mirrors this contract
- if endpoint-family semantics change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/server/api/`
- if you add or remove endpoints, or change endpoint-family semantics, update this file and `/server/AGENTS.md`
