# File APIs

This doc covers the authenticated app-file endpoint family and the matching frontend helpers.

## Primary Sources

- `server/api/AGENTS.md`
- `server/lib/customware/AGENTS.md`
- `server/lib/customware/file_access.js`
- `server/lib/customware/user_quota.js`
- `app/L0/_all/mod/_core/framework/js/api-client.js`

## File Endpoint Family

Current file endpoints:

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

These endpoints should stay thin and delegate to `server/lib/customware/file_access.js`.
The history endpoints delegate to `server/lib/customware/git_history.js`.

## Path Forms

The file APIs accept logical app paths, not raw disk paths.

Common forms:

- `L2/alice/note.txt`
- `/app/L2/alice/note.txt`
- `~/note.txt`
- `~/folder/`

Important rules:

- directories are usually identified with a trailing `/`
- `~` and `~/...` expand to the authenticated user's `L2/<username>/...`
- logical paths do not change when `CUSTOMWARE_PATH` relocates writable storage

## Frontend Helper Surface

`space.api` exposes matching helpers:

- `fileRead(...)`
- `fileWrite(...)`
- `fileDelete(...)`
- `fileInfo(...)`
- `fileCopy(...)`
- `fileMove(...)`
- `fileList(pathOrOptions, recursive?)`
- `folderDownloadUrl(pathOrOptions)`
- `gitHistoryList(pathOrOptions, limit?)`
- `gitHistoryDiff(pathOrOptions, commitHash?, filePath?)`
- `gitHistoryPreview(pathOrOptions, commitHash?, operation?, filePath?)`
- `gitHistoryRollback(pathOrOptions, commitHash?)`
- `gitHistoryRevert(pathOrOptions, commitHash?)`

These helpers accept single-path forms and composed batch forms where appropriate.

The current frontend `fileRead(...)` wrapper also coalesces same-tick reads into one backend `file_read` request when possible, then re-slices the results back to each caller. If that combined read fails, it retries the queued entries individually so shorthand paths like `~/...` and optional missing-file callers still behave like standalone reads.

`fileWrite(...)` still accepts the simple replacement form `fileWrite(path, content, encoding?)`, but object-form writes now also support incremental mutations:

- `{ path, content, operation: "append" }`
- `{ path, content, operation: "prepend" }`
- `{ path, content, operation: "insert", line: 1 }`
- `{ path, content, operation: "insert", before: "## Notes" }`
- `{ path, content, operation: "insert", after: "## Notes" }`

`operation` defaults to `replace`. Insert writes accept exactly one anchor through `line`, `before`, or `after`. `line` is a 1-based insertion point, where `1` inserts at the top of the file and the next insertion point after the last line appends at the end. `before` and `after` use the first literal match in the current file. Insert writes require `utf8`; append, prepend, and replace keep the normal `utf8` or `base64` encoding support. Directory writes still use the trailing-slash path form and remain replace-only path creation. Batch writes may set `operation`, `line`, `before`, or `after` per entry, or once at the top level as defaults for every entry in the batch.

`fileList(...)` also accepts an options object. Use `access: "write"` or `writableOnly: true` when a browser surface needs server-confirmed writable paths. Use `gitRepositories: true` with writable access to list local-history owner roots without exposing `.git` metadata.

## Batch Semantics

Important shared rules:

- batch operations validate all targets before mutation begins
- single-path operations must keep working even when batch-only request fields are omitted
- permission, overlap, path-normalization, and duplication logic belong in `file_access.js`, not endpoint-local code
- clustered workers perform the filesystem mutation locally, then commit changed logical paths back to the primary once before the response finishes
- cross-worker follow-up freshness comes from `Space-State-Version` request or response fencing, not from waiting for every worker to acknowledge the write

## Clustered Write Pressure

The repeatable clustered-write benchmark lives at `tests/server_cluster_write_stress_test.mjs`.

Use it when `space-serve-p` is the process consuming CPU under write-heavy clustered load. The harness can:

