# AGENTS

## Purpose

`_core/agent/` owns the routed browser page for basic agent information and personal agent settings.

It provides the first-party `#/agent` route, keeps the page UI and persistence local to the module, reuses the public login-shell astronaut asset for the informational card, and lets the current user edit their personal prompt-include file at `~/conf/personality.system.include.md`.

Documentation is top priority for this module. After any change under `_core/agent/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed page shell for the agent information card and personality editor card
- `agent.css`: page-local layout, card styling, compact modal-style action treatment, and the local floating-avatar animation
- `store.js`: page store plus load or reload or save flow and inline status state for the personality editor
- `storage.js`: file-path constants plus load or save helpers for the user personality include file
- `ext/panels/agent.yaml`: dashboard panel-manifest entry for the routed agent page
- `ext/html/_core/onscreen_menu/items/agent.html`: routed header-menu item adapter for the Agent route

## Local Contracts

### Local Contracts

Current route and panel-manifest contract:

- the route is `#/agent`, so the router resolves it to `/mod/_core/agent/view.html`
- `ext/panels/agent.yaml` should continue to advertise this route to the dashboard panels index with the shorthand manifest path `agent`
- the Agent action in the routed header menu is owned here through `_core/onscreen_menu/items` with `data-order="100"`
- the page should stay self-contained inside this module; feature logic, styling, and persistence helpers do not belong in router or overlay internals

Current UI and persistence contract:

- the route has no standalone page header; the two cards own the full visible layout
- the route should rely on its inner shell width and card spacing instead of extra page-root horizontal padding, so it stays aligned with the shared routed column
- the first card is informational and should keep the floating astronaut asset from the login shell via `/pages/res/astronaut_no_bg.webp`
- that floating astronaut should stay shadowless so the page matches the shared glass direction
- the first card should explain Space Agent as a browser-first runtime that can reshape the live workspace and scale from personal use to shared group use; it should not foreground implementation paths or prompt-include filenames
- the first card does not show current-user identity text and ends with one compact external repo action that links to `https://github.com/agent0ai/space-agent`
- the second card owns the personality textarea and should load or save the exact file body from `~/conf/personality.system.include.md`
- the personality textarea has no extra label line above it and uses compact shared button styling for reload and save actions
- save flow should create `~/conf/` when needed before writing the personality file
- missing personality files are the normal empty-state case and should not surface as hard errors
- the personality file is promptinclude-owned content: readable `*.system.include.md` files are injected into the agent system prompt, so this page must treat the textarea as raw include text rather than inventing a second config format

## Work Guidance

### Local Work Rules

- keep implementation changes inside this module unless a stable cross-module contract truly changes
- keep the avatar animation local here; do not patch public-shell or overlay motion just to tune this route
- keep personality persistence as a plain text include file, not YAML
- if the route path, panel-manifest path, onscreen menu item, astronaut asset path, or personality include path changes, update this file, `/app/AGENTS.md`, and the matching supplemental docs under `_core/documentation/docs/`

## Verification



## Child DOX Index

- No child DOX docs.
