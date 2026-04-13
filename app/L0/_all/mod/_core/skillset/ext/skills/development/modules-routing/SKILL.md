---
name: Modules And Routing
description: Place first-party modules correctly, make them routable, and use router seams instead of hardwiring features into shells.
---

Use this skill when creating or updating routed modules, deciding where files belong, or wiring a feature into the authenticated app shell.

If the user wants a reusable app surface, tool UI, settings panel, or workflow screen, prefer a custom routed page module over a space. Spaces are for persisted user-authored widget canvases; custom pages are for feature-owned interfaces.

## First-Party Module Placement

- Browser modules are namespaced as `mod/<author>/<repo>/...`.
- Repo-owned first-party modules should normally live under `app/L0/_all/mod/_core/<feature>/`.
- A routed feature should usually own its own `view.html` under that module root.
- Keep the module root as the real implementation location and use `ext/html/...` files only as thin adapters into existing seams.

## Custom Pages Instead Of Spaces

- Build a custom routed page when the extension should behave like a first-class feature screen instead of a widget on a persisted space canvas.
- Use spaces when the user wants a configurable board of widgets that lives under `~/spaces/...`.
- Use a routed page when the feature owns its own layout, state, and navigation flow.
- To make a custom page appear in the dashboard `Pages` section, add `ext/pages/<name>.yaml` in the owning module.
- Page manifests should define `name`, `path`, optional `description`, optional `icon`, and optional `color`.
- For first-party `_core` routes, the manifest `path` may use shorthand such as `webllm` instead of a full `/mod/...` path.

## Router Resolution

- The main app is hash-routed.
- `#/dashboard` resolves to `/mod/_core/dashboard/view.html`.
- `#/time_travel` resolves to `/mod/_core/time_travel/view.html`.
- A multi-segment route such as `#/author/repo/path` resolves to `/mod/author/repo/path/view.html`.
- If the final route segment already ends in `.html`, the router resolves directly to that file under `/mod/...`.
- Query parameters stay attached to the resolved route target.

## Router-Owned Seams

Current routed shell anchors are:

- `_core/router/shell_start`
- `_core/router/shell_end`
- `page/router/route/start`
- `page/router/route/end`
- `page/router/overlay/start`
- `page/router/overlay/end`

Use those anchors before editing router shell markup directly. Floating UI such as the onscreen agent belongs in the routed overlay anchors.

## Common Module Shape

For a new first-party routed feature, the normal home is:

```text
app/L0/_all/mod/_core/<feature>/
  view.html
  <feature>.css
  store.js
  panel.html or supporting components
  ext/pages/<feature>.yaml when the page should be discoverable from the dashboard
  ext/html/... only when the feature mounts into an existing seam
```

Minimal first-party custom page example:

```text
app/L0/_all/mod/_core/my_tool/
  view.html
  my-tool.css
  store.js
  ext/pages/my-tool.yaml
```

Example page manifest:

```yaml
name: My Tool
path: my_tool
description: A custom routed tool page.
icon: build
color: "#94bcff"
```

## Page Helper Script

Reusable helper script:

```js
const pageTools = await import("/mod/_core/skillset/ext/skills/development/modules-routing/page-tools.js");
```

Available helpers:

- `await pageTools.listPages()` returns the normalized dashboard page entries discovered from `ext/pages/*.yaml`
- `await pageTools.findPage("webllm")` resolves a page by route path or visible name
- `await pageTools.createPageHref("webllm")` returns the routed href
- `await pageTools.goToPage("webllm")` navigates through `space.router` with a hash fallback

Use those helpers when you need to inspect the registered pages before wiring new links or when the user asks to navigate to one of them.

## Shell Rules

- `/` is the authenticated app shell and mounts `_core/router`.
- `/admin` is separate and firmware-clamped to `L0`; do not treat it as the default home for user-facing routed features.
- Keep page-shell concerns in the router or page shells and keep feature logic inside the owning module.

## Mandatory Doc Follow-Up

- If route resolution, stable router seams, or the first-party module placement rules change, update the router docs and the `development` skill subtree in the same session.
