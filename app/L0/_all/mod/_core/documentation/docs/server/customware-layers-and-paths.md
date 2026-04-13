# Customware Layers And Paths

This doc covers the layered filesystem model behind `/mod/...` and the app-file APIs.

## Primary Sources

- `server/lib/customware/AGENTS.md`
- `server/lib/customware/layout.js`
- `server/lib/customware/file_access.js`
- `server/lib/customware/user_quota.js`
- `server/lib/customware/group_files.js`
- `server/lib/customware/git_history.js`
- `server/lib/customware/module_inheritance.js`
- `server/lib/customware/extension_overrides.js`
- `server/lib/customware/layer_limit.js`

## Logical Versus Disk Paths

The system works with logical app paths first.

Important logical forms:

- `/app/L0/...`
- `/app/L1/...`
- `/app/L2/...`
- `/mod/<author>/<repo>/...`
- `~/...`

Resolution rules:

- `/app/L0/...` always maps into repo `app/L0/...`
- `/app/L1/...` and `/app/L2/...` map into `CUSTOMWARE_PATH/L1/...` and `CUSTOMWARE_PATH/L2/...` when `CUSTOMWARE_PATH` is configured
- otherwise writable paths map into repo `app/L1/...` and `app/L2/...`
- `~/...` expands to the authenticated user's `L2/<username>/...`

## Permission Model

Core rules:

- nobody writes `L0`
- users can read their own `L2`
- users can read group roots they belong to
- users can write their own `L2`
- users can write `L1/<group>` only when they manage that group
- `_admin` members may write any `L1` or `L2` path

`file_access.js` is the canonical owner of these checks.

## User Folder Quotas

`USER_FOLDER_SIZE_LIMIT_BYTES` is an optional backend enforcement point for writable user roots.

Current contract:

- `0` disables quota checks
- positive values cap each resolved `L2/<user>/` folder in bytes
- app-file writes, copies, moves, and deletes are checked before mutation
- projected growth over the cap is rejected
- when a user folder is already over cap, only mutations that reduce that folder's net byte size are allowed
- quota accounting is cached per resolved L2 owner root and updated by mutation deltas instead of rescanning on every write
- other backend app-path mutation callers invalidate affected user quota cache entries through `recordAppPathMutations`, and Git history operations invalidate the affected cache when `.git` metadata may have changed
- clustered workers still perform the filesystem mutation locally, but they must publish the exact changed logical paths back to the primary so quota, user, and group derived state stays aligned across workers

## Optional Git History

`CUSTOMWARE_GIT_HISTORY` can turn writable owner roots into local history repositories.

Current contract:

- the parameter defaults to `true`
- each writable `L1/<group>/` and `L2/<user>/` root is its own local Git repository when history is enabled
- mutations schedule a commit after 10 seconds of quiet for that owner root
- in clustered runtime, workers do not keep their own debounced Git commit timers; they publish changed logical paths once, and the primary schedules the owner-root commit after rebuilding the authoritative indexes for that change
- if an owner root keeps receiving writes, the debounce drops to 5 seconds after 1 minute of waiting, 1 second after 5 minutes, and immediate commit after 10 minutes
- pending commits are flushed during server shutdown
- history listing is paginated with `limit` and `offset`, may filter by changed file path or nested filename substring, and returns metadata plus full per-commit file action entries for listed commits without loading full diffs
- repository discovery for browser pickers goes through `file_list` or `file_paths` with `gitRepositories: true` and, when needed, `access: "write"`; the response contains writable owner roots such as `L1/<group>/` and `L2/<user>/`, never `.git` metadata paths
- file diff reads, operation previews, and commit revert operations are separate history helper calls
- operation previews require write access and return affected-file metadata for travel or revert, plus an operation-specific patch when a single file is requested
- rollback resets the owner root to a requested commit, preserves the previous head for forward travel when possible, and suppresses history scheduling so rollback does not create a commit loop
- revert creates a new history commit with inverse changes instead of resetting the owner root to the selected commit
- owner repos carry a `.gitignore`; `L2` repos ignore `meta/password.json` and `meta/logins.json`, while `L1` repos currently use an empty ignore file
- rollback preserves ignored L2 auth files so old commits cannot log the user out or restore an old password verifier
- `.git` paths are reserved infrastructure and are excluded from path indexes, app-file APIs, and direct app fetches

## Group Graph

`group.yaml` is the canonical input for group membership and management.

Current fields:

- `included_users`
- `included_groups`
- `managing_users`
- `managing_groups`

`group_index.js` derives the readable and manageable graph from those files.

CLI group writes go through `group_files.js`. `node space group add` and `node space user create --groups ...` create the target writable `L1/<group>/` root when it is missing, then write membership to `group.yaml`. This also works for predefined runtime group ids such as `_admin`, whose group identity exists even before a writable `L1/_admin/group.yaml` file is created.

When `CUSTOMWARE_PATH` is configured, run `node space set CUSTOMWARE_PATH=<path>` before creating users or groups so those CLI writes land under the configured `CUSTOMWARE_PATH/L1` and `CUSTOMWARE_PATH/L2` roots.

## Override Order

High-level override order:

1. `L0/_all`
2. accessible `L0/<group>/...`
3. `L1/_all`
4. accessible `L1/<group>/...`
5. `L2/<username>`

Resolution rules:

- exact same override keys replace lower-ranked entries
- different extension filenames under one extension point compose together
- `module_inheritance.js` owns `/mod/...` resolution
- `extension_overrides.js` owns extension lookup resolution
- request-time module and extension lookup reads replicated shared-state shards for the relevant readable owners instead of scanning the full watchdog path index

## `maxLayer`

`maxLayer` limits module and extension lookup, not normal app-file APIs. The narrow first-party exception is explicit module-oriented `file_paths` discovery when a caller passes `maxLayer` intentionally, such as the admin agent's firmware-clamped `ext/skills` catalog lookup.

Examples:

- default app pages allow `L0 -> L1 -> L2`
- `/admin` effectively clamps lookup to `L0`

`layer_limit.js` owns the normalization and request-level resolution logic.

## Why This Matters To The Agent

This model explains why:

- a stable `/mod/...` import may resolve to different backing files for different users
- docs and skills can be delivered by normal modules
- direct app-file reads and writes use logical layer paths even when writable storage is moved outside the repo
- concrete changed file paths matter for incremental index rebuilds; publishing only a parent directory can leave derived state stale until a later reconcile
