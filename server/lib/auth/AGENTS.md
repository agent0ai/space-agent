# AGENTS

## Purpose

`server/lib/auth/` owns the local auth and session system.

It handles password verifier logic, login challenge and completion, session-cookie issuance and revocation, user file helpers, derived user indexing, and CLI-facing user-management helpers. This is local infrastructure, not the final identity system, so keep it explicit and narrow.

Documentation is top priority for this subtree. After any change under `server/lib/auth/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `service.js`: login challenge creation, login completion, self-service password change, session-cookie helpers, session revocation, and request-user resolution
- `keys_manage.js`: backend-only auth-key loading from shared env injection or local fallback storage at `server/data/auth_keys.json` by default or `SPACE_AUTH_DATA_DIR/auth_keys.json` when that override is set
- `passwords.js`: verifier and proof helpers
- `user_crypto.js`: persistent wrapped user-key record helpers, backend-sealed server-share recovery, local backend-share cache storage, and invalidation
- `user_files.js`: canonical `L2/<username>/user.yaml` and `meta/` read or write helpers
- `user_index.js`: derived user and session index snapshot builder
- `user_manage.js`: create user, delete user, set password, and create guest user helpers

## Storage Contract

Current user storage layout:

- metadata: logical `L2/<username>/user.yaml`
- password verifier envelope: logical `L2/<username>/meta/password.json`
- active session verifiers: logical `L2/<username>/meta/logins.json`
- wrapped browser-encryption record: logical `L2/<username>/meta/user_crypto.json`
- user-owned modules: logical `L2/<username>/mod/`
- on disk those files live under `CUSTOMWARE_PATH/L2/...` when `CUSTOMWARE_PATH` is configured, otherwise under repo `app/L2/...`
- backend-only auth keys live outside the logical app tree and come from either shared process env injection via `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY`, or the gitignored local fallback `server/data/auth_keys.json`, unless `SPACE_AUTH_DATA_DIR` relocates that fallback root
- backend-only per-user `userCrypto` server shares may be cached outside the logical app tree under gitignored `server/data/user_crypto/<username>.json` or the matching `SPACE_AUTH_DATA_DIR/user_crypto/<username>.json` override path
- `meta/user_crypto.json` also carries a backend-sealed copy of that share so any instance with the shared auth keys can recover it from the shared writable layer without exposing the plaintext share in user data

`user_files.js` is the canonical helper layer for those files. Do not write them through ad hoc path logic elsewhere.

## Session And Login Contract

Current session rules:

- the session cookie name is `space_session`
- the cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/`, and carries a 30-day max age
- login uses the shared challenge and proof flow from `service.js`
- `login_challenge` returns the password-proof inputs plus `userCrypto` state; legacy users with no `meta/user_crypto.json` record receive a one-time provisioning share inside that challenge
- accounts that still have a wrapped user key record but no recoverable server share are treated as `invalidated`, not `missing`, so the browser does not silently reprovision over old ciphertext
- `login` finalization may persist the missing `meta/user_crypto.json` record before issuing the cookie, and successful logins return both a backend `sessionId` and a `userCrypto` payload for the browser session bootstrap
- successful login writes a backend-keyed session verifier plus signed metadata into `meta/logins.json` and publishes the changed logical auth paths through the shared mutation-commit flow
- when `CUSTOMWARE_GIT_HISTORY` is enabled, login, logout, verifier migration, user creation, and password reset writes may schedule the affected user's debounced local-history check, but `meta/password.json` and `meta/logins.json` are ignored by the L2 history repo and preserved during rollback; clustered worker writes rely on the primary post-rebuild scheduling path instead of worker-local Git debounces
- session records include signed metadata, a backend-generated `sessionId`, and an absolute expiry timestamp
- session revocation deletes the stored session entry and publishes the changed logical auth path through the shared mutation-commit flow
- unsigned or expired session records are rejected even if they exist on disk
- when `SINGLE_USER_APP` is enabled, request auth resolves every request to the implicit `user` principal and bypasses cookie-backed login entirely
- in clustered runtime, cookie validation still runs on workers from replicated `user_index` and `session_index` shards, while one-time login challenges live in the primary-only `login_challenge/<token>` area of the unified state system

Current password rules:

- `meta/password.json` stores a server-sealed SCRAM verifier envelope, not plaintext `stored_key` and `server_key` fields
- only backend helpers that hold the auth seal key may generate accepted password records
- authenticated self-service password changes validate the current password in `service.js`, then reuse the shared password-reset primitive so the sealed verifier and cleared sessions are published through the normal auth mutation path
- when the current user has a ready `userCrypto` record, authenticated self-service password changes must also carry a browser-generated replacement `meta/user_crypto.json` record that rewraps the same user master key for the new password
- admin or CLI password resets cannot rewrap that browser-owned key material, so they invalidate `meta/user_crypto.json` and delete the backend-only server share instead
- the auth service rewrites legacy plaintext verifier files into sealed records during startup before the server begins handling requests; in clustered runtime this initialization stays on the primary so workers do not all rescan `L2`
- `createAuthService(...)` requires the shared state system; the auth runtime should not invent a second in-memory challenge path

Current user-index rules:

- `user_index.js` derives user records, sealed-password presence, and stored session graphs from `user.yaml`, `password.json`, and `logins.json`
- request auth state should flow from the replicated derived index shards, while `service.js` remains the owner of password-record opening and session-signature validation

## User-Management Contract

`user_manage.js` currently owns:

- `createUser(...)`
- `deleteUser(...)`
- `deleteGuestUser(...)`
- `setUserPassword(...)`
- `createGuestUser(...)`

Rules:

- user creation initializes the user directory, `meta/`, and `mod/`
- user creation must publish the concrete auth files it creates, not only the user directory root, so incremental user-index rebuilds see new accounts immediately
- CLI-owned group assignment for `node space user create --groups ...` belongs in `commands/user.js` and `server/lib/customware/group_files.js`, not in `user_manage.js`; `user_manage.js` should stay focused on user storage and auth files
- password resets rewrite the sealed verifier and clear active sessions; authenticated self-service password changes should validate the current password in `service.js`, then rewrite `meta/user_crypto.json` in the same mutation when the account still has a ready browser-encryption record
- CLI or admin password resets should invalidate `userCrypto` by deleting the backend-only server share and marking `meta/user_crypto.json` as invalidated instead of silently regenerating a new key
- guest users are created under randomized `guest_` usernames
- guest deletion removes the whole `L2/<username>/` root, deletes any backend-only `userCrypto` server share, and publishes that logical path through the shared mutation path so replicated user and session indexes drop the guest immediately
- periodic guest cleanup policy belongs in `server/jobs/`; `user_manage.js` owns the deletion primitive, not the schedule or file-index policy

## Development Guidance

- keep auth state and session rules centralized here
- do not add direct cookie or session-file manipulation elsewhere when the auth service already owns the flow
- do not hand-roll `password.json` contents outside backend helpers; use `password_generate`, `user_manage.js`, or auth-service helpers so the backend seal key is applied correctly
- treat the current local file-backed auth model as a constrained infrastructure contract, not as a place to casually grow unrelated policy
- if user storage, session semantics, or login flow change, also update `app/L0/_all/mod/_core/skillset/ext/skills/development/` because the shared development skill mirrors this contract
- if user storage, session semantics, or login flow change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/server/`
- if user storage, session semantics, or login flow change, update this file and the relevant router or API docs in the same session
