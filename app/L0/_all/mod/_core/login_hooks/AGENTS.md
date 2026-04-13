# AGENTS

## Purpose

`_core/login_hooks/` owns frontend-only login lifecycle hooks for authenticated framework-backed pages.

It is a headless core module. It does not own a route or UI. Its job is to run during authenticated browser bootstrap, check the client-owned first-login marker in `~/meta/login_hooks.json`, fire the first-login JS extension seam once per user when that marker is missing, and fire the repeatable any-login seam when the authenticated shell was reached directly from `/login`.

Documentation is top priority for this module. After any change under `_core/login_hooks/`, update this file, the affected app docs, and the matching supplemental docs in the same session.

## Ownership

This scope owns:

- `login-hooks.js`: login-hook constants, login-referrer detection, first-login marker checks and writes, and dispatch for the first-login plus any-login JS extension seams
- `ext/js/_core/framework/initializer.js/initialize/end/login-hooks.js`: authenticated framework-bootstrap hook that runs the login-hook module from the shared initializer `/end` seam

## Local Contracts

- this module stays frontend-only and must not require backend auth-service edits to fire login lifecycle hooks
- the first-login marker path is `~/meta/login_hooks.json`; its existence suppresses later first-login hook dispatch for that user
- the marker file is client-owned state under the current user's `meta/` folder, not backend auth state
- first-login hook dispatch uses the explicit JS extension point `_core/login_hooks/first_login`
- repeatable login hook dispatch uses the explicit JS extension point `_core/login_hooks/any_login`
- first-login hooks run before the marker file is written and before any-login hooks on the same bootstrap
- first-login hooks are the supported place for client-owned onboarding side effects; the current first-party example lives in `_core/spaces`, where a spaces-owned hook copies or reuses the initial onboarding space template and rewrites the main-shell default route before the router falls back to `#/dashboard`
- any-login dispatch is frontend-detected and currently means the authenticated framework shell was reached with a same-origin `/login` referrer; do not silently broaden that heuristic without documenting it
- hook context must include the current `identity`, `username`, `markerPath`, `isFirstLogin`, and `isLoginNavigation`
- this module should fail soft at the page level: hook errors may log locally through the extension runtime, but they should not break authenticated shell bootstrap

## Development Guidance

- keep this module headless and bootstrap-focused
- use the shared `_core/framework/initializer.js/initialize/end` seam instead of editing page shells
- keep first-login persistence minimal and explicit so future client-owned lifecycle markers can share the same `meta/` folder without confusion
- keep feature-owned onboarding behavior in first-login hook extensions owned by the feature module instead of hardcoding that behavior into `login-hooks.js`
- if the marker path, dispatch order, extension point names, or login-detection heuristic changes, also update `/app/AGENTS.md` and the matching docs under `_core/documentation/docs/app/`
