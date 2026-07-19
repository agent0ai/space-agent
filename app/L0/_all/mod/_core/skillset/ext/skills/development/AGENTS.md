# AGENTS

## Purpose

`ext/skills/development/` owns the shared first-party frontend development super-skill for the agent skill surfaces.

This subtree is the durable development reference for the shared browser-side agent runtimes. It must stay aligned with the current app, framework, router, API, layer, and auth contracts so the agent can develop frontend features safely and predictably without drifting into backend changes.

Documentation is top priority for this subtree. After any change under `ext/skills/development/`, or any mirrored source-contract change, update this file and the affected skill files in the same session.

## Ownership

This subtree owns:

- the top-level `development` skill id exposed through the shared `_core/skillset` skill catalogs
- the nested development skill ids under `development/...`
- the maintenance contract that keeps those skills aligned with the current repo docs

Source-doc mirror map:

- `frontend-runtime/SKILL.md` mirrors `/app/AGENTS.md` and `/app/L0/_all/mod/_core/framework/AGENTS.md`
- `modules-routing/SKILL.md` mirrors `/app/AGENTS.md` and `/app/L0/_all/mod/_core/router/AGENTS.md`
- `modules-routing/panel-tools.js` mirrors `/app/L0/_all/mod/_core/panels/AGENTS.md` plus the router helper contract in `/app/L0/_all/mod/_core/router/AGENTS.md`
- `extensions-components/SKILL.md` mirrors `/app/AGENTS.md` and `/app/L0/_all/mod/_core/framework/AGENTS.md`
- `app-files-apis/SKILL.md` mirrors `/app/AGENTS.md`, `/server/api/AGENTS.md`, and `/server/lib/customware/AGENTS.md`, including the `user_self_info` identity contract and writable-root derivation rules
- `layers-ownership/SKILL.md` mirrors `/AGENTS.md`, `/app/AGENTS.md`, `/server/lib/customware/AGENTS.md`, and `/server/lib/auth/AGENTS.md`
- `skills/SKILL.md` mirrors `/app/L0/_all/mod/_core/skillset/AGENTS.md`, `/app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`, the shared skill-runtime helper, and the onscreen skill runtime contract
- `backend-reference/SKILL.md` mirrors `/server/AGENTS.md`, `/server/api/AGENTS.md`, `/server/lib/customware/AGENTS.md`, and `/server/lib/auth/AGENTS.md`

## Local Contracts

### Local Contracts

- the router skill must tell the agent to load one or more deeper skills before making development changes
- the top-level `development` router skill must stay readable and auto-included through `metadata.loaded: true` plus `metadata.placement: system` so agents always see the development map before deciding which nested skill to load
- the router skill and `modules-routing/SKILL.md` should teach custom routed pages as the primary extension path when the user wants a reusable feature surface instead of a space widget
- `modules-routing/SKILL.md` and `modules-routing/panel-tools.js` must keep the dashboard-panel workflow explicit: how to create `ext/panels/*.yaml`, which `path` forms are accepted, and how to list, resolve, and navigate visible panels from browser-side helper code
- the router skill should keep one visible subsection per nested development skill so the always-included top-level skill acts as a stable index for deeper frontend contracts
- the router skill and `app-files-apis/SKILL.md` must tell the agent to inspect `space.api.userSelfInfo()` and derive writable app roots from `username`, `managedGroups`, and `_admin` membership in `groups`
- `app-files-apis/SKILL.md`, `layers-ownership/SKILL.md`, and `backend-reference/SKILL.md` must keep optional `CUSTOMWARE_GIT_HISTORY` helpers and reserved `.git` metadata guidance aligned with the backend docs
- this skill set only authorizes frontend development in `app/`; the backend reference skill is for understanding contracts, not for editing `server/`, `commands/`, or `packaging/`
- the router skill should tell the agent to use the top-level `documentation` skill's built-in docs map for broad orientation when relevant, while still treating `AGENTS.md` files as the binding contract layer
- nested skills should stay focused on one area rather than repeating the whole architecture
- `frontend-runtime/SKILL.md` must keep the shared runtime helper list current, including browser utilities such as `space.utils.markdown.render(...)`
- `frontend-runtime/SKILL.md` must keep embedded browser-surface guidance current, including direct `<x-browser>` authoring, the `controls` attribute, and automatic `space.browser` registration
- `frontend-runtime/SKILL.md` must keep the external-fetch guidance current: frontend code should use runtime-managed `fetch(...)` or `space.fetchExternal(...)` and must not hardcode third-party CORS proxy services because the runtime already falls back to `/api/proxy`
- `extensions-components/SKILL.md` must keep extension lookup batching guidance current, including the HTML-only frontend constant `HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS`, and must keep delayed-target `x-inject` guidance current for route-owned markup that targets shell seams
- `frontend-runtime/SKILL.md` and `extensions-components/SKILL.md` must keep the framework-managed `_core/framework/head/end` seam aligned with the imperative `_core/framework/initializer.js/initialize/end` fallback guidance
- `skills/SKILL.md` should tell authors to prefer small skill-local helper imports inside the owning skill folder over long inlined browser scripts when that keeps skill text shorter and more stable
- `skills/SKILL.md` must keep the shared skill metadata rules current, including `metadata.when`, `metadata.loaded`, `metadata.placement`, and the live `<x-context>` tag contract
- `skills/SKILL.md` must keep the first-party tag examples current: framework bootstrap emits exactly one runtime context with `data-runtime="browser"` or `data-runtime="app"` and the derived tags `runtime-browser` or `runtime-app`, the overlay emits `onscreen`, the admin shell emits `admin`, and feature modules may add route or state tags such as `route:<current-path>` or `space:open`
- prompt-facing skill text must stay token-budgeted; keep catalog-facing descriptions terse and keep auto-loaded skill guidance compact
- when a complex area grows, add another nested skill instead of bloating the router skill
- if a mirrored contract changes in a source doc, update the affected development skills in the same session even if this subtree itself was not directly edited

## Work Guidance

### Local Work Rules

- keep the router skill short and directive
- keep child skills concrete and task-oriented
- prefer exact path examples and file locations over abstract advice
- keep reusable helper scripts small and importable from stable `/mod/...` paths when a skill needs browser logic more than once
- call out read-only backend boundaries explicitly wherever backend context appears
- if framework, router, API, layer, permission, or auth rules change, update this subtree before finishing the session

## Verification



## Child DOX Index

- No child DOX docs.
