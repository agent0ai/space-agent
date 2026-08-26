# AGENTS

## Purpose

`_core/panels/` owns the panel-manifest index used by the dashboard.

It is a small headless-first module that discovers dashboard panel manifests from module-owned `ext/panels/` YAML files through permission-aware module file discovery, normalizes that metadata into dashboard-friendly entries, and renders the dashboard's secondary `Panels` row beneath the spaces launcher.

Documentation is top priority for this module. After any change under `_core/panels/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `panel-index.js`: panel-manifest discovery, batched logical manifest reads, route-path normalization, and panel-chip metadata shaping
- `dashboard-launcher.html`, `dashboard-launcher.js`, and `dashboard-launcher.css`: the injected dashboard panels UI and route-open actions
- `ext/html/_core/dashboard/content_end/panels-dashboard-launcher.html`: thin dashboard extension adapter

## Local Contracts

### Local Contracts

Current panel-manifest contract:

- panel manifests live at `mod/<author>/<repo>/ext/panels/*.yaml` or `*.yml`
- panel manifests are discovered through `file_paths` and batch-read through `space.api.fileRead(...)`, so readable layer permissions still come from the shared module-file access rules without per-manifest fetch fanout
- the browser index should collapse same `modulePath + manifestName` layered duplicates down to one effective manifest entry before parsing so same-path overrides keep working
- each manifest should define `name`, `path`, optional `description`, optional `icon`, and optional `color`; `icon_color` is accepted as a fallback color key for parity with spaces metadata
- `path` may be a hash-route style path such as `webllm`, a prefixed hash path such as `#/webllm`, or a direct `/mod/...` HTML path such as `/mod/_core/webllm/view.html`
- manifest normalization should collapse whitespace in user-facing strings, normalize icon ligature names through the shared Material Symbols helper, and normalize colors through the shared icon-color helper

Current dashboard integration:

- `_core/dashboard/` provides the `_core/dashboard/content_end` seam for the panels section
- the panels launcher should stay below the spaces launcher and should not pull spaces-owned state into this module
- the dashboard treatment is intentionally secondary navigation, not primary content: render a `Panels` section heading that reuses the shared centered uppercase dashboard divider styling from `_core/dashboard/dashboard.css`, keeps a clearly visible extra top gap from the spaces cards above it, and sits above one horizontal row of compact icon-plus-label pill chips
- panel chips should keep a thin outlined border, transparent resting background, and visibly lower weight than the spaces cards above them; descriptions may still feed accessibility or hover affordances, but they should not render as second lines in the dashboard row
- panel-chip hover emphasis must use border, background, or shadow changes only; do not translate or otherwise move the chip on hover because the dashboard row should keep a stable pointer hitbox
- panel chips should open routes through `space.router.goTo(...)` when the router runtime is available and fall back to updating `location.hash`
- the dashboard section should stay read-only; panel manifests describe existing routed pages and do not create or mutate app files

## Work Guidance

### Local Work Rules

- keep panel discovery browser-owned and permission-aware through `file_paths` plus batched `fileRead(...)` instead of introducing a dedicated backend endpoint or per-manifest fetch fanout
- keep panel manifests lightweight and display-oriented; this module should not become a second router config system
- if the manifest schema, discovery path, or dashboard seam changes, update this file, `/app/AGENTS.md`, and the matching docs under `_core/documentation/docs/`

## Verification



## Child DOX Index

- No child DOX docs.
