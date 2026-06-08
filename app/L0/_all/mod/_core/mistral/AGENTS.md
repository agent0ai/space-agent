# AGENTS

## Purpose

`_core/mistral/` owns Mistral-specific frontend request customization.

It is a headless helper module. It does not own chat UI or prompt assembly. It owns reusable Mistral endpoint detection plus extension files that patch API-mode chat requests for the first-party chat surfaces.

Mistral's chat completions API uses strict Pydantic validation (`extra="forbid"`) and rejects any field on a message object that is not part of its defined schema. Space Agent's prompt pipeline attaches internal bookkeeping fields such as `tokenCount`, `kind`, and `source` to message objects for prompt budgeting and UI display. These fields must be stripped before the request reaches Mistral. This module performs that strip at the API-request seam.

Documentation is top priority for this module. After any change under this subtree, update this file and any affected parent or consumer docs in the same session.

## Ownership

This module owns:

- `request.js`: shared Mistral endpoint detection and request-body mutation helpers
- `ext/js/_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest/end/mistral.js`: overlay-chat API request customization
- `ext/js/_core/admin/views/agent/api.js/prepareAdminAgentApiRequest/end/mistral.js`: admin-chat API request customization

## Local Contracts

- this module contributes behavior only through JS extension hooks and shared helpers; it must not fork or duplicate the admin or onscreen chat runtimes
- Mistral detection should use the configured upstream API endpoint, not the proxied fetch URL, because frontend fetches may be rerouted through `/api/proxy`
- the two shipped extension hooks may mutate the prepared API request object, including headers, body, URL, method, or extra fetch-init fields, but they must leave non-Mistral requests untouched
- the body rewrite preserves only the message fields accepted by Mistral's schema: `role`, `content`, `name`, `tool_calls`, `tool_call_id`
- provider-specific HTTP policy belongs here or in similar headless provider modules, not hard-coded into `_core/onscreen_agent/llm.js` or `_core/admin/views/agent/api.js`

## Development Guidance

- keep provider detection small and explicit
- prefer one shared helper for endpoint matching and body mutation so the admin and onscreen hooks stay in sync
- if Mistral expands its accepted message schema, extend `ALLOWED_MESSAGE_FIELDS` in `request.js` rather than removing the strip entirely
- if additional Mistral request shaping is needed later (e.g. header mutation, endpoint rewriting), extend the prepared request object here instead of reintroducing per-surface hard-coded branches
