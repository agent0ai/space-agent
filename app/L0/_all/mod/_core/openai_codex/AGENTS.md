# AGENTS

## Purpose

`_core/openai_codex/` owns OpenAI-Codex-specific frontend request customization for the ChatGPT Plus subscription transport.

It is a headless helper module. It does not own chat UI or prompt assembly. It owns reusable Codex endpoint URL constants, Cloudflare-compatible header application, OAuth token helpers, Chat-Completions-to-Responses request-shape conversion, and Responses-API SSE event mapping for the first-party chat surfaces.

Documentation is top priority for this module. After any change under this subtree, update this file and any affected parent or consumer docs in the same session.

## Ownership

This module owns:

- `request.js`: shared Codex endpoint URL constants, Cloudflare-compatible request-header application, JWT account-id extraction, and OAuth device-flow URL constants
- `ext/js/_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest/end/openai-codex.js`: overlay-chat API request customization (body shape + headers)
- `ext/js/_core/admin/views/agent/api.js/prepareAdminAgentApiRequest/end/openai-codex.js`: admin-chat API request customization (body shape + headers)
- `request_shape.js`: pure stateless converters between OpenAI Chat-Completions request bodies and Codex Responses-API request bodies
- `sse_adapter.js`: pure stateless mapper from Codex Responses-API SSE events into the existing Chat-Completions-shaped delta frames that `_core/onscreen_agent/api.js` and `_core/admin/views/agent/api.js` already parse
- `token_manager.js`: browser-side helper that wraps the three OAuth backend endpoints (`/api/openai_codex_auth_start`, `/api/openai_codex_auth_poll`, `/api/openai_codex_token_refresh`) and enforces always-fresh-read refresh semantics with a single-flight coalescer per refresh token. The coalescer is per-tab only: two browser tabs against the same account still issue two parallel refresh requests, and cross-tab serialization relies on the server-side mutex in `server/lib/openai_codex/refresh_lock.js` (which itself is per-worker; see the known-limitations note in `/server/lib/openai_codex/AGENTS.md`).
- `auth_flow.js`: stateful controller that drives the end-to-end device-code login UX from the settings dialog, emitting `STARTING` / `PENDING` / `COMPLETE` / `FAILED` status events and polling the backend at the interval the OAuth server returns
- `models.js`: shipped static Codex model catalog used as a fallback by the settings UI, with `CODEX_DEFAULT_MODEL_ID` pointing at the cheapest and fastest option suitable for a ChatGPT Plus subscription
- `models_parser.js`: pure `parseCodexModelsResponse(payload)` that converts the Codex `/backend-api/codex/models` response into `{ id, description }` entries, filters out unsupported or hidden variants, and sorts by `(priority, slug)` to match the reference Codex client ordering
- `models_discovery.js`: browser-side `discoverCodexModels({ accessToken, chatGPTAccountId })` helper that fetches the live catalog with `applyCodexHeaders()` through the space-agent outbound proxy (`space.proxy.buildUrl(...)` -> `/api/proxy`). A direct browser fetch against `chatgpt.com/backend-api/codex/models` is always blocked because the endpoint sends no `Access-Control-Allow-Origin` header, so we route through the existing proxy infrastructure on every call rather than attempting a doomed direct request first. Any failure returns an empty array so callers can fall back to the static catalog.

## Local Contracts

- this module contributes behavior only through JS extension hooks, shared helpers, and the dedicated LLM-client subclass; it must not fork or duplicate the admin or onscreen chat runtimes
- the two shipped extension hooks gate on `settings.provider === "openai-codex"` so they only rewrite requests for the Codex provider and leave OpenRouter or other OpenAI-compatible provider requests untouched
- the shipped URL constants (`CODEX_BASE_URL`, `CODEX_RESPONSES_ENDPOINT`, `CODEX_MODELS_ENDPOINT`) are consumed directly; there is no endpoint-detection helper because the provider-setting gate removes the need for it
- provider-specific HTTP policy belongs here or in similar headless provider modules, not hard-coded into `_core/onscreen_agent/llm.js` or `_core/admin/views/agent/api.js`
- the Codex `/responses` endpoint rejects `max_output_tokens` and `temperature` with HTTP 400; `request_shape.js` strips both before producing the outbound body
- the Codex `/responses` endpoint streams its own SSE event family, not the Chat-Completions `data: {choices:[...]}` stream; the SSE adapter here is the single source of truth for translating between the two formats
- refresh-token rotation is single-use and must not run concurrently from multiple browser tabs; the browser-side module must route refreshes through the server endpoint `/api/openai_codex_token_refresh` rather than posting to `auth.openai.com` directly (see `/server/api/AGENTS.md` for that endpoint contract)

