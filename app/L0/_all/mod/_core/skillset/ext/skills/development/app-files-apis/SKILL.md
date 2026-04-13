---
name: App Files And APIs
description: Use the frontend API surface correctly for app files, discovery, identity, and permission-aware browser data access.
---

Use this skill when frontend code needs to read or write app files, inspect the current user, discover files by pattern, or call backend endpoints from the browser.

## Core Frontend API Surface

The shared frontend runtime exposes authenticated backend helpers through `space.api`.

Current wrapped helpers include:

- `await space.api.fileList(pathOrOptions, recursive?)`
- `await space.api.fileRead(pathOrFiles, encoding?)`
- `await space.api.fileWrite(pathOrFiles, content?, encoding?)`
- `await space.api.fileDelete(pathOrPaths)`
- `await space.api.fileCopy(pathOrEntries, toPath?)`
- `await space.api.fileMove(pathOrEntries, toPath?)`
- `await space.api.fileInfo(pathOrOptions)`
- `space.api.folderDownloadUrl(pathOrOptions)`
- `await space.api.gitHistoryList(pathOrOptions, limit?)`
- `await space.api.gitHistoryDiff(pathOrOptions, commitHash?, filePath?)`
- `await space.api.gitHistoryPreview(pathOrOptions, commitHash?, operation?, filePath?)`
- `await space.api.gitHistoryRollback(pathOrOptions, commitHash?)`
- `await space.api.gitHistoryRevert(pathOrOptions, commitHash?)`
- `await space.api.userSelfInfo()`
- `await space.api.call("endpoint_name", { method, query, body, headers, signal })`

Use `space.api.folderDownloadUrl(...)` when the browser should trigger a regular authenticated folder download without buffering the ZIP file into frontend memory first.

When a UI needs user-visible download failure feedback without fetching the archive blob into memory, preflight the request with `space.api.fileInfo(...)` for files or `space.api.call("folder_download", { method: "HEAD", query: { path } })` for folders before starting the browser download.

`fileList(...)` accepts `{ access: "write" }` or `{ writableOnly: true }` when discovery must be limited to writable paths. Use `{ gitRepositories: true, access: "write" }` or `space.api.call("file_paths", { method: "POST", body: { patterns: ["**/.git/"], gitRepositories: true, access: "write" } })` to discover writable local-history owner roots; the server returns paths such as `L1/team/` and `L2/alice/`, not `.git` metadata.

`gitHistoryList(...)`, `gitHistoryDiff(...)`, `gitHistoryPreview(...)`, `gitHistoryRollback(...)`, and `gitHistoryRevert(...)` are available only when the backend runtime has `CUSTOMWARE_GIT_HISTORY=true`. They operate on writable owner roots such as `~`, `L2/<user>/`, or `L1/<group>/`; list supports `limit`, `offset`, and `fileFilter`, preview returns affected files and optional operation-specific patches for travel or revert, diff reads one commit-file patch, rollback requires write permission and preserves ignored L2 auth files plus forward-travel refs, and revert creates a new inverse commit. The first-party `#/time_travel` page defaults to the authenticated user's `~` history and can switch to write-accessible `L1` or `L2` history roots through the repository picker.

## Logical Path Rules

- Use logical app-rooted paths such as `L2/alice/user.yaml`, not disk paths.
- `~` and `~/...` target the authenticated user's `L2/<username>/...` path.
- These logical paths do not change when writable storage moves under `CUSTOMWARE_PATH`.
- `fileWrite(".../")` creates a directory because the path ends with `/`.
- `.git` metadata under writable owner roots is server infrastructure and is blocked from app-file reads, writes, direct fetches, and indexed discovery.

## Discovery Rules

- Use permission-aware APIs, not ad hoc browser path guesses.
- Use `space.api.call("file_paths", { method: "POST", body: { patterns: [...] } })` for indexed glob discovery; add `access: "write"` for writable-only results.
- Use `space.api.call("module_list", ...)` only when you need module inventory metadata rather than raw file paths.
- Use `space.api.call("extensions_load", ...)` when the browser needs module-owned `ext/...` assets resolved with layered override behavior, such as HTML adapters, JS hooks, or the dashboard's `ext/pages/*.yaml` page manifests.

## Storage Rules

- Browser storage is for small non-authoritative UI state.
- Persistent user or group state should live in app files or explicit backend APIs.
- Use `space.config` only for frontend-exposed runtime params, not for general persistence.

## Identity Snapshot

- `space.api.userSelfInfo()` returns `{ username, fullName, groups, managedGroups }`.
- Treat `app/` as the frontend repo tree and `server`, `commands`, and `packaging` as read-only from this frontend skill set.
- The current user may always write `L2/<username>/` and `L2/<username>/mod/`.
- The current user may write `L1/<group>/` and `L1/<group>/mod/` for each entry in `managedGroups`.
- If `groups` includes `_admin`, the user may write any `L1/<group>/...` or `L2/<user>/...` path except `L0`, which remains firmware-only.
- Readable group roots still follow group membership and layer rules; use `development/layers-ownership` when you need the full read-resolution model.

## Boundary Rule

- This skill is for consuming backend APIs from the frontend.
- Do not change backend handlers from this skill set; load `development/backend-reference` when you need the read-only backend model behind these APIs.
- Prefer frontend logic plus existing `space.api` helpers over asking for new backend endpoints.
- Ask for backend permission only when the browser cannot safely enforce the required security, integrity, cross-user, or stability boundary on its own.

## Mandatory Doc Follow-Up

- If the frontend API surface, app-file path rules, or indexed discovery behavior change, update the mirrored docs and the `development` skill subtree in the same session.
