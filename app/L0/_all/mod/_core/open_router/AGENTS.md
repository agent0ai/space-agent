# AGENTS

## Purpose

`_core/open_router/` owns OpenRouter-specific frontend request customization.

It is a headless helper module. It does not own chat UI or prompt assembly. It owns reusable OpenRouter request detection plus extension files that patch API-mode chat requests for the first-party chat surfaces.

Documentation is top priority for this module. After any change under this subtree, update this file and any affected parent or consumer docs in the same session.

## Ownership

This module owns:

- `request.js`: shared OpenRouter endpoint detection and request-header mutation helpers
- `ext/js/_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest/end/open-router.js`: overlay-chat API request customization
- `ext/js/_core/admin/views/agent/api.js/prepareAdminAgentApiRequest/end/open-router.js`: admin-chat API request customization

## Local Contracts

### Local Contracts

- this module contributes behavior only through JS extension hooks and shared helpers; it must not fork or duplicate the admin or onscreen chat runtimes
- OpenRouter detection should use the configured upstream API endpoint, not the proxied fetch URL, because frontend fetches may be rerouted through `/api/proxy`
- the two shipped extension hooks may mutate the prepared API request object, including headers, body, URL, method, or extra fetch-init fields, but they should leave non-OpenRouter requests untouched
- provider-specific HTTP policy belongs here or in similar headless provider modules, not hard-coded into `_core/onscreen_agent/llm.js` or `_core/admin/views/agent/api.js`

## Work Guidance

### Local Work Rules

- keep provider detection small and explicit
- prefer one shared helper for endpoint matching and header mutation so the admin and onscreen hooks stay in sync
- if additional OpenRouter request shaping is needed later, extend the prepared request object here instead of reintroducing per-surface hard-coded branches

## Verification



## Child DOX Index

- No child DOX docs.
