# AGENTS

## Purpose

`server/api/` contains the HTTP endpoint modules loaded under `/api/<endpoint>`.

This folder should stay thin. Endpoints should validate input, call shared infrastructure helpers, and return explicit results. They should not duplicate auth, filesystem, inheritance, or permission logic that already exists elsewhere in `server/lib/`.

Documentation is top priority for this subtree. After any change under `server/api/`, update this file and any affected parent or helper docs in the same session.

## Ownership

- Owns the documentation and operating contract for `/server/api/`.
- Direct child DOX docs listed below own their narrower subtrees.

## Local Contracts

### Discovery Contract

API endpoint modules are discovered dynamically from `server/api/*.js` by `server/lib/api/registry.js`.

Current loader rules:

- every `.js` file in this folder is treated as an endpoint module
- the route name comes from the filename, for example `file_read.js` -> `/api/file_read`
- multiword endpoint names must use object-first underscore naming
- supported exported handlers are `get`, `post`, `put`, `patch`, `delete`, `head`, and `options`
- endpoints are authenticated by default
- endpoints opt into public access only by exporting `allowAnonymous = true`

### Endpoint Families

Public auth and health endpoints:

- `health`
- `guest_create`
- `login_challenge`
- `login`
- `login_check`

Current rules:

- these are the password-login, guest-bootstrap, session-check, and health anonymous endpoints; hosted-share endpoints are the other explicit anonymous family
- normal password login uses the shared auth service challenge and proof flow unless runtime config disables that entry path through `LOGIN_ALLOWED=false`
- `login_challenge` also reports `userCrypto` bootstrap state; when a legacy account has no `meta/user_crypto.json`, the challenge includes a one-time provisioning share so the browser can generate the missing wrapped record before final login
- `login_challenge`, `login`, and cookie validation load only the target user's auth state (`user.yaml`, `meta/password.json`, and `meta/logins.json`) on demand; endpoint code must not restore startup-time all-user scans or full user-tree scans to make auth visible
- successful login sets the username-hinted `space_session` cookie through the auth service, writes the durable session verifier into `L2/<username>/meta/logins.json`, and returns a backend `sessionId` plus the `userCrypto` unlock payload for the authenticated browser session
- if a legacy account cannot finish `userCrypto` provisioning during login, the server must fail the login instead of issuing the cookie and then forcing a logout
- `guest_create` creates an `L2` guest user whenever runtime config allows guest accounts, even when `LOGIN_ALLOWED=false`, and must publish the concrete new auth files through the shared mutation path so `user_index` sees the account immediately
- when `LOGIN_ALLOWED=false`, `login_challenge` still allows guest usernames when guest users are enabled, `login` still finalizes already-issued challenges, and `login_check` stays available for public session checks even though guest-bootstrap and hosted-share flows may still complete the normal background login challenge path without showing the `/login` form
- in clustered runtime, login challenges are stored in the primary-only `login_challenge` state area while workers validate cookies from replicated auth index shards after the hinted user's auth-only state has been loaded

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
- request-time `file_paths` must pass the shared `stateSystem` into `file_access.js` so normal pattern discovery scans only relevant shared `file_index` shards instead of sorting and filtering the whole watchdog path index
- file, folder, Git-history, module, extension, debug path-index, and direct app-file serving routes must ensure the authenticated user's full L2 file-index shard before reading user-owned file listings; auth-only request context is intentionally not enough for these surfaces
- batch operations validate all targets before any mutation begins
- `file_write` still defaults to full-file replacement, but object-form writes also support `operation: "append"`, `"prepend"`, or `"insert"`; insert writes accept exactly one of `line`, `before`, or `after`, use the first literal `before` or `after` match, and require `utf8` encoding
- when `USER_FOLDER_SIZE_LIMIT_BYTES` is positive, `file_write`, `file_copy`, `file_move`, `file_delete`, and module removal through `file_access.js` enforce the per-`L2/<user>/` folder quota before mutation; the shared quota helper should derive current totals and subtree deltas from indexed `sizeBytes` metadata instead of rescanning the whole user tree, and quota errors return `413`
- single-file or single-folder copy and move requests must keep working when request plumbing omits `entries`; only real batch calls should forward an `entries` array to the shared helper
- endpoint-specific validation should stay thin and reuse the shared helper contract
- `folder_download` supports `HEAD` for permission-only validation and `GET` or `POST` for the actual streamed ZIP response
- `folder_download` validates readable folder paths through the shared file-access permission model, creates a ZIP archive in `server/tmp/`, and returns a streamed attachment response without buffering the archive in memory
- `git_history_list` returns paginated local-history commit metadata for a readable or writable `L1/<group>/` or `L2/<user>/` owner root when `CUSTOMWARE_GIT_HISTORY` is enabled; it accepts `limit`, `offset`, and `fileFilter`, returns full per-commit file action metadata for listed commits, and does not return patch bodies
- `git_history_diff` returns the patch body for one file in one commit after read permission is verified
- `git_history_preview` returns affected-file metadata for a travel or revert operation after write permission is verified, and returns an operation-specific patch when `filePath` is provided
- `git_history_rollback` hard-resets a writable owner-root history repository to a requested commit, preserves ignored L2 auth files, preserves the previous head for forward travel when possible, and publishes the changed owner root through the shared mutation path after the reset
- `git_history_revert` creates a new commit that undoes a selected commit, preserves ignored L2 auth files, publishes the changed owner root through the shared mutation path after the revert, uses backend-owned reverse-merge semantics so later non-overlapping edits can still revert cleanly, and should return `409` when overlapping changes keep the selected commit from applying cleanly to the current worktree
- history endpoints delegate path normalization, permission checks, commit listing, diff reads, rollback, revert, and commit-loop suppression to `server/lib/customware/git_history.js`, and should preserve the underlying thrown error as `error.cause` when they translate backend failures into HTTP errors so router logging keeps the original stack
- mutating endpoints should go through `server/runtime/request_mutations.js` so clustered workers perform the local write first, then commit changed logical paths back to the primary once before the response finishes
- cross-worker follow-up freshness comes from `Space-State-Version` request or response fencing, not from waiting for every worker to acknowledge each write

