# AGENTS

## Purpose

`server/lib/openai_codex/` owns the backend helpers for the OpenAI Codex (ChatGPT Plus) OAuth device-code flow and refresh-token rotation.

It is a thin helper layer: endpoint modules under `server/api/` delegate to these helpers for the OAuth HTTP traffic and for the single-writer refresh mutex. These helpers must not read or write app files, must not touch sessions, and must not depend on the frontend runtime.

## Why This Lives On The Server

The root `server/AGENTS.md` reserves backend code for "security, shared-data integrity, multi-user isolation, or runtime-stability" concerns that the frontend cannot own safely. The Codex OAuth refresh path meets the *shared-data integrity* bar: OpenAI refresh tokens use single-use rotation — if two browser tabs refresh concurrently, exactly one call succeeds and the other returns `invalid_grant`, discarding the only valid refresh token the user has. Full re-authentication becomes the only recovery. A frontend-only implementation cannot provide the serialization guarantee needed to prevent that loss.

The device-code and token-exchange calls additionally leverage server-side fetch so the flow keeps working even when browsers block cross-origin POSTs to `auth.openai.com`.

## Ownership

This subsystem owns:

- `oauth_client.js`: pure OAuth transport functions (`startDeviceAuthorization`, `pollDeviceAuthorization`, `refreshAccessToken`), OAuth URL constants, and JWT account-id extraction
- `refresh_lock.js`: in-process single-writer coalescer (`runSingleWriterRefresh`) that prevents two concurrent callers from consuming the same refresh token

## Contracts

- `startDeviceAuthorization()` returns `{ deviceAuthId, expiresIn, interval, userCode, verificationUrl }` on success or throws an error with a `statusCode` property
- `pollDeviceAuthorization({ deviceAuthId, userCode })` returns `{ state: "pending" }` while the user has not yet entered the code, or `{ state: "complete", tokens }` once the token exchange succeeds. The field is named `state` rather than `status` because the shared router response serializer treats a top-level `status` property as an HTTP status code.
- `refreshAccessToken({ refreshToken })` returns the full token payload described below; it throws a `401` error with `invalid_grant` mapped to a human-readable message when the refresh token has already been consumed, and `502` for other upstream failures
- the returned `tokens` payload shape is:
  ```
  {
    accessToken: string,
    refreshToken: string,
    idToken: string,
    expiresAt: number,   // unix seconds
    obtainedAt: number,  // unix seconds
    accountId: string    // empty when the JWT cannot be parsed or the claim is missing
  }
  ```
- `runSingleWriterRefresh(refreshToken, worker)` coalesces concurrent calls with the same `refreshToken` string into one inflight promise so the single-use token is never posted twice at the same time; it does not persist across process restarts and does not span worker processes in clustered runtime

## Known Limitations

- the refresh mutex is in-process only; when `WORKERS>1`, concurrent refreshes on different worker processes can still race. This is acceptable for the typical single-user browser scenario because one user's tokens are stored in one browser profile and only one Codex client uses them at a time; clustered deployments that expect multiple workers to refresh the same token concurrently must elevate the lock into `server/runtime/state_system.js` named locks
- this subsystem does not read or persist tokens; persistence stays on the frontend under `userCrypto:`-prefixed encryption in `~/conf/onscreen-agent.yaml` and `~/conf/admin-chat.yaml`
- there is no revoke endpoint; logout clears the encrypted config entry on the frontend, which is sufficient because access tokens expire within about an hour and OpenAI's device-flow issues one refresh token per device

## Development Guidance

- keep these helpers pure and side-effect-free apart from the network calls and the inflight refresh map
- never import these helpers from other layers than `server/api/openai_codex_*.js` endpoints
- when OpenAI changes the OAuth URLs, client id, or device-flow response shape, update this file, `oauth_client.js`, and the matching `/app/L0/_all/mod/_core/openai_codex/` constants in the same session
