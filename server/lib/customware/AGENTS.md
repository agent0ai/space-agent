# AGENTS

## Purpose

`server/lib/customware/` owns the layered app filesystem and module model.

This subtree is the canonical place for logical app-path normalization, customware-root resolution, group-derived permissions, layer limits, module inheritance, extension override resolution, app-file access, and module management. Do not re-implement those rules elsewhere.

Documentation is top priority for this subtree. After any change under `server/lib/customware/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `layout.js`: path normalization, entity-id normalization, logical-to-disk resolution for `L0`/`L1`/`L2`, and parser helpers for app, group, user, module, and extension paths
- `layer_limit.js`: `maxLayer` parsing, normalization, and request-level resolution
- `module_state.js`: shared-state-backed module/group index readers and shard-scoped module discovery helpers
- `git_history.js`: optional per-owner local Git history scheduling, repository discovery, commit listing, rollback, and `.git` metadata shielding for writable `L1` and `L2`
- `user_quota.js`: optional per-user `L2` folder size accounting, cached current-size reads, and quota projection checks for app-file mutations
- `group_files.js`: normalized `L1/<group>/group.yaml` read and write helpers used by CLI-managed group editing; membership adds ensure the target writable group directory exists first
- `group_index.js`: derived group membership and management graph from `group.yaml`
- `overrides.js`: inheritance ranking, accessible module collection, and override selection
- `module_inheritance.js`: `/mod/...` file resolution through layered overrides
- `extension_overrides.js`: extension request-path resolution and grouped batched extension lookup
- `file_access.js`: canonical app-file permission model, file operations, and readable-folder download resolution
- `module_manage.js`: module list, info, install, remove, and Git metadata helpers

## Path And Permission Contract

Path rules:

- app-rooted paths normalize to `/app/...`
- logical `/app/L0/...` always resolve under repo `app/L0/...`
- logical `/app/L1/...` and `/app/L2/...` resolve under `CUSTOMWARE_PATH/L1/...` and `CUSTOMWARE_PATH/L2/...` when `CUSTOMWARE_PATH` is configured, otherwise under repo `app/L1/...` and `app/L2/...`
- writable user-relative shorthand `~` and `~/...` are expanded by `file_access.js`
- module request paths normalize under `/mod/...`
- group and user ids are normalized through `normalizeEntityId(...)`

Permission rules:

- nobody writes `L0`
- users may write their own `L2/<username>/`
- users may write `L1/<group>/` only when they manage that group
- `_admin` members may write any `L1/` and `L2/` path
- readable group membership comes from the derived `group_index`
- when `SINGLE_USER_APP` is enabled, runtime permission helpers treat the implicit `user` principal as a virtual `_admin` member even if no user or group files exist on disk

`group.yaml` contract:

- `included_users`
- `included_groups`
- `managing_users`
- `managing_groups`

Those fields are the canonical inputs for the derived membership and management graph.

CLI group-editing rules:

- `group create` explicitly creates a writable `L1/<group>/` root
- `group add` and `user create --groups ...` may create the target writable `L1/<group>/` root automatically before writing membership, including `_admin`
- those writes must pass the resolved runtime params into `group_files.js` so configured `CUSTOMWARE_PATH` roots are honored

## Inheritance And Override Contract

Module and extension resolution is layered and rank-based.

High-level resolution order:

- `L0/_all`
- accessible `L0/<group>/` entries in group order
- `L1/_all`
- accessible `L1/<group>/` entries in group order
- `L2/<username>`

Important rules:

- `layer_limit.js` constrains module and extension resolution through `maxLayer`
- `layer_limit.js` also accepts `X-Space-Max-Layer` as an explicit request-level override source for module and extension fetches
- worker-side module lookup must read replicated `file_index` and group shards from the shared `stateSystem`; only the primary watchdog owns filesystem scanning and shard publication
- frontend HTML anchors resolve through module `ext/html/...` paths and JS hooks resolve through module `ext/js/...` paths
- modules may also resolve other extension-owned assets through the same ranked `ext/...` override model when the frontend calls `extensions_load` directly; the current first-party example is `ext/pages/*.yaml`
- exact same override keys replace lower-ranked entries
- different extension filenames under the same extension point compose together
- `module_inheritance.js` and `extension_overrides.js` are the only supported paths for `/mod/...` and extension resolution

## File And Module Management Contract

`file_access.js` is the canonical entry point for:

- app-file list
- app-file read
- app-file write
- app-file delete
- app-file copy
- app-file move
- app-file info
- readable folder-download permission and path resolution for `folder_download`
- pattern-based `file_paths` lookup
- write-access-filtered `file_list` and `file_paths` discovery, including local-history repository root discovery that never exposes `.git` metadata

Rules:

- batch file operations must validate all targets before mutation begins
- single-path app-file deletes must continue to work when request plumbing passes `paths: undefined`; only an explicit non-array `paths` value should be rejected as malformed batch input
- keep permission, duplication, overlap, path-normalization, and logical-to-disk resolution logic centralized here
- frontend callers should derive writable roots from the canonical permission rules and the `user_self_info` identity fields instead of depending on a serialized scope payload
- callers that need server-confirmed writable discovery may pass `access: "write"` or `writableOnly: true` to `file_list` or `file_paths`; repository pickers may add `gitRepositories: true` with a pattern such as `**/.git/` to receive writable owner roots like `L1/<group>/` and `L2/<user>/`
- when `CUSTOMWARE_GIT_HISTORY` is enabled, writable `L1` and `L2` file mutations schedule debounced per-owner Git history commits; in clustered runtime, worker writes defer that scheduling to the primary after it rebuilds the authoritative watchdog state for the changed logical paths
- when `USER_FOLDER_SIZE_LIMIT_BYTES` is positive, `file_access.js` must check all app-file writes, copies, moves, and deletes through `user_quota.js` before mutation; projected growth over the cap is rejected, while a user folder already over cap may only perform mutations whose net `L2/<user>/` size delta is negative
- user-folder quota accounting is cached per resolved `L2/<user>/` root and normal app-file mutations update that cache by byte deltas instead of rescanning the whole folder on every write; other backend app-path mutation callers invalidate the affected cache through `recordAppPathMutations`, and Git history commits, rollback, and revert also invalidate affected L2 quota cache entries because backend `.git` metadata can change outside the app-file mutation delta

`module_manage.js` is the canonical entry point for:

- visible module discovery
- module metadata lookup
- Git-backed installs and updates
- module removal

Module discovery rules:

- request-time module reads and listings must consume replicated shared-state shards instead of calling watchdog path-walk helpers directly
- normal override resolution should limit shard reads to readable `L0`, readable `L1`, and the authenticated user's `L2`
- admin-only cross-user module listings may expand to selected `L2/<user>` shards or all replicated `L2/*` shards as needed, but should still stay shard-scoped instead of scanning the whole app index

When `USER_FOLDER_SIZE_LIMIT_BYTES` is positive, first-time module installs into `L2/<user>/` must clone into a system temp directory first, measure that tree, and pass the quota projection before moving it into the user folder. Existing module updates still invalidate affected user quota cache entries after mutation because their final Git object growth is not known until the update completes.

Current module-list areas are:

- `l1`
- `l2_self`
- `l2_user`
- `l2_users`

Admin-only access is required for aggregated or cross-user user-layer listings.

`git_history.js` is the canonical entry point for optional per-owner writable-layer history:

- `CUSTOMWARE_GIT_HISTORY=false` disables automatic history scheduling, but the runtime parameter defaults to `true`
- each writable `L1/<group>/` and `L2/<user>/` owner root may become its own local Git repository when history is enabled
- file writes, deletes, copies, moves, auth/user writes, group writes, and module installs schedule a debounced commit for the affected owner root
- in clustered runtime, workers must not keep their own owner-root Git commit debounces; they publish changed logical app paths once, and the primary schedules the debounced commit after `applyProjectPathChanges(...)` finishes rebuilding the authoritative indexes
- the debounce window starts at 10 seconds of quiet, drops to 5 seconds after a pending owner root has waited more than 1 minute, drops to 1 second after 5 minutes, and commits immediately after 10 minutes
- server shutdown flushes pending commits
- commit listing supports page `limit`, page `offset`, and open-ended `fileFilter` matching across changed paths and nested filenames; filtered list responses include full per-commit file action entries for listed commits, not only the matching files, but still do not include patch bodies
- file diff reads, operation previews, and commit revert operations are separate helper calls so list pages stay fast
- repository discovery reuses the history target and permission model, returns owner roots rather than `.git` paths, and supports write-access filtering for Time Travel repository selection
- operation previews require write access, return the files affected by travel or revert, and can return an operation-specific patch for one file
- rollback suppresses scheduling so resetting a worktree does not create a commit loop
- rollback preserves the previous head in backend-owned history refs when possible so commits after the travelled-to point remain listable for forward travel
- revert creates a new history commit that undoes the selected commit instead of resetting the worktree to that commit
- each owner repository has a `.gitignore`; `L2` repositories must ignore `meta/password.json` and `meta/logins.json`, while `L1` group repositories currently use an empty ignore file
- rollback snapshots and restores the ignored L2 auth files so old commits cannot log the user out or resurrect an old password verifier
- `.git` metadata paths are reserved and must not be exposed through app-file APIs, direct app fetches, or path indexes

## Development Guidance

- do not add ad hoc filesystem walks or permission checks to endpoints when this subtree already owns the rule
- keep changes to path semantics, inheritance, or permissions centralized here
- publish logical app-path mutations through the shared mutation-capture path after mutations that affect indexed module, group, user, or file state
- if path, layer, module-resolution, or permission rules change, also update `app/L0/_all/mod/_core/skillset/ext/skills/development/` because the shared development skill mirrors this contract
- if path, layer, module-resolution, or permission rules change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/server/`
- if you change path normalization, group semantics, `maxLayer`, file access, or module-management rules, update this file and the relevant server or API docs in the same session