Hosted share and import endpoints:

- `cloud_share_create`
- `cloud_share_info`
- `cloud_share_download`
- `cloud_share_clone`
- `space_import`

Current rules:

- `cloud_share_create`, `cloud_share_info`, `cloud_share_download`, and `cloud_share_clone` are explicit anonymous endpoints because custom apps may upload to a separate hosted receiver and share links must open before any session exists
- `cloud_share_create` accepts the raw ZIP bytes in the request body, stores them under `CUSTOMWARE_PATH/share/spaces/<token>.zip` with matching `<token>.json` metadata, enforces only the `2 MB` size cap plus optional password-encryption metadata validation, and defers ZIP content validation until import or clone time
- `cloud_share_create` requires both `CLOUD_SHARE_ALLOWED=true` and guest users enabled, and should fail when `CUSTOMWARE_PATH` is not configured because hosted shares are backend-owned server state, not app files
- `cloud_share_info` returns the stored metadata needed by the public share shell, including whether the share payload is password-encrypted and the KDF or cipher parameters required for client-side decryption
- `cloud_share_download` returns the raw stored ZIP bytes for a hosted share without unpacking it in the API handler
- `cloud_share_clone` accepts a ZIP payload that may already have been decrypted in the browser, validates and extracts it into a unique `server/tmp/` directory, creates a fresh guest account, installs the imported space as `imported-N`, updates the share metadata `lastUsedAt`, and returns the guest credentials plus redirect URL that the public share shell uses to finish the normal `/api/login_challenge` plus `/api/login` background login flow
- `space_import` is authenticated, accepts a raw ZIP request body, validates the archive through the shared hosted-share helper, and either replaces the current target space or installs a new `imported-N` destination when the caller keeps the current space instead of overwriting it
- both `cloud_share_clone` and `space_import` must reuse `server/lib/share/service.js` for archive validation, extracted-folder checks, destination naming, and install logic instead of adding endpoint-local ZIP handling

