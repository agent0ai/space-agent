---
name: Extensions And Components
description: Use HTML adapters, JS hook seams, and component loading correctly in the layered module system.
---

Use this skill when the task needs `ext/html/`, `ext/js/`, `x-extension`, `x-component`, `x-context`, or layered override behavior.

## HTML Extension Rules

- Declare structural seams with `<x-extension id="some/path">`.
- Matching HTML files live at `mod/<author>/<repo>/ext/html/some/path/*.html`.
- HTML callers name only the seam; the runtime resolves `ext/html/` automatically.
- Keep extension files thin. They should usually mount a real component with `<x-component path="/mod/...">`.
- `_core/framework` also creates `_core/framework/theme/end` and `_core/framework/head/end` in `document.head` during bootstrap when a layer needs declarative theme CSS, landing or background customization, head-side HTML, or inline bootstrap code without editing page shells.
- Use framework `x-inject="selector"` instead of raw Alpine `x-teleport` when route-owned markup targets a shell seam that may mount later; it mirrors teleport semantics for `<template>` roots, waits for the selector, and disconnects its observer when the source template unmounts.
- Dynamic discovery watches the whole document tree, so `head` seams and the `x-component` nodes they insert are loaded the same way as body content.
- The routed shell header owns Home itself and points it at the empty route `#/`; `_core/onscreen_menu/bar_start` and `_core/onscreen_menu/bar_end` are the left and right shell-control seams, and feature modules add non-Home dropdown menu-action buttons under `_core/onscreen_menu/items` with numeric `data-order` values such as `100`, `200`, `300`, and `400`; `_core/onscreen_menu` sorts contributed controls or items automatically and keeps only the auth exit action after the dropdown seam.

Example:

```html
<x-extension id="page/router/overlay/end"></x-extension>
```

```html
<x-component path="/mod/_core/onscreen_agent/panel.html"></x-component>
```

## JS Hook Rules

- Use `space.extend(import.meta, async function name(...) { ... })` for behavioral seams.
- JS hook files live at `mod/<author>/<repo>/ext/js/<extension-point>/*.js` or `*.mjs`.
- The runtime resolves `/start` and `/end` hooks around the wrapped function automatically.
- `space.extend()` requires a valid module ref and a standalone named function or explicit extension point name.
- Framework-backed pages expose `_core/framework/initializer.js/initialize`; use `_core/framework/theme/end` for declarative theme or background changes, `_core/framework/head/end` when other head-side work can stay declarative, and keep the initializer `/end` hook for once-per-page shell setup that must stay imperative.
- If a feature needs onscreen-agent-specific prompt shaping or execution validation for its own helpers, add an `ext/js/_core/onscreen_agent/...` hook from that feature instead of editing `_core/onscreen_agent` directly.

## Customware Bundle Rules

- A customware bundle is a normal installed `L1` or `L2` module with a root `space.bundle.yaml`.
- Bundle manifests describe capabilities, compatibility, config defaults, extension points, and declarative actions; they do not authorize private runtime patching.
- Bundle UI should use normal `ext/html` seams, bundle behavior should use `ext/js` plus `space.extend(...)`, and bundle skills should live under `ext/skills/*/SKILL.md`.
- Browser commands should register executable handlers through `space.bundles.actions.register(...)` from loaded module code and unregister when the owning component unmounts.
- When a bundle needs an integration point that does not exist yet, add a documented seam in the owning module instead of injecting into private DOM, stores, or framework internals.

## Extension Metadata Rules

- Modules may also store lightweight metadata assets under other `ext/` folders when those files should follow the same readable-layer permissions and same-path override rules as HTML and JS extensions.
- The current first-party example is `ext/panels/*.yaml`, which the dashboard panel index discovers through `file_paths`, batch-reads through `fileRead(...)`, and collapses to one effective manifest per `modulePath + manifestName`.
- Keep those metadata files display-oriented. They are extension-resolved module assets, not general writable storage.

## Component Loader Rules

- `<x-component>` may load a full HTML document or a fragment.
- The loader mounts styles, module scripts, and body nodes, then recursively resolves nested `<x-component>` tags.
- Concurrent scans of the same `<x-component>` target reuse the in-flight load; they must not bail out in a way that leaves late-mounted components partially hydrated.
- Mutation-driven `x-component` discovery watches `document.documentElement`, not only `body`, so head-side components hydrate too.
- Keep component HTML declarative and bind behavior through stores.
- Import the owning store module in the component that owns the feature, not in an unrelated parent shell.

## Context Helper Rules

- Framework bootstrap also injects one hidden runtime `<x-context>` with `data-runtime="browser"` on normal web sessions or `data-runtime="app"` in the packaged desktop runtime; packaged app routes derive that from the desktop bridge before falling back to launcher runtime info or frontend config, and that same element also exposes `runtime-browser` or `runtime-app` through `data-tags`.
- Modules may export additional live skill-filter tags with hidden `<x-context>` elements anywhere in mounted DOM.
- Set one or more tags with `data-tags="a, b, c"`.
- Alpine-bound attributes on `<x-context>` are the normal way to keep tags synced with route or store state.
- Import `/mod/_core/framework/js/context.js` when code needs to inspect current `<x-context>` elements directly; the stable helpers are `getContexts(...)`, `getAttributeValues(...)`, `getTags(...)`, and `getContents(...)`.
- Shared skill discovery reads those tags through that framework helper each time it builds the catalog, auto-loaded skill context, or an explicit skill load.

## Layered Override Behavior

- Module and extension resolution follow the readable `L0 -> L1 -> L2` inheritance chain.
- Identical module-relative extension file paths override lower-ranked entries.
- Different filenames under the same extension point compose together.
- Prefer additive composition before exact-path replacement.
- `maxLayer` constrains module and extension resolution but not logical app-file paths.
- Uncached HTML `<x-extension>` lookups batch before they call `/api/extensions_load`; the default flush is the next animation frame, and frontend constant `HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS` in `app/L0/_all/mod/_core/framework/js/extensions.js` adds an extra wait window in milliseconds before that frame-aligned flush.
- `extensions_load` keeps `maxLayer` at the call level; grouped lookups send ordered `patterns` arrays and receive ordered results with matching `patterns` plus resolved `extensions`.
- JS hook lookups do not use that wait window; they resolve immediately because hook callers await them directly.

## Practical Guidance

- Add a new seam in the owner when downstream customization is realistic.
- Do not bypass an existing seam by reaching into another module's private DOM or internals.
- After adding a new `ext/html/...` or `ext/js/...` file, the running page often needs a refresh before discovery catches up.

## Mandatory Doc Follow-Up

- If extension lookup, component loading, hook behavior, or override semantics change, update the framework docs and the `development` skill subtree in the same session.
