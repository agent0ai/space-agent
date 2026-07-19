# AGENTS

## Purpose

`_core/user/` owns the routed browser page for user account settings.

It provides the first-party `#/user` route, keeps the page UI and browser-owned metadata persistence local to the module, lets the current user edit `~/user.yaml` directly for `full_name`, and delegates password rotation to the backend-owned auth API so current-password validation and sealed verifier generation stay server-side.

Documentation is top priority for this module. After any change under `_core/user/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed page shell for the account summary, profile form, and password form, with plain-language user-facing copy
- `user.css`: page-local layout, cards, metadata chips, and compact action styling
- `store.js`: page store plus load or reload or save flow and inline status state for the profile and password forms
- `storage.js`: `~/user.yaml` load or save helpers plus the backend `password_change` API wrapper
- `ext/panels/user.yaml`: dashboard panel-manifest entry for the routed user settings page
- `ext/html/_core/onscreen_menu/items/user.html`: routed header-menu item adapter for the User route

## Local Contracts

### Local Contracts

Current route and panel-manifest contract:

- the route is `#/user`, so the router resolves it to `/mod/_core/user/view.html`
- `ext/panels/user.yaml` should continue to advertise this route to the dashboard panels index with the shorthand manifest path `user`
- the User action in the routed header menu is owned here through `_core/onscreen_menu/items` with `data-order="150"`
- the page should stay self-contained inside this module; feature logic, styling, and persistence helpers do not belong in router or auth internals

Current profile and password contract:

- the page reads current identity through `space.api.userSelfInfo()`
- the full-name editor reads and writes `~/user.yaml` directly through the authenticated file APIs and should preserve unrelated YAML keys already stored there
- blank full-name saves should normalize back to the username instead of storing an empty display name
- the password form must not hand-author `~/meta/password.json`; it calls the backend-owned `password_change` endpoint so current-password validation, sealed verifier generation, and session clearing stay server-owned
- when `space.utils.userCrypto` is ready for the current browser session, the password form must also submit a browser-generated replacement `~/meta/user_crypto.json` payload that rewraps the same user master key for the new password instead of re-encrypting stored user data
- a successful password change signs out active sessions, so the routed page should clear its local form state, clear the current session's encrypted `userCrypto` `localStorage` restore blob, and redirect the browser back to `/login`
- when frontend config reports `SINGLE_USER_APP=true`, the password form should stay read-only and explain that password login is disabled in single-user runtimes
- user-facing copy and status messages on `#/user` should stay plain-language and must not expose storage paths, verifier filenames, or endpoint names such as `~/user.yaml`, `~/meta/password.json`, or `password_change`

## Work Guidance

### Local Work Rules

- keep implementation changes inside this module unless a stable cross-module contract truly changes
- keep `~/user.yaml` persistence as a direct YAML file update instead of inventing a second profile API
- keep password rotation narrow and backend-owned; this module should only collect form input and display status
- if the route path, panel-manifest path, onscreen menu item, `~/user.yaml` path, or `password_change` API contract changes, update this file, `/app/AGENTS.md`, and the matching supplemental docs under `_core/documentation/docs/`

## Verification



## Child DOX Index

- No child DOX docs.
