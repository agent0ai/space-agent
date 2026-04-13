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

`fileList(...)` also accepts an options object. Use `access: "write"` or `writableOnly: true` when a browser surface needs server-confirmed writable paths. Use `gitRepositories: true` with writable access to list local-history owner roots without exposing `.git` metadata.

## Batch Semantics

Important shared rules:

- batch operations validate all targets before mutation begins
- single-path operations must keep working even when batch-only request fields are omitted
- permission, overlap, path-normalization, and duplication logic belong in `file_access.js`, not endpoint-local code
- clustered workers perform the filesystem mutation locally, then commit changed logical paths back to the primary once before the response finishes
- cross-worker follow-up freshness comes from `Space-State-Version` request or response fencing, not from waiting for every worker to acknowledge the write

## User Folder Quotas

`USER_FOLDER_SIZE_LIMIT_BYTES` optionally caps each on-disk `L2/<user>/` folder.

Current behavior:

- `0` disables the cap
- positive values are byte limits
- `file_write`, `file_copy`, `file_move`, `file_delete`, and module removal through `file_access.js` check projected quota impact before mutation
- if a user folder is at or below the limit, projected growth over the limit is rejected with `413`
- if a user folder is already over the limit, only mutations with a negative net size delta for that folder are allowed
- quota checks use cached per-user folder totals and per-operation deltas, so normal writes do not rescan the entire `L2/<user>/` tree
- other backend app-path mutation callers invalidate affected L2 cache entries through `recordAppPathMutations`, and Git history commits, rollback, and revert also invalidate affected entries because backend `.git` metadata can change outside the app-file mutation delta

## `file_paths`

`file_paths` is the pattern-discovery endpoint used by systems such as skill discovery.

It also accepts an optional explicit `maxLayer` filter when a caller needs module-oriented discovery to stay within a firmware or lower-layer ceiling. The current first-party example is the admin agent skill catalog, which resolves readable `mod/*/*/ext/skills/*/SKILL.md` files with `maxLayer=0` so writable customware layers do not influence prompt-facing skill text.

Behavior summary:

- accepts path patterns rather than exact file paths
- patterns are normalized before matching
- returns matched logical project paths grouped by the original pattern
- accepts `access: "write"` or `writableOnly: true` to limit matches to paths the user can write
- accepts `gitRepositories: true`; with a pattern such as `**/.git/`, it returns matching local-history owner roots such as `L1/team/` or `L2/alice/`, not the reserved `.git` paths themselves

It is the right tool for catalog discovery, not for raw filesystem walking.

## Folder Downloads

`folder_download` is special:

- supports `HEAD` for permission-only validation
- supports `GET` and `POST` for the actual ZIP download
- resolves readable folders through the shared permission model
- creates the archive in `server/tmp/`
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
- `git_history_list` accepts `path`, optional `limit`, optional `offset`, and optional `fileFilter`; plain filters match as open-ended changed-path or nested-filename substrings, and responses return a page of commit metadata with timestamps, hashes, `currentHash`, and full changed-file action entries for listed commits without loading patch bodies
- repository selectors should discover writable history roots through `file_paths` or `file_list` with `gitRepositories: true` and `access: "write"` before calling the history endpoints for a selected owner root
- `git_history_diff` accepts `path`, `commitHash`, and `filePath`, requires read permission, and returns the patch for that one file in that one commit
- `git_history_preview` accepts `path`, `commitHash`, `operation`, and optional `filePath`, requires write permission, returns affected files for travel or revert, and returns the operation-specific patch when a file is provided
- `git_history_rollback` accepts `path` plus `commitHash` or `commit`, requires write permission, preserves the previous head for forward travel when possible, hard-resets the owner repo, and suppresses history scheduling for the rollback itself
- `git_history_revert` accepts `path` plus `commitHash` or `commit`, requires write permission, and creates a new commit with inverse changes instead of moving the current point