Module endpoints:
- `module_list`
- `module_info`
- `module_install`
- `module_remove`

Current rules:

- these endpoints delegate to `server/lib/customware/module_manage.js`
- request-time reads should consume shared-state shards instead of calling watchdog scan helpers directly
- writable operations must reuse the shared permission model and publish concrete changed logical paths through the shared mutation flow so the primary refreshes replicated module state
- when `USER_FOLDER_SIZE_LIMIT_BYTES` is positive, new `module_install` writes into `L2/<user>/` are measured in a system temp directory and quota-checked before the module tree is moved into the user folder

Runtime and identity endpoints:

- `extensions_load`
- `debug_path_index`
- `password_generate`
- `password_change`
- `user_crypto_bootstrap`
- `user_crypto_session_key`
- `user_self_info`

Important notes:

- `extensions_load` resolves module-owned `ext/...` request paths through the shared layered override system and supports grouped request batches
- `extensions_load` should read the shared-state shards for the caller's visible module owners rather than scanning watchdog paths directly; caller L2 shards may be loaded on demand
- `extensions_load` request bodies keep `maxLayer` at the call level; grouped lookups carry ordered `patterns` arrays only, and grouped responses return those normalized `patterns` alongside each request's resolved `extensions`
- `debug_path_index` is an authenticated debugging endpoint for clustered-runtime verification; it returns filtered local `path_index` compatibility entries from currently loaded shards plus a stable hash so tests can compare worker replicas without walking the filesystem directly
- `password_change` is an authenticated account endpoint for the current user only; it validates the current password through the auth service, rewrites the backend-sealed verifier, clears stored sessions, and clears the current browser auth cookie so the frontend can return to `/login`
- when the current account has a ready `userCrypto` record, `password_change` also requires a browser-produced replacement `userCryptoRecord` so the wrapped key survives self-service password rotation without re-encrypting user data
- `user_crypto_bootstrap` is an authenticated recovery endpoint for the current user; it reports the current `userCrypto` state and, when that state is `missing`, can mint a provisioning share and later accept the browser-generated wrapped record so the first authenticated app load can self-heal a missing record without requiring a second login
- `user_crypto_session_key` is an authenticated restore helper endpoint for the current user; it derives and returns the current session's localStorage wrapping key by hashing the backend `sessionId` with the server-held session secret, so the browser can decrypt or encrypt the single encrypted `localStorage` blob without the server persisting that wrapping key or the user master key
- frontend HTML anchors and JS hooks resolve through `ext/html/...` and `ext/js/...` request paths respectively
- frontend modules may also enumerate other extension-resolved metadata assets through this endpoint when those files should honor readable-layer permissions plus same-path layered overrides; the current first-party example is `ext/panels/*.yaml`
- `user_self_info` returns the authenticated user's derived identity plus browser-bootstrap crypto metadata: `{ username, fullName, groups, managedGroups, sessionId, userCryptoKeyId, userCryptoState }`
- `password_generate` is an authenticated utility endpoint that returns the backend-sealed `password.json` payload and should stay narrow

### Handler Contract

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

Throw errors with a `statusCode` when the route should return a non-500 error. The router treats explicit 4xx errors as expected client-error responses and returns them without backend `console.error` logging; unexpected errors and 5xx `statusCode` failures still produce one backend diagnostic log while redacting the browser response body.

## Work Guidance

### Local Work Rules

- keep endpoints narrow and explicit
- keep auth, permission, inheritance, and filesystem policy in shared helpers
- do not add endpoint-local filesystem walks when `file_index` shards or shared helpers already answer the question
- if frontend-facing API or extension-resolution semantics change, also update `app/L0/_all/mod/_core/skillset/ext/skills/development/` because the shared development skill mirrors this contract
- if endpoint-family semantics change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/server/api/`
- if you add or remove endpoints, or change endpoint-family semantics, update this file and `/server/AGENTS.md`

## Verification



## Child DOX Index

- No child DOX docs.
