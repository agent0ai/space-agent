# AGENTS

## Purpose

`_core/router/` owns the authenticated root app shell.

It mounts into the `/` page shell, resolves hash routes into module views, exposes the routed extension anchors, persists per-route scroll position, and publishes the router contract on `space.router` and Alpine `$router`.

Documentation is top priority for this module. After any change under `_core/router/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/html/body/start/router-page.html`: thin adapter that mounts the router into the root page shell
- `view.html`: the routed shell layout, backdrop mount point, route outlet, shell or overlay extension anchors, and the routed-page skill-context tag exported as `route:<current-path>`
- `route-path.js`: hash-route parsing, normalization, search-param handling, and view-path resolution
- `router-store.js`: router store, route loading lifecycle, scroll persistence, and error rendering
- `router-page.js`: router entry module and static backdrop install
- `router.css`: shell layout and routed-stage styling

## Route Contract

The router is hash-based.

Current route rules:

- the default route is `#/dashboard`
- a one-segment route such as `#/dashboard` resolves to `/mod/_core/dashboard/view.html`
- a multi-segment route such as `#/author/repo/path` resolves to `/mod/author/repo/path/view.html`
- if the final segment already ends in `.html`, the router resolves directly to that file under `/mod/...`
- query parameters remain attached to the resolved route target

`space.router` and Alpine `$router` currently expose:

- `createHref(...)`
- `goTo(...)`
- `replaceTo(...)`
- `back(...)`
- `goBack(...)`
- `getParam(...)`
- `scrollTo(...)`
- `scrollToTop(...)`
- `scrollToElement(...)`

`router-store.js` persists per-route scroll positions in `sessionStorage` under `space.router.scrollPositions`.

## Shell And Extension Seams

`view.html` owns the routed shell and its stable extension points.

Current anchors:

- `_core/router/shell_start`
- `_core/router/shell_end`
- `page/router/route/start`
- `page/router/route/end`
- `page/router/overlay/start`
- `page/router/overlay/end`

The routed overlay anchors are the correct place for floating routed UI such as `_core/onscreen_agent/`. Do not hardwire overlay features directly into `view.html` when an extension seam already exists.

Current shell layout note:

- `.router-stage-inner` is the default centered content column for routed pages
- the router-owned canvas backdrop stays on fixed viewport layers behind `.router-stage`, so route-content scrolling must not move the shared background
- the router shell does not provide shared route padding; routed pages must own their own content padding
- the shell currently marks the active route path on both `.router-stage` and `.router-stage-inner` via `data-route-path`
- the shell also exports the active route path through a hidden `<x-skill-context>` tag in the form `route:<path>` so skill discovery can follow the live route without a separate registry
- route-specific shell layout overrides that affect routed frame width, routed height, or routed scroll ownership belong here in router-owned CSS; `_core/spaces` uses a zero-padding, full-height, overflow-hidden stage override keyed by `data-route-path="spaces"`, and the routed frame wrappers should keep stretching to full width and full height so full-bleed routes are not trapped by intermediate grid items

## Development Guidance

- use extension anchors for shell-level additions instead of editing `view.html` directly whenever possible
- keep route resolution rules centralized in `route-path.js`
- keep route lifecycle, scroll memory, and `space.router` behavior centralized in `router-store.js`
- route-load failures should log to the browser console before the router renders its inline error card
- routed feature modules should ship their own `view.html` and let the router mount them
- if route resolution or stable router seams change, also update `app/L0/_all/mod/_core/skillset/ext/skills/development/` because the shared development skill mirrors this contract
- if route resolution or stable router seams change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/app/`
- if you add or rename a stable router seam, update this file and `/app/AGENTS.md`