- seed large temporary `L2/<user>/` trees before the write burst, including many synthetic user roots
- drive concurrent `/api/file_write` requests through a single-process `--workers 1` baseline or multiple clustered workers
- record initial startup and optional restart timings against the same seeded tree so large multi-user storage can be compared against a 30-second startup window
- pass `--watchdog false` to launch the same clustered runtime with `CUSTOMWARE_WATCHDOG=false`, which preserves L0/L1 startup indexing plus explicit worker mutation sync while disabling background `fs.watch`, config watching, and reconcile activity
- report latency percentiles, throughput, and per-process CPU deltas for the clustered primary and workers
- optionally capture the clustered primary CPU profile for the write window

The expected hot path is primary-owned:

- workers mutate the filesystem locally, then publish the changed logical paths once through the clustered mutation channel
- the clustered primary handles that request in `server/runtime/cluster.js`, calls `watchdog.applyProjectPathChanges(...)`, and republishes the resulting state delta
- the watchdog now narrows that sync to the exact changed path plus only the nearest affected or still-missing ancestor directories, patches the affected `file_index` shard entries, returns the refreshed L2 shard only to the mutating worker, and publishes a tiny replicated L2 version marker so other workers know their local shard is stale
- if a mutation removes a loaded L2 shard, that returned lazy shard is an empty tombstone so the mutating worker clears stale local entries immediately
- ordinary file writes should stay exact-entry operations; subtree removal and recursive walks are reserved for directory sync, directory replacement, directory deletion, and full rescans
- watcher cleanup belongs to deleted paths and directory syncs; ordinary file writes should not scan the directory-watcher map

When throughput falls as seeded file count rises and the benchmark shows the primary near one full core while workers stay much lower, inspect that primary-side state rebuild path first. The main source files are `server/runtime/cluster.js`, `server/lib/file_watch/watchdog.js`, `server/lib/file_watch/state_shards.js`, and `server/runtime/state_system.js`.

If `--watchdog false` produces nearly the same write timings as `--watchdog true`, the bottleneck is not background watcher churn. It is usually the explicit primary-owned mutation path itself: parent-directory rescans inside `watchdog.js`, shard rebuild or patch work in `state_shards.js`, and replicated-state clone or compare work in `state_system.js`.

Current optimization guidance:

- if startup or restart is slow with many users, confirm `watchdog.js` is not enumerating `L2/<user>` roots and that startup `indexedUsers` remains `0`; auth-only user state may load after login or cookie checks, while full L2 user shards should appear only after file/module requests or mutations for those users
- if writes are still primary-bound after that, the remaining costs are usually directory subtree resync inside `watchdog.js` and full shard object clone or compare work in `state_system.js`, not `fs.watch`

## Clustered Read Pressure

The repeatable clustered-read benchmark lives at `tests/server_cluster_read_stress_test.mjs`.

Use it when module resolution, extension discovery, or indexed pattern listing is suspected of slowing down under many `L2/<user>/` roots. The harness can:

- seed a temporary customware tree with the implicit single-user `L2/user/` root plus many additional synthetic `L2` users
- drive concurrent `/mod/...` fetches that exercise inherited module resolution and file streaming
- drive concurrent `/api/file_paths` requests with module-style glob patterns such as panel YAML, skill `SKILL.md`, JS, and CSS discovery
- run `--workers 1` as a single-process baseline or larger clustered worker counts for comparison
- compare forced connection churn with `--connection close` against HTTP keep-alive reuse with `--connection keep-alive`
- report throughput, latency percentiles, indexed path counts, indexed startup user counts, returned match counts, worker distribution, startup timing, and per-process CPU deltas

The two modes measure different costs:

- `--mode mod` reads the relevant shared `file_index` shards for the active user and groups, resolves the inherited module file, and streams it
- `--mode file-paths` lists indexed app paths by glob pattern, so it is the better probe for discovery calls that must filter large indexes by pattern and access rules

## User Folder Quotas

`USER_FOLDER_SIZE_LIMIT_BYTES` optionally caps each on-disk `L2/<user>/` folder.

Current behavior:

- `0` disables the cap
- positive values are byte limits
- `file_write`, `file_copy`, `file_move`, `file_delete`, and module removal through `file_access.js` check projected quota impact before mutation
- if a user folder is at or below the limit, projected growth over the limit is rejected with `413`
- if a user folder is already over the limit, only mutations with a negative net size delta for that folder are allowed
- quota checks use cached per-user folder totals plus indexed per-operation deltas from loaded `file_index` `sizeBytes` metadata, so normal writes do not rescan the entire `L2/<user>/` tree
- other backend app-path mutation callers invalidate affected L2 cache entries through `recordAppPathMutations`, and Git history commits, rollback, and revert also invalidate affected entries because backend `.git` metadata can change outside the app-file mutation delta

