# AGENTS

## Purpose

`_core/dashboard/` owns the default routed dashboard view.

It is a small routed landing surface under the router. The dashboard owns only the layout shell and the stable extension seams inside it, while feature-specific launchers or welcome panels should compose into those seams instead of being hardwired into the dashboard module itself.

Documentation is top priority for this module. After any change under `_core/dashboard/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed dashboard shell and extension anchors
- `dashboard.css`: dashboard-local layout styling

## Local Contracts

Current route contract:

- the dashboard is routed at `#/dashboard`
- the top-right menu Home button intentionally routes to the empty route, not directly here; the router default-route contract currently resolves that empty route to the dashboard
- it should stay a small landing surface, not a second app shell
- the dashboard must own its own page padding because the router shell no longer injects shared route padding

Current extension seams:

- `_core/dashboard/content_start`: content injected directly below the dashboard heading
- `_core/dashboard/content_middle`: main dashboard sections injected between the top and bottom dashboard stacks
- `_core/dashboard/content_end`: lower dashboard sections injected after the main dashboard sections

Rules:

- feature modules may inject dashboard content through the dashboard-owned seam
- dashboard should not import feature-specific state or persistence helpers directly when the extension system can own the composition
- dashboard should keep its own styling minimal so injected modules can own the richer UI below
- dashboard should not add its own route-local gradient or backdrop wash; the shared router canvas is the only background layer for this route
- on desktop and tablet widths, the dashboard shell should keep broad side gutters of about `8em` instead of collapsing early, so injected controls do not collide with fixed global overlay chrome near the viewport edges
- ordering between dashboard sections should be expressed with explicit seams here rather than relying on same-anchor extension filename order

## Development Guidance

- keep dashboard-owned copy and styling minimal
- add or change dashboard seams here rather than reaching into the DOM from another module
- if dashboard routing, default-home behavior, or stable seams change, update this file, `_core/onscreen_menu/AGENTS.md`, and `/app/AGENTS.md`