## Known Cloudflare Requirement

The Codex endpoint sits behind Cloudflare, which denies requests from non-residential IPs that do not advertise a first-party originator.

Required headers on every outbound request to `https://chatgpt.com/backend-api/codex/...`:

- `User-Agent: codex_cli_rs/0.0.0 (space-agent)` — must begin with `codex_cli_rs/`
- `originator: codex_cli_rs` — lowercase header name, canonical casing from the `codex-rs` client
- `ChatGPT-Account-ID: <account_id>` — canonical casing, extracted once from the OAuth access-token JWT claim `https://api.openai.com/auth.chatgpt_account_id` and persisted alongside the tokens in user config; omit the header when extraction fails
- `Authorization: Bearer <access_token>`
- `Accept: text/event-stream`
- `Content-Type: application/json`

Without `User-Agent` plus `originator` the endpoint returns HTTP 403 with response header `cf-mitigated: challenge` regardless of token validity. Do not remove these headers as part of a code-cleanup pass; they are load-bearing infrastructure, not stylistic choices.

## Request Shape Conversion Contract

`request_shape.js` exposes a pure `chatToResponsesRequest(chatBody)` converter. Input is the OpenAI Chat-Completions body produced by `createApiRequestBody(...)` in `_core/onscreen_agent/api.js` or `createRequestBody(...)` in `_core/admin/views/agent/api.js`. Output is the Codex Responses-API body.

Conversion rules:

- the first `role: "system"` message becomes the top-level `instructions` string and is removed from `input`
- remaining `role: "user"` and `role: "assistant"` messages become `input[]` entries with `content: [{ type: "input_text", text }]`
- multimodal `{ type: "text", text }` content parts stay as `{ type: "input_text", text }`
- multimodal `{ type: "image_url", image_url: { url, detail } }` content parts become `{ type: "input_image", image_url, detail }`
- `model` is passed through unchanged
- `stream: true` is preserved when present; the Responses endpoint streams SSE on its own regardless, but sending it keeps the contract explicit
- `store: false` is added unconditionally so Codex does not retain completions
- `max_output_tokens` is dropped; the Codex endpoint rejects it with HTTP 400
- `temperature` is dropped; the Codex endpoint rejects it with HTTP 400
- all other Chat-Completions-specific fields (`n`, `frequency_penalty`, `presence_penalty`, `logit_bias`, `response_format`, `tools`, `tool_choice`, `stop`) are dropped; the Codex Responses-API accepts a narrow body and any unknown field may cause HTTP 400

## SSE Adapter Contract

`sse_adapter.js` exposes a pure `mapCodexEventToChatFrames(event)` mapper. Input is one parsed Codex Responses-API SSE event object. Output is an array of zero or more Chat-Completions-shaped frames plus optional `[DONE]` marker.

### Supported events (produce frames)

| Event type | Output |
|---|---|
| `response.output_text.delta` | `{ choices: [{ delta: { content: event.delta }, index: 0 }] }` |
| `response.refusal.delta` | `{ choices: [{ delta: { content: event.delta }, index: 0 }] }` |
| `response.completed` | `{ choices: [{ finish_reason: "stop", delta: {}, index: 0 }], usage: { prompt_tokens, completion_tokens, total_tokens } }` plus `[DONE]` |
| `response.incomplete` | `{ choices: [{ finish_reason: event.response.incomplete_details.reason \|\| "length", delta: {}, index: 0 }] }` plus `[DONE]` |
| `response.failed` | thrown Error with the upstream error message |
| `error` (standalone error event) | thrown Error with the upstream error message |

### Ignored events (skipped silently to avoid unknown-event log noise)

`response.created`, `response.in_progress`, `response.output_item.added`, `response.output_item.done`, `response.content_part.added`, `response.content_part.done`, `response.output_text.done`, `response.refusal.done`, `response.function_call_arguments.delta`, `response.function_call_arguments.done`, `response.reasoning_text.delta`, `response.reasoning_text.done`, `response.reasoning_summary_text.delta`, `response.reasoning_summary_text.done`, `response.audio_*`, `response.code_interpreter_*`, `response.file_search_call_*`, `response.web_search_call_*`, `response.image_gen_call_*`, `response.mcp_*`, `response.queued`, `response.output_text_annotation.added`, `response.custom_tool_call_input_*`

### Output accumulation rule

Text output must be accumulated live from `response.output_text.delta` events. Do not read the final reply from `response.completed.response.output` — Codex has been observed returning an empty `output` array in the final event even when deltas streamed correctly. Use `response.completed` only for `usage` and `finish_reason`.

### End-of-stream marker

