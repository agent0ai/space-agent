# Module And Runtime APIs

This doc covers the non-file API families that matter most to the browser agent.

## Primary Sources

- `server/api/AGENTS.md`
- `server/lib/customware/module_manage.js`
- `server/lib/auth/service.js`
- `app/L0/_all/mod/_core/framework/js/api-client.js`

## Public Auth And Health Endpoints

Current public endpoints:

- `health`
- `guest_create`
- `login_challenge`
- `login`
- `login_check`

Important notes:

- these are the only explicitly anonymous endpoint families today
- password login flows through the shared auth challenge/proof service
- `guest_create` creates a guest `L2` user only when runtime config allows guest accounts
- in clustered runtime, login challenges are coordinated through the primary-only `login_challenge` area of the unified state system while workers still validate cookies and write `logins.json`

## Module Endpoints

Current module endpoints:

- `module_list`
- `module_info`
- `module_install`
- `module_remove`

These delegate to `server/lib/customware/module_manage.js`.

Important behaviors:

- module writes must reuse shared permission rules
- module writes should publish changed logical paths through the shared mutation commit flow so every worker sees the new module state before the response finishes
- request-time module list and info reads consume replicated shared-state shards, usually only the readable `L1` roots plus the caller's own `L2`, instead of scanning the full app index
- when `USER_FOLDER_SIZE_LIMIT_BYTES` is positive, new L2 module installs are cloned into a system temp directory, measured, and quota-checked before they are moved into `L2/<user>/mod/...`
- module list surfaces distinguish areas such as `l1`, `l2_self`, `l2_user`, and `l2_users`
- cross-user or aggregated user-layer module listings are admin-only
- follow-up requests that depend on the new module state rely on `Space-State-Version` fencing rather than a cluster-wide worker acknowledgement barrier

## Runtime And Identity Endpoints

Important runtime endpoints:

- `extensions_load`
- `debug_path_index`
- `password_generate`
- `user_self_info`

`extensions_load`:

- resolves module-owned `ext/...` files through the layered override system
- supports grouped extension lookups
- is the shared backend for frontend extension loading
- reads the replicated shared-state shards needed for the caller's visible module owners instead of scanning the full watchdog path index
- receives grouped lookup batches from the frontend; the batching policy itself lives in the frontend loader, not in the endpoint contract
- first-party HTML anchors and JS hooks use it for `ext/html/...` and `ext/js/...`
- first-party page indexing also uses it to enumerate `ext/pages/*.yaml` manifests while still honoring readable-layer permissions and same-path overrides

`debug_path_index`:

- is authenticated and intended for clustered-runtime verification
- returns filtered local `path_index` entries, the local index size, and a stable hash of the returned entry set
- accepts exact `path` or `paths` plus directory `prefix` or `prefixes`
- is meant for tests and temporary diagnostics, not for general frontend workflows

`user_self_info`:

- is the canonical frontend identity snapshot
- returns `{ username, fullName, groups, managedGroups }`
- should be used by browser code to infer writable roots instead of relying on a broader serialized permission blob

`password_generate`:

- is authenticated
- returns a backend-sealed password payload
- should stay narrow and backend-owned

## Health Helper

The frontend API client exposes `space.api.health()` for the health endpoint.

It returns a small status shape rather than a broad runtime dump.

## Related Docs

- `server/customware-layers-and-paths.md`
- `server/auth-and-sessions.md`
- `app/modules-and-extensions.md`
