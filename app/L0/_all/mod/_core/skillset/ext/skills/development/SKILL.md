---
name: Development
description: Frontend development router. Load deeper skills before editing
metadata:
  loaded: true
  placement: system
---

Use this skill first for any development task. This is a routing skill: it tells you which deeper development skills to load next. Do not rely on this file alone as the full contract.

When the user wants to extend the system with a reusable interface rather than a space widget, prefer a custom routed page module plus an optional `ext/panels/*.yaml` dashboard entry instead of pushing everything into spaces.

When the user wants to package reusable downstream customizations for install, update, or removal as one unit, use the customware-bundle convention: a normal `L1` or `L2` module with `space.bundle.yaml`, normal `ext/html`, `ext/js`, and `ext/skills` seams, and browser commands registered through `space.bundles.actions`.

## Hard Boundary

- This skill set only authorizes development in `app/`.
- Do not edit `server/`, `commands/`, or `packaging/` from this skill set.
- Load `development/backend-reference` only to understand backend contracts that the frontend calls into.
- For broad architecture orientation, load the top-level `documentation` skill and use its built-in docs map before diving into narrower docs.
- Before writing files, call `await space.api.userSelfInfo()` and derive writable roots from `username`, `managedGroups`, and `_admin` membership in `groups`.
- Never add third-party CORS proxy services in frontend code or widgets. Load `development/frontend-runtime` and use runtime-managed `fetch(...)`, `space.fetchExternal(...)`, or `space.proxy.buildUrl(...)` instead.
- Always update the relevant `AGENTS.md` files and the matching docs under `/mod/_core/documentation/docs/` in the same session as your code changes.

## Development Subskills

### `development/modules-routing`

Load this first for routed feature work, dashboard panels, route paths, router anchors, and deciding whether a feature should be a custom page instead of a space.

Current panel helper:

- Import `/mod/_core/skillset/ext/skills/development/modules-routing/panel-tools.js`
- Use `listPanels()`, `findPanel(target)`, `resolvePanelRoutePath(target)`, `createPanelHref(target)`, and `goToPanel(target)` when the task needs to inspect or navigate the current user's visible dashboard panels

### `development/frontend-runtime`

Load for framework-backed pages, Alpine stores, `space.*` runtime usage, shared visual rules, and general frontend structure.

### `development/extensions-components`

Load for `ext/html/`, `ext/js/`, `x-extension`, `x-component`, `x-context`, and layered override behavior.

Also load it for customware bundles that need to turn runtime patches into documented seams.

### `development/app-files-apis`

Load for `space.api`, app-file storage paths, `file_paths`, `userSelfInfo`, and permission-aware frontend reads or writes.

### `development/layers-ownership`

Load for `L0` or `L1` or `L2`, group and user structure, permissions, writable roots, and override order.

### `development/skills`

Load for authoring or updating onscreen chat-agent skills under `ext/skills/`, including how to keep skills short by importing helper scripts.

### `development/backend-reference`

Load for read-only backend architecture, API families, auth, and module-resolution behavior when frontend work depends on an existing server contract.

## Recommended Load Order

### New first-party routed feature

1. `await space.skills.load("development/layers-ownership")`
2. `await space.skills.load("development/modules-routing")`
3. `await space.skills.load("development/extensions-components")`
4. `await space.skills.load("development/frontend-runtime")`
5. `await space.skills.load("development/app-files-apis")` if the feature stores user or group data

### New custom page instead of a space

1. `await space.skills.load("development/modules-routing")`
2. `await space.skills.load("development/extensions-components")`
3. `await space.skills.load("development/frontend-runtime")`
4. `await space.skills.load("development/app-files-apis")` if the page needs frontend discovery of registered panels or other permission-aware app data

### New or updated chat-agent skill

1. `await space.skills.load("development/skills")`
2. `await space.skills.load("development/layers-ownership")`
3. `await space.skills.load("development/extensions-components")` if the skill must explain extension seams

### Task that consumes existing backend APIs from the frontend

1. `await space.skills.load("development/app-files-apis")`
2. `await space.skills.load("development/backend-reference")`

## Final Rule

Before changing a concrete module, also read the closest owning `AGENTS.md` in that module's subtree and the relevant documentation page when one exists. The development skills are the cross-cutting map, the `documentation` skill plus helper are the narrative map, and the local `AGENTS.md` file is the final implementation contract.
