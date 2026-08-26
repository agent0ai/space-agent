# AGENTS

## Purpose

`server/lib/git/` owns the Git backend abstraction used by source-checkout update flows and Git-backed module installs.

It provides a stable interface over multiple backend implementations so the rest of the server and CLI can talk to Git without coupling themselves to one transport.

Documentation is top priority for this subtree. After any change under `server/lib/git/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `client_interface.js`: shared Git client assertions and interface shape
- `client_create.js`: backend selection and client creation
- `native_handler.js`: native Git backend
- `isomorphic_handler.js`: isomorphic-git backend
- `local_history.js`: per-directory local-history client selection for app-layer owner repositories
- `shared.js`: shared backend-selection, remote-sanitization, and history path-filter helpers

## Local Contracts

### Backend Selection Contract

Current backend order:

- `native`
- `isomorphic`

Current rules:

- `createGitClient({ projectRoot, runtimeParams? })` resolves the best available client for local repo operations
- `cloneGitRepository({ ..., runtimeParams? })` resolves the best available clone client for remote installs
- `createLocalGitHistoryClient({ repoRoot, runtimeParams? })` resolves the best available local-history client for per-owner `L1/<group>/` and `L2/<user>/` repositories
- runtime param `GIT_BACKEND` may force a specific backend name for server-owned Git flows; `auto` keeps the default `native -> isomorphic` fallback order
- non-runtime-param callers may still force a backend through the `GIT_BACKEND` environment variable when they do not pass resolved runtime params explicitly
- update and install backend clients must satisfy the shared interface asserted by `client_interface.js`
- local-history clients expose `ensureRepository`, `commitAll`, `listCommits`, `getCommitDiff`, `previewOperation`, `rollbackToCommit`, and `revertCommit`
- local-history backends must serialize operations per `repoRoot` through one shared queue so debounced owner-root history work cannot race the same repository; native keeps subprocess work async and isomorphic uses the same rule for index and worktree mutations
- local-history `commitAll`, `listCommits`, `getCommitDiff`, and `previewOperation` accept ignored repository-relative paths so backend implementations can untrack and hide runtime-sensitive files consistently
- local-history `listCommits` accepts `limit`, `offset`, and optional `fileFilter`, treats plain filters as open-ended contains matches across changed paths and nested filenames, returns commit metadata plus full per-file action entries for listed commits, should avoid loading full patch bodies for list pages, and may return `total: null` for filtered pages when `hasMore` is already known without finishing an expensive full count
- the isomorphic local-history fallback should cache immutable history-entry scans, commit tree snapshots, and per-commit changed-file summaries so paginated list, diff, preview, rollback, and revert flows reuse commit data instead of rescanning the repository on every request
- `previewOperation` accepts travel or revert operations and returns affected-file metadata plus an operation-specific patch when a `filePath` is provided
- local-history rollback should preserve the pre-reset head in backend-owned history refs when possible so commits after the reset remain listable for forward travel
- local-history backends, including the isomorphic fallback, must keep `getCommitDiff`, `previewOperation`, `rollbackToCommit`, and `revertCommit` available for the Time Travel API instead of degrading those operations to backend-specific errors
- `revertCommit` creates a new commit with inverse changes and does not move the current branch back to the selected commit; local-history backends should use a Git-like reverse-merge strategy so later non-overlapping edits can still revert cleanly, while overlapping changes still raise a `409` conflict instead of a generic `500`, and the conflict message should identify the blocking file plus the current and expected file versions when available
- local-history repositories are local-only infrastructure repositories with no remote requirement

## Work Guidance

### Local Work Rules

- keep backend-specific behavior behind this abstraction
- do not import a backend implementation directly from unrelated server or command code when `client_create.js` already owns selection
- use `local_history.js` rather than shelling out directly when writable app-layer history needs Git operations
- keep remote sanitization and backend-resolution logic centralized in `shared.js`
- preserve the shared per-repo serialization rule and immutable-history caching behavior for local-history backends whenever native or isomorphic history handling changes
- if backend order, interface shape, runtime-param behavior, or environment-variable behavior changes, update this file and the relevant server or command docs in the same session

## Verification



## Child DOX Index

- No child DOX docs.
