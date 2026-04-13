# AGENTS

## Purpose

`_core/pages/` owns the page-manifest index used by the dashboard.

It is a small headless-first module that discovers routed page manifests from module-owned `ext/pages/` YAML files through the shared extension resolver, normalizes that metadata into dashboard-friendly entries, and renders the dashboard's secondary `Panels` row beneath the spaces launcher.

Documentation is top priority for this module. After any change under `_core/pages/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `page-index.js`: page-manifest discovery, YAML fetch or parse, route-path normalization, and page-card metadata shaping
- `dashboard-launcher.html`, `dashboard-launcher.js`, and `dashboard-launcher.css`: the injected dashboard panels UI and route-open actions
- `ext/html/_core/dashboard/content_end/pages-dashboard-launcher.html`: thin dashboard extension adapter

## Local Contracts

Current page-manifest contract:

- page manifests live at `mod/<author>/<repo>/ext/pages/*.yaml` or `*.yml`
- page manifests are discovered through `/api/extensions_load`, so readable layer permissions and same-path layered overrides match the existing extension model
- each manifest should define `name`, `path`, optional `description`, optional `icon`, and optional `color`; `icon_color` is accepted as a fallback color key for parity with spaces metadata
- `path` may be a hash-route style path such as `webllm`, a prefixed hash path such as `#/webllm`, or a direct `/mod/...` HTML path such as `/mod/_core/webllm/view.html`
- manifest normalization should collapse whitespace in user-facing strings, normalize icon ligature names through the shared Material Symbols helper, and normalize colors through the shared icon-color helper

Current dashboard integration:

- `_core/dashboard/` provides the `_core/dashboard/content_end` seam for the panels section
- the panels launcher should stay below the spaces launcher and should not pull spaces-owned state into this module
- the dashboard treatment is intentionally secondary navigation, not primary content: render a small uppercase `PANELS` eyebrow above one horizontal row of compact icon-plus-label pill chips
- panel chips should keep a thin outlined border, transparent resting background, and visibly lower weight than the spaces cards above them; descriptions may still feed accessibility or hover affordances, but they should not render as second lines in the dashboard row
- panel chips should open routes through `space.router.goTo(...)` when the router runtime is available and fall back to updating `location.hash`
- the dashboard section should stay read-only; page manifests describe existing routed pages and do not create or mutate app files

## Development Guidance

- keep page discovery browser-owned and permission-aware by reusing the shared extension resolver instead of introducing a dedicated backend endpoint
- keep page manifests lightweight and display-oriented; this module should not become a second router config system
- if the manifest schema, discovery path, or dashboard seam changes, update this file, `/app/AGENTS.md`, and the matching docs under `_core/documentation/docs/`
