---
name: Development
description: Build new browser modules in the layered Space Agent runtime and use the extension, component, and Alpine store patterns correctly.
metadata:
  when:
    tags:
      - admin
---

Use this skill when the user asks how to build a module, where code should live, how layers work, or how the extension/component/Alpine runtime composes the frontend.

## Layer Model

- `L0` is firmware. Repo-owned first-party code belongs here.
- `L1` is group customware. Use it for group-level overrides and additions.
- `L2` is user customware. Use it for per-user overrides and additions.
- First-party source for this repository should normally live under `app/L0/_all/mod/_core/...`.
- `L1` and `L2` are runtime state, not the home for durable repo-owned product code.

## Module Layout

- Browser modules are namespaced as `mod/<author>/<repo>/...`.
- A first-party module usually lives at `app/L0/_all/mod/_core/<feature>/`.
- Keep real implementation files in the module folder.
- Keep `ext/html/` adapter files and `ext/js/` hook files thin. They should usually mount a real component or provide a focused hook, not hold the whole feature.

## How The Frontend Composes

1. Page shells in `server/pages/` stay thin and expose `<x-extension id="...">` anchors.
2. Matching HTML extension files live under `mod/<author>/<repo>/ext/html/<anchor>/...`.
3. Those extension files usually mount a real component with `<x-component path="/mod/...">`.
4. `<x-component>` loads the component HTML, styles, scripts, and nested components.
5. Alpine stores and small module utilities own the behavior.

Example pattern:

```html
<x-extension id="page/admin/body/start"></x-extension>
```

```html
<x-component path="/mod/_core/admin/views/shell/shell.html"></x-component>
```

## Alpine And Store Pattern

- Component HTML owns structure and bindings.
- Stores created through `space.fw.createStore(...)` own state, async work, persistence, and API calls.
- Small utility modules own parsing and rendering helpers.
- Do not move large feature logic into long inline `x-data` blocks.

## JS Extension Hooks

- Use `space.extend(import.meta, async function name(...) { ... })` for behavioral extension seams.
- `/start` hook files run before the wrapped function.
- `/end` hook files run after the wrapped function.
- JS hook files live under `mod/<author>/<repo>/ext/js/<extension-point>/...`.
- Use HTML anchors for structural seams and `space.extend(...)` for behavioral seams.

## Layer Resolution And Overrides

- Admin UI asset resolution is clamped to `L0` with `maxLayer=0`.
- Normal module resolution composes `L0`, then `L1`, then `L2`.
- If two layers provide the exact same extension file path, the higher layer overrides the lower one.
- If two layers provide different filenames under the same extension point, both contributions compose together.
- Prefer additive composition before exact-path replacement.

## Practical Workflow

- For a new repo-owned feature, create a module under `app/L0/_all/mod/_core/<feature>/`.
- Add a thin `ext/html/.../*.html` adapter that mounts the feature into an existing anchor.
- Put surface markup in component HTML, surface styling in a nearby stylesheet, and behavior in a store module plus small utilities.
- Keep page shells minimal and avoid bypassing the extension system.
- When the task needs more detail, treat `app/AGENTS.md` as the canonical deep reference for layers, components, hooks, and ordering.
