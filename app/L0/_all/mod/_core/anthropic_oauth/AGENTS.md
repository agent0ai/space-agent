# AGENTS

## Purpose

`_core/anthropic_oauth/` owns the optional "Claude subscription" LLM provider for the first-party agent surfaces.

It is a headless helper module plus a small UI primitive. It does not own chat UI or prompt assembly. It owns:

- the browser-side connect, status, and disconnect helpers around the `/api/oauth_anthropic_*` server endpoints
- the request-redirect extension hooks that route admin and onscreen API-mode chat traffic through the dedicated authenticated server endpoint when the user opted into subscription mode
- a reusable connect-status block that the admin and onscreen settings dialogs embed under a "Subscription" tab in the existing provider segmented control
- the Claude wordmark icon used by the connect button and status badge

Documentation is top priority for this module. After any change under this subtree, update this file and any affected parent or consumer docs in the same session.

## Ownership

This module owns:

- `client.js`: shared API client around `/api/oauth_anthropic_authorize`, `/api/oauth_anthropic_callback`, `/api/oauth_anthropic_status`, and `/api/oauth_anthropic_disconnect`
- `request.js`: shared helpers used by the per-surface request hooks to redirect API-mode requests to `/api/anthropic_subscription_completions` when the active provider is `subscription`
- `connect-block.js` plus `connect-block.html`: the reusable "Connect with Claude" status block, popup-window helper, and code-paste input embedded into both settings dialogs through `<x-component path="...">`
- `anthropic-oauth.css`: scoped status-badge, button, and icon styling
- `res/claude.svg`: shared Claude wordmark used by the connect button and badge
- `ext/js/_core/admin/views/agent/api.js/prepareAdminAgentApiRequest/end/anthropic-subscription.js`: admin-chat request redirect for subscription mode
- `ext/js/_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest/end/anthropic-subscription.js`: overlay-chat request redirect for subscription mode

## Local Contracts

- the subscription provider is the third value of the existing chat provider enum used by the admin and onscreen agent surfaces; this module never invents a new chat surface
- when the active settings provider is `subscription`, the per-surface request hooks must rewrite the prepared request URL to `/api/anthropic_subscription_completions`, strip any `Authorization` header (the server injects the bearer token), and force the request body model field if a Claude model is not already selected so the request is acceptable to Anthropic Messages API
- token plaintext must never reach the browser; the connect block reads only `/api/oauth_anthropic_status` metadata
- the connect flow uses Anthropic's hosted code-paste page as the OAuth redirect URI: the browser opens the authorize URL in a popup window, the user authorizes on Claude, Anthropic shows them an authorization code, the user pastes that code back into the connect block, and the block POSTs the code plus the previously issued state token to `/api/oauth_anthropic_callback`
- the connect block shows three states: disconnected (with the connect button and code-paste field), connecting (while the authorize popup is open and after submit is pending), and connected (with account email plus "Disconnect" button)
- the connect block must respect `ANTHROPIC_OAUTH_ALLOWED`; when disabled it surfaces a short notice instead of a connect button
- this module does not duplicate streaming response parsing; the server endpoint emits OpenAI-compatible SSE so the existing browser fetch readers in `_core/admin/views/agent/api.js` and `_core/onscreen_agent/api.js` keep working unchanged
- visual primitives from `_core/visual/` are required for buttons, dialog scoping, and toasts; new visual primitives belong in `_core/visual/`, not here
- the Claude wordmark is the only artwork this module ships; everything else reuses existing primitives and shared conversation chrome

## Development Guidance

- keep provider detection small and explicit, just like `_core/open_router/`
- if Anthropic adds new OAuth scopes, request shape, or stream events, prefer extending the server endpoint rather than the browser hooks
- if Space Agent later registers its own Anthropic OAuth client, override the `ANTHROPIC_OAUTH_CLIENT_ID` runtime param; do not hard-code a different default in this module
- if the agent or onscreen-agent provider enum signature changes, update both extension hooks here and re-check the per-surface settings dialog
