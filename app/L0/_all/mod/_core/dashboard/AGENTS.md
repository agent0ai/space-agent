# AGENTS

## Purpose

`_core/dashboard/` owns the default routed dashboard view.

It is a small routed landing surface under the router. The dashboard owns only the layout shell and the stable extension seams inside it, while feature-specific launchers or welcome panels should compose into those seams instead of being hardwired into the dashboard module itself.

Documentation is top priority for this module. After any change under `_core/dashboard/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed dashboard shell, route-owned topbar inject cluster, the trailing overscroll spacer, and extension anchors
- `dashboard.css`: dashboard-local layout styling

## Local Contracts

### Local Contracts

Current route contract:

- the dashboard is routed at `#/dashboard`
- the routed header Home button intentionally routes to the empty route, not directly here; the router default-route contract currently resolves that empty route to the dashboard
- it should stay a small landing surface, not a second app shell
- the dashboard must own its own vertical page spacing because the router shell no longer injects shared route padding, but it should not add extra horizontal shell-compensation gutters at the route root
- the dashboard also owns its extra route-end breathing room under the chat overlay; `view.html` ends with a dedicated trailing spacer sized by `--dashboard-end-overscroll`, currently `15em`, so the route always keeps real scrollable tail space below the last dashboard section

Current extension seams:

- `_core/dashboard/topbar_primary`: the first dashboard-owned topbar slot inside the route-owned cluster injected into `[id="_core/onscreen_menu/bar_start"]`
- `_core/dashboard/topbar_secondary`: the second dashboard-owned topbar slot inside that injected cluster for auxiliary restore or secondary actions
- `_core/dashboard/content_start`: content injected directly below the dashboard heading
- `_core/dashboard/content_middle`: main dashboard sections injected between the top and bottom dashboard stacks
- `_core/dashboard/content_end`: lower dashboard sections injected after the main dashboard sections

Rules:

- the dashboard route owns the `x-inject` into `[id="_core/onscreen_menu/bar_start"]`, but feature modules own the actual dashboard-only buttons through `_core/dashboard/topbar_primary` and `_core/dashboard/topbar_secondary`
- feature modules may inject dashboard content through the dashboard-owned seam
- dashboard should not import feature-specific state or persistence helpers directly when the extension system can own the composition
- dashboard should keep its own styling minimal so injected modules can own the richer UI below, but shared route-level section chrome such as the common dashboard section heading treatment belongs in `dashboard.css` instead of being redefined separately in each injected launcher
- the shared dashboard section heading treatment is an inset centered divider: uppercase title text sits between short left and right hairlines whose subdued cool-blue gradients brighten toward the title and fade outward, and injected dashboard launchers should reuse that shared class pair instead of recreating local heading chrome
- dashboard should not add its own route-local gradient or backdrop wash; the shared router canvas is the only background layer for this route
- desktop width should come from the inner `.dashboard-shell` max-width rather than extra route-root side gutters, so injected sections align with the shared routed column
- `.dashboard-shell` should clamp to the same `--onscreen-menu-shell-max-width` contract used by `_core/onscreen_menu`, so the dashboard column and top overlay bar stay visually aligned instead of drifting to different desktop widths
- ordering between dashboard topbar controls and dashboard sections should be expressed with explicit seams here rather than relying on same-anchor extension filename order

## Work Guidance

### Local Work Rules

- keep dashboard-owned copy and styling minimal
- add or change dashboard seams here rather than reaching into the DOM from another module
- if dashboard routing, default-home behavior, or stable seams change, update this file, `_core/onscreen_menu/AGENTS.md`, and `/app/AGENTS.md`

## Verification



## Child DOX Index

- No child DOX docs.
