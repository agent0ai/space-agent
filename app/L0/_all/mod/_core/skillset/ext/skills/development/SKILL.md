---
name: Development
description: Frontend development router. Load deeper skills before editing
metadata:
  when:
    tags:
      - onscreen
---

Use this skill first for any development task. This is a routing skill: it tells you which deeper development skills to load next. Do not rely on this file alone as the full contract.

When the user wants to extend the system with a reusable interface rather than a space widget, prefer a custom routed page module plus an optional `ext/pages/*.yaml` dashboard entry instead of pushing everything into spaces.

## Hard Boundary

- This skill set only authorizes development in `app/`.
- Do not edit `server/`, `commands/`, or `packaging/` from this skill set.
- Load `development/backend-reference` only to understand backend contracts that the frontend calls into.
- For broad architecture orientation, load the top-level `documentation` skill and use its built-in docs map before diving into narrower docs.
- Before writing files, call `await space.api.userSelfInfo()` and derive writable roots from `username`, `managedGroups`, and `_admin` membership in `groups`.
- Never add third-party CORS proxy services in frontend code or widgets. Load `development/frontend-runtime` and use runtime-managed `fetch(...)`, `space.fetchExternal(...)`, or `space.proxy.buildUrl(...)` instead.
- Always update the relevant `AGENTS.md` files and the matching docs under `/mod/_core/documentation/docs/` in the same session as your code changes.

## Load These Skills Next

- `development/frontend-runtime`
  Load for framework-backed pages, Alpine stores, `space.*` runtime usage, shared visual rules, and general frontend structure.
- `development/modules-routing`
  Load for new routed modules, `view.html`, route paths, router anchors, custom pages as an alternative to spaces, and where first-party features live.
- `development/extensions-components`
  Load for `ext/html/`, `ext/js/`, `x-extension`, `x-component`, and override behavior.
- `development/app-files-apis`
  Load for `space.api`, app-file storage paths, `file_paths`, `userSelfInfo`, and permission-aware frontend reads or writes.
- `development/layers-ownership`
  Load for `L0` or `L1` or `L2`, group and user structure, permissions, and override order.
- `development/skills`
  Load for authoring or updating onscreen chat-agent skills under `ext/skills/`.
- `development/backend-reference`
  Load for read-only backend architecture, API families, auth, and module-resolution behavior.

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
4. `await space.skills.load("development/app-files-apis")` if the page needs frontend discovery of registered pages or other permission-aware app data

### New or updated chat-agent skill

1. `await space.skills.load("development/skills")`
2. `await space.skills.load("development/layers-ownership")`
3. `await space.skills.load("development/extensions-components")` if the skill must explain extension seams

### Task that consumes existing backend APIs from the frontend

1. `await space.skills.load("development/app-files-apis")`
2. `await space.skills.load("development/backend-reference")`

## Final Rule

Before changing a concrete module, also read the closest owning `AGENTS.md` in that module's subtree and the relevant documentation page when one exists. The development skills are the cross-cutting map, the `documentation` skill plus helper are the narrative map, and the local `AGENTS.md` file is the final implementation contract.
