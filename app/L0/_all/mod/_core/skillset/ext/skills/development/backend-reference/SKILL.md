---
name: Backend Reference
description: Read-only reference for the backend contracts that the frontend depends on, including routing, APIs, auth, layers, and module resolution.
---

Use this skill when frontend work depends on understanding backend behavior. This skill is read-only context, not authorization to change backend files.

## Hard Boundary

- Do not edit `server/`, `commands/`, or `packaging/` from this skill set.
- If the task truly requires backend changes, stop and ask instead of treating this skill as permission.
- Backend changes are non-standard in this project. Only ask for them when frontend-only work cannot safely enforce security, integrity, cross-user isolation, or runtime stability.
- When you ask, explain why the frontend solution would be insufficient and describe the narrow backend change required.

## Page And Request Flow

Current request order is:

1. API preflight handling
2. `/api/proxy`
3. `/api/<endpoint>`
4. `/mod/...`
5. `/~/...` and `/L0/...`, `/L1/...`, `/L2/...`
6. page shells and page actions

The browser app mounts through page shells in `server/pages/`. `/login` is public. `/` and `/admin` require authentication.

## API Families

Important frontend-facing endpoint families are:

- app files: `file_list`, `file_paths`, `file_read`, `file_write`, `file_delete`, `file_copy`, `file_move`, `file_info`, `folder_download`
- local history: `git_history_list`, `git_history_diff`, `git_history_preview`, `git_history_rollback`, `git_history_revert`
- modules: `bundle_list`, `bundle_info`, `module_list`, `module_info`, `module_install`, `module_remove`
- runtime and identity: `extensions_load`, `password_generate`, `password_change`, `user_crypto_session_key`, `user_self_info`

These endpoints are thin wrappers over shared helpers in `server/lib/customware/` and `server/lib/auth/`.

`file_write` still defaults to whole-file replacement, but it also supports `operation: "append"`, `"prepend"`, and `"insert"`. Insert writes accept exactly one anchor through `line`, `before`, or `after`, use the first literal `before` or `after` match, treat `line` as a 1-based insertion point, and require `utf8`.

`file_list` and `file_paths` support `access: "write"` or `writableOnly: true` for writable-only discovery. They also support `gitRepositories: true`; with a pattern such as `**/.git/`, `file_paths` returns local-history owner roots like `L1/team/` and `L2/alice/` without exposing reserved `.git` metadata paths.

`folder_download` supports `HEAD` for permission-only validation and `GET` or `POST` for the streamed ZIP attachment. It creates the archive in `server/tmp/` only for the actual download response, after the shared file-access layer approves the requested folder path.

`git_history_list`, `git_history_diff`, `git_history_preview`, `git_history_rollback`, and `git_history_revert` are enabled by `CUSTOMWARE_GIT_HISTORY`. The backend maps the requested path to a writable `L1/<group>/` or `L2/<user>/` owner repo, enforces permissions, paginates list metadata with optional file filters, reads per-file diffs separately, previews travel or revert affected files with optional operation-specific file patches, suppresses history scheduling during rollback, preserves ignored L2 auth files, preserves forward-travel refs during rollback when possible, and creates inverse commits for revert.

`user_self_info` is the frontend-facing identity snapshot. Frontend callers derive writable app roots from `username`, `managedGroups`, and `_admin` membership in `groups` without authorizing backend edits.

`password_change` is the authenticated self-service password-rotation endpoint for the current user. Frontend code should call it instead of writing `~/meta/password.json` directly, because the backend validates the current password, seals the replacement verifier, clears sessions, and clears the current auth cookie.

`user_crypto_session_key` is the authenticated localStorage-restore endpoint. It returns the current session-derived wrapping key by hashing the live backend `sessionId` with the server-held session secret, so the browser can decrypt or encrypt the one persisted `userCrypto` `localStorage` blob without the server persisting that wrapping key or the user master key.

## Module And Extension Resolution

- `/mod/...` resolution goes through the layered customware model.
- `maxLayer` constrains module and extension resolution and defaults to `2`.
- `/admin` effectively clamps module and extension resolution to `L0`.
- Frontend HTML extensions resolve through `ext/html/...`.
- Frontend JS hooks resolve through `ext/js/...`.
- Customware bundles are normal installed `L1` or `L2` modules with root `space.bundle.yaml` manifests; `bundle_list` and `bundle_info` expose that metadata through the same module-management visibility and owner rules instead of a separate plugin loader.
- Frontend modules may also enumerate other extension-owned assets such as `ext/panels/*.yaml` through `file_paths` plus `file_read` when they only need readable logical file discovery and contents. `extensions_load` remains the backend contract for HTML and JS extension resolution, keeping `maxLayer` at the top level, ordered `patterns` groups in the request, and ordered grouped results with matching `patterns` plus resolved `extensions`.

## Auth And User Storage

- The server issues the `space_session` cookie and validates it by hashing it with a backend-held secret.
- When the current login may auto-restore `userCrypto` on the same browser profile, the browser stores one encrypted `userCrypto` blob in `localStorage`, and authenticated browser code fetches the current session-derived wrapping key from `/api/user_crypto_session_key`.
- User metadata lives at `L2/<username>/user.yaml`.
- `L2/<username>/meta/password.json` stores a server-sealed SCRAM verifier envelope, not a self-sufficient plaintext verifier.
- `L2/<username>/meta/logins.json` stores backend-keyed session verifiers plus signed session metadata.
- Authenticated self-service password changes still stay backend-owned through `/api/password_change`; browser code may edit `L2/<username>/user.yaml` directly, but not the password verifier file.
- User-owned modules live under `L2/<username>/mod/`.
- Backend auth keys come from shared environment injection through `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY` for multi-instance deployments, or from the local fallback `server/data/auth_keys.json` during single-instance development.

## Why Frontend Developers Need This

- to understand why a frontend file API call succeeds or fails
- to understand where module and extension inheritance comes from
- to understand why admin UI is firmware-clamped while normal app routing is layered
- to understand the user and group storage model without editing backend logic
- to identify the small set of cases where backend ownership is mandatory instead of merely convenient

## Mandatory Doc Follow-Up

- If backend contracts that the frontend depends on change, update the mirrored backend docs and the `development` skill subtree in the same session, even though this skill remains read-only guidance.
