# Auth And Sessions

This doc covers the file-backed auth model and the session contract.

## Primary Sources

- `server/lib/auth/AGENTS.md`
- `server/router/AGENTS.md`
- `server/lib/auth/service.js`
- `server/lib/auth/user_files.js`
- `server/lib/auth/user_manage.js`

## User Storage Layout

Current logical storage:

- `L2/<username>/user.yaml`: user metadata
- `L2/<username>/meta/password.json`: sealed password verifier envelope
- `L2/<username>/meta/logins.json`: active session verifiers plus signed metadata
- `L2/<username>/mod/`: user-owned modules

On disk:

- defaults under repo `app/L2/...`
- relocates under `CUSTOMWARE_PATH/L2/...` when configured
- when `CUSTOMWARE_GIT_HISTORY` is enabled, the L2 history repo ignores `meta/password.json` and `meta/logins.json`, and rollback preserves those current files instead of restoring old auth state

Backend-only auth keys are not stored in the logical app tree.

They come from:

- `SPACE_AUTH_PASSWORD_SEAL_KEY`
- `SPACE_AUTH_SESSION_HMAC_KEY`

or the local fallback `server/data/auth_keys.json`.

## Session Contract

Current session rules:

- cookie name: `space_session`
- `HttpOnly`
- `SameSite=Strict`
- path `/`
- max age: 30 days

Important behavior:

- the browser cookie is a bearer token
- the backend stores only a verifier plus signed metadata in `meta/logins.json`
- unsigned or expired session records are rejected
- revocation deletes the stored session record and republishes the changed auth file through the shared mutation commit path
- in clustered runtime, cookie validation happens on workers from replicated auth index shards, one-time login challenges live in the primary-only `login_challenge` area of the unified state system, and any debounced writable-layer Git history scheduling for auth-file writes is triggered only from the primary post-rebuild path

## Password Contract

`password.json` stores a sealed SCRAM verifier envelope.

Important rules:

- do not hand-author these files
- only backend helpers that hold the seal key can create accepted payloads
- legacy plaintext verifier files are migrated to sealed form during startup; in clustered runtime that initialization stays on the primary before workers begin serving
- the auth service uses the shared state system for challenge coordination; there is no second in-memory login-challenge path in the runtime

## Single-User Runtime

When `SINGLE_USER_APP=true`:

- every request resolves to the implicit `user` principal
- cookie-backed login is bypassed
- permission helpers treat that principal as a virtual `_admin` member

This mode is used especially by packaged desktop flows.

## User Management Helpers

`user_manage.js` currently owns:

- `createUser(...)`
- `deleteUser(...)`
- `deleteGuestUser(...)`
- `setUserPassword(...)`
- `createGuestUser(...)`

Important side effects:

- user creation initializes the user directory, `meta/`, and `mod/`, and publishes the new auth files so incremental user indexing sees the new account immediately
- password resets rewrite the sealed verifier and clear active sessions
- guest users use randomized `guest_...` usernames
- guest deletion removes the whole `L2/<username>/` root and republishes that logical path so replicated user and session indexes drop the deleted guest immediately
- periodic guest cleanup policy now lives in `server/jobs/`; auth owns the deletion primitive while the jobs own scheduling and file-index thresholds
