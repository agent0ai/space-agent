---
name: Extensions And Components
description: Use HTML adapters, JS hook seams, and component loading correctly in the layered module system.
---

Use this skill when the task needs `ext/html/`, `ext/js/`, `x-extension`, `x-component`, `x-skill-context`, or layered override behavior.

## HTML Extension Rules

- Declare structural seams with `<x-extension id="some/path">`.
- Matching HTML files live at `mod/<author>/<repo>/ext/html/some/path/*.html`.
- HTML callers name only the seam; the runtime resolves `ext/html/` automatically.
- Keep extension files thin. They should usually mount a real component with `<x-component path="/mod/...">`.
- `_core/framework` also creates `_core/framework/head/end` in `document.head` during bootstrap when a layer needs head-side HTML or inline bootstrap code without editing page shells.
- Dynamic discovery watches the whole document tree, so `head` seams and the `x-component` nodes they insert are loaded the same way as body content.
- The top-right routed menu owns Home itself and points it at the empty route `#/`; feature modules add non-Home menu-action buttons under `_core/onscreen_menu/items` with numeric `data-order` values such as `100`, `200`, `300`, and `400`, `_core/onscreen_menu` sorts them automatically, and `_core/onscreen_menu` keeps only the auth exit action after that seam.

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
- Framework-backed pages expose `_core/framework/initializer.js/initialize`; use `_core/framework/head/end` when the work can stay declarative, and keep the initializer `/end` hook for once-per-page shell setup that must stay imperative.
- If a feature needs onscreen-agent-specific prompt shaping or execution validation for its own helpers, add an `ext/js/_core/onscreen_agent/...` hook from that feature instead of editing `_core/onscreen_agent` directly.

## Extension Metadata Rules

- Modules may also store lightweight metadata assets under other `ext/` folders when those files should follow the same readable-layer permissions and same-path override rules as HTML and JS extensions.
- The current first-party example is `ext/pages/*.yaml`, which the dashboard page index discovers through `extensions_load`.
- Keep those metadata files display-oriented. They are extension-resolved module assets, not general writable storage.

## Component Loader Rules

- `<x-component>` may load a full HTML document or a fragment.
- The loader mounts styles, module scripts, and body nodes, then recursively resolves nested `<x-component>` tags.
- Mutation-driven `x-component` discovery watches `document.documentElement`, not only `body`, so head-side components hydrate too.
- Keep component HTML declarative and bind behavior through stores.
- Import the owning store module in the component that owns the feature, not in an unrelated parent shell.

## Skill Context Helper Rules

- Modules may export live skill-filter tags with hidden `<x-skill-context>` elements anywhere in mounted DOM.
- Set one tag with `tag="..."` or multiple tags with `tags="a b c"`.
- Alpine-bound attributes on `<x-skill-context>` are the normal way to keep tags synced with route or store state.
- Shared skill discovery reads those tags directly from the current document each time it builds the catalog, the `just loaded` block, or an explicit skill load.

## Layered Override Behavior

- Module and extension resolution follow the readable `L0 -> L1 -> L2` inheritance chain.
- Identical module-relative extension file paths override lower-ranked entries.
- Different filenames under the same extension point compose together.
- Prefer additive composition before exact-path replacement.
- `maxLayer` constrains module and extension resolution but not logical app-file paths.
- Uncached HTML `<x-extension>` lookups batch before they call `/api/extensions_load`; the default flush is the next animation frame, and frontend constant `HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS` in `app/L0/_all/mod/_core/framework/js/extensions.js` adds an extra wait window in milliseconds before that frame-aligned flush.
- JS hook lookups do not use that wait window; they resolve immediately because hook callers await them directly.

## Practical Guidance

- Add a new seam in the owner when downstream customization is realistic.
- Do not bypass an existing seam by reaching into another module's private DOM or internals.
- After adding a new `ext/html/...` or `ext/js/...` file, the running page often needs a refresh before discovery catches up.

## Mandatory Doc Follow-Up

- If extension lookup, component loading, hook behavior, or override semantics change, update the framework docs and the `development` skill subtree in the same session.