## `file_paths`

`file_paths` is the pattern-discovery endpoint used by systems such as skill discovery and dashboard panel discovery.

It also accepts an optional explicit `maxLayer` filter when a caller needs module-oriented discovery to stay within a firmware or lower-layer ceiling. The current first-party example is the dashboard panel index, which resolves readable `mod/*/*/ext/panels/*.yaml` files before batch-reading them through `file_read`.

Behavior summary:

- accepts path patterns rather than exact file paths
- patterns are normalized before matching
- returns matched logical project paths grouped by the original pattern
- accepts `access: "write"` or `writableOnly: true` to limit matches to paths the user can write
- accepts `gitRepositories: true`; with a pattern such as `**/.git/`, it returns matching local-history owner roots such as `L1/team/` or `L2/alice/`, not the reserved `.git` paths themselves
- normal request-time pattern matching first ensures the current user's full L2 shard, then reads shared `file_index` shards so readable discovery scans only `L0`, readable `L1` group shards, and that demand-loaded `L2` shard instead of scanning every user's indexed paths

It is the right tool for catalog discovery, not for raw filesystem walking.

## Folder Downloads

`folder_download` is special:

- supports `HEAD` for permission-only validation
- supports `GET` and `POST` for the actual ZIP download
- resolves readable folders through the shared permission model
- creates the archive in `server/tmp/` with the backend Node ZIP helper instead of a host `zip` binary
- streams the attachment instead of buffering the ZIP into browser memory

Frontend code that wants an attachment-style download should prefer:

```js
space.api.folderDownloadUrl(path)
```

instead of manually fetching the blob into browser memory.

## Writable-Layer Git History

`CUSTOMWARE_GIT_HISTORY` enables optional local Git history for writable owner roots.

Behavior summary:

- the flag defaults to `true`
- each `L1/<group>/` and `L2/<user>/` owner root is committed as its own local repository when mutations are quiet for 10 seconds
- long write bursts shorten the pending debounce to 5 seconds after 1 minute, 1 second after 5 minutes, and immediate commit after 10 minutes
- app-file writes, deletes, copies, moves, group/user/auth writes, and module installs schedule history for the affected owner root
- L2 history repos ignore `meta/password.json` and `meta/logins.json`; rollback preserves those files instead of resetting them to old committed state
- L1 history repos still get a `.gitignore`, currently empty
- `.git` metadata is reserved and blocked from app-file reads, writes, direct fetches, and path indexes
- `git_history_list` accepts `path`, optional `limit`, optional `offset`, and optional `fileFilter`; plain filters match as open-ended changed-path or nested-filename substrings, responses return a page of commit metadata with timestamps, hashes, `currentHash`, and full changed-file action entries for listed commits without loading patch bodies, and filtered pages may return `total: null` when `hasMore` is already known without a full scan
- repository selectors should discover writable history roots through `file_paths` or `file_list` with `gitRepositories: true` and `access: "write"` before calling the history endpoints for a selected owner root
- `git_history_diff` accepts `path`, `commitHash`, and `filePath`, requires read permission, and returns the patch for that one file in that one commit
- `git_history_preview` accepts `path`, `commitHash`, `operation`, and optional `filePath`, requires write permission, returns affected files for travel or revert, and returns the operation-specific patch when a file is provided
- `git_history_rollback` accepts `path` plus `commitHash` or `commit`, requires write permission, preserves the previous head for forward travel when possible, hard-resets the owner repo, and suppresses history scheduling for the rollback itself
- `git_history_revert` accepts `path` plus `commitHash` or `commit`, requires write permission, creates a new commit with inverse changes instead of moving the current point, uses a Git-like reverse merge so later non-overlapping edits can still revert cleanly, and returns `409` when overlapping changes keep the selected commit from applying cleanly to the current worktree; conflict responses should identify the blocking file and, when available, the current versus expected file versions