The Codex Responses-API does not emit a `data: [DONE]` line. The adapter synthesizes `[DONE]` after `response.completed`, `response.incomplete`, `response.failed`, or a standalone `error` event so the existing Chat-Completions SSE parser in `_core/onscreen_agent/api.js` and `_core/admin/views/agent/api.js` sees the expected terminator.

## OAuth Device Flow Reference

The module exports four URL constants used by the server-owned OAuth endpoints and by the frontend settings UI:

- `CODEX_OAUTH_CLIENT_ID` — `app_EMoamEEZ73f0CkXaXp7hrann`
- `CODEX_OAUTH_AUTHORIZE_URL` — `https://auth.openai.com/codex/device` — where the user pastes the displayed `user_code`
- `CODEX_OAUTH_DEVICE_CODE_URL` — `https://auth.openai.com/api/accounts/deviceauth/usercode` — server POSTs here to start a device flow
- `CODEX_OAUTH_DEVICE_TOKEN_URL` — `https://auth.openai.com/api/accounts/deviceauth/token` — server polls here until the user authorizes
- `CODEX_OAUTH_TOKEN_URL` — `https://auth.openai.com/oauth/token` — server POSTs here to exchange the authorization code for tokens and to refresh
- `CODEX_OAUTH_REDIRECT_URI` — `https://auth.openai.com/deviceauth/callback` — fixed redirect URI sent during the code-exchange step

## Persisted Token Shape

Codex tokens are persisted inside each chat surface's existing configuration file (`~/conf/onscreen-agent.yaml` for the overlay, `~/conf/admin-chat.yaml` for the admin agent) as a nested encrypted structure.

When the current session is unlocked, the value stored at `openai_codex` is a `userCrypto:`-prefixed ciphertext whose plaintext is a YAML-serialized object with these fields:

- `access_token` — current JWT access token
- `refresh_token` — current refresh token (single-use, rotates on every refresh)
- `expires_at` — Unix timestamp in seconds when `access_token` expires
- `obtained_at` — Unix timestamp in seconds when `access_token` was issued, for telemetry only
- `account_id` — ChatGPT account id extracted once from the `access_token` JWT claim `https://api.openai.com/auth.chatgpt_account_id`; empty when the token is not a JWT or the claim is missing

The server OAuth endpoints own extraction of `account_id` and return it alongside the tokens; the frontend never re-parses the JWT during normal requests.

## Testing This Locally

This module cannot be fully exercised without an active ChatGPT Plus subscription, since the OAuth device-code flow, the streaming `/responses` endpoint, and the `/models` discovery all require a live OpenAI account with Codex access.

What reviewers can verify without a subscription:

- **Pure-function tests**: `tests/openai_codex_*_test.mjs` covers request-shape conversion, SSE event mapping, the token manager's always-fresh-read and single-flight semantics, the shipped static model catalog, and the live-response parser. Run with `node --test tests/openai_codex_*_test.mjs` — 51 tests, no network access or credentials required.
- **Server endpoint registration**: `node space serve` starts cleanly and `curl -X POST http://127.0.0.1:3000/api/openai_codex_auth_start` returns HTTP 401 with `{"error":"Authentication required"}` (auth gate works, endpoint is registered).
- **Module hierarchy**: check that `/mod/_core/openai_codex/*` modules import cleanly from both chat surfaces (no module resolution errors in the browser console on app boot).

What requires a ChatGPT Plus subscription to verify:

- **Full OAuth device-code flow** (`_auth_start` → browser authorize → `_auth_poll` → tokens returned)
- **First live chat turn** against `gpt-5.4-mini` or another Codex model
- **Silent refresh** after access-token expiry (~1 hour)
- **Live model-catalog discovery** (dropdown reflects the account's entitled models, not just the static fallback)

## Development Guidance

- keep provider detection small and explicit
- prefer one shared helper for endpoint matching, header mutation, and body-shape conversion so the admin and onscreen hooks stay in sync
- if additional Codex request shaping is needed later, extend the prepared request object here instead of reintroducing per-surface hard-coded branches
- keep the Cloudflare header block in `request.js` even if it looks like boilerplate; removing it breaks the endpoint with a confusing 403
- keep the `space.proxy.buildUrl(CODEX_RESPONSES_ENDPOINT)` routing plus `requestInit.credentials = "same-origin"` in both chat-completion hooks (onscreen and admin) — `chatgpt.com` advertises no `Access-Control-Allow-Origin` header so a direct browser fetch is always blocked. The `installFetchProxy(...)` wrapper provides a transparent fallback retry, but every page-load pays one failed-direct-fetch roundtrip and emits a red CORS error in the DevTools console until the wrapper caches the origin. Routing through the proxy explicitly eliminates both costs.
- update this file when the Codex endpoint adds new SSE event families, when Codex rejects another request-body field, or when OAuth URLs change
