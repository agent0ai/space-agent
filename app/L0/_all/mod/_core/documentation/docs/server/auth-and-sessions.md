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
- `L2/<username>/meta/user_crypto.json`: wrapped browser-owned user master key record
- `L2/<username>/mod/`: user-owned modules

On disk:

- defaults under repo `app/L2/...`
- relocates under `CUSTOMWARE_PATH/L2/...` when configured
- when `CUSTOMWARE_GIT_HISTORY` is enabled, the L2 history repo ignores `meta/password.json`, `meta/logins.json`, and `meta/user_crypto.json`, and rollback preserves those current files instead of restoring old auth state

Backend-only auth keys are not stored in the logical app tree.

They come from:

- `SPACE_AUTH_DATA_DIR` as the override root for local fallback auth storage
- `SPACE_AUTH_PASSWORD_SEAL_KEY`
- `SPACE_AUTH_SESSION_HMAC_KEY`

or the local fallback `server/data/auth_keys.json` when `SPACE_AUTH_DATA_DIR` is unset.

Per-user `userCrypto` server shares are also backend-only and live under gitignored `server/data/user_crypto/<username>.json`, or under `SPACE_AUTH_DATA_DIR/user_crypto/<username>.json` when that override is set.

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
- each stored session record also carries a backend-generated `sessionId`, which the browser uses to bind its session-scoped `userCrypto` cache to the active login
- unsigned or expired session records are rejected
- revocation deletes the stored session record and republishes the changed auth file through the shared mutation commit path
- in clustered runtime, cookie validation happens on workers from replicated auth index shards, one-time login challenges live in the primary-only `login_challenge` area of the unified state system, and any debounced writable-layer Git history scheduling for auth-file writes is triggered only from the primary post-rebuild path

## User Crypto Contract

`user_crypto.json` stores a wrapped browser-owned master key record. The complementary backend-only server share may also be cached under `server/data/user_crypto/` or the `SPACE_AUTH_DATA_DIR/user_crypto/` override root, and the shared user record now carries a backend-sealed copy so any instance with the shared auth keys can recover it without exposing the plaintext share in user data.

Important rules:

- backend compromise of only the app tree is not enough because `meta/user_crypto.json` does not include the backend-only server share
- `meta/user_crypto.json` may include a backend-sealed server-share envelope for multi-instance recovery, but that envelope is not usable without the backend auth keys
- password knowledge alone is not enough because the browser also needs the backend-only server share released during a successful login
- `/api/login_challenge` reports whether the account is `ready`, `missing`, or `invalidated`; legacy accounts with no record receive a one-time provisioning share so the browser can create the missing record during the same login
- accounts that still have a wrapped record but no recoverable server share are treated as `invalidated`, not `missing`, so login does not silently replace a key that may still protect existing ciphertext
- `/api/login` persists the missing record before issuing the cookie, then returns the wrapped record plus the server share so the browser can unlock the master key for that authenticated browser session
- the unlocked browser key is session-scoped; frontend code keeps it in `sessionStorage`, keyed by username plus backend `sessionId`
- admin or CLI password resets cannot rewrap the browser-owned key, so they invalidate `user_crypto.json` and delete the backend-only server share instead

## Password Contract

`password.json` stores a sealed SCRAM verifier envelope.

Important rules:

- do not hand-author these files
- only backend helpers that hold the seal key can create accepted payloads
- authenticated self-service password changes go through `/api/password_change`, which validates the current password against the opened sealed verifier, rewrites `meta/password.json`, rewraps `meta/user_crypto.json` when the current session has unlocked browser crypto, clears `meta/logins.json`, and clears the current browser cookie
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
- password resets rewrite the sealed verifier and clear active sessions, and the authenticated `_core/user` page reaches that same rewrite path through `/api/password_change` after the backend validates the current password and receives a replacement wrapped `user_crypto.json` record from the browser when needed
- guest users use randomized `guest_...` usernames
- guest deletion removes the whole `L2/<username>/` root and republishes that logical path so replicated user and session indexes drop the deleted guest immediately
- periodic guest cleanup policy now lives in `server/jobs/`; auth owns the deletion primitive while the jobs own scheduling and file-index thresholds
