# AGENTS

## Purpose

`_core/admin/` owns the firmware-backed admin area.

It mounts into `/admin`, keeps admin UI assets on `L0`, provides the split admin-shell layout, and owns the current admin panels plus the admin-side runtime glue around shared agent prompt and skill helpers.

Documentation is top priority for this module. After any change under `_core/admin/`, update this file, any affected deeper admin docs, and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/html/page/admin/body/start/admin-shell.html`: thin adapter that mounts the admin shell into `server/pages/admin.html`
- `ext/html/_core/onscreen_menu/items/admin.html`: routed header-menu item adapter, ordered with `data-order="400"`, that opens the admin shell for the current app URL
- `views/shell/`: split shell layout, tab state, and iframe orchestration
- `views/dashboard/`: dashboard and launch surface inside the admin pane
- `views/agent/`: admin-side agent surface
- `views/files/`: admin Files tab adapter that mounts `_core/file_explorer`
- `views/time_travel/`: admin Time Travel tab adapter that mounts `_core/time_travel`
- `views/modules/`: firmware-backed modules panel
- `ext/skills/`: admin-owned skill files exposed through the shared module skill discovery contract

Inactive area:

- `views/documentation/` exists on disk but is not currently mounted by the admin shell; do not document it as an active admin surface until the shell actually wires it in
- Direct child DOX docs listed below own their narrower subtrees.

## Local Contracts

### Shell Contract

The admin module is mounted only through the page-specific `page/admin/body/start` anchor.

Current shell responsibilities:

- `views/shell/shell.html` owns the split two-pane layout
- `views/shell/shell.html` also exports the admin-page context tag through `<x-context data-tags="admin">`
- `views/shell/shell.html` mirrors the routed `[id="_core/onscreen_menu/bar_start"]` inject host above admin tab content so embedded routed surfaces can reuse their existing injected controls inside `/admin`
- that mirrored inject host must collapse completely when no active tab contributes controls, so the active admin panel still stretches to full height and the admin-agent composer stays pinned to the pane bottom while its thread scrolls above
- `views/shell/shell.js` owns split sizing, drag-resize behavior, orientation-dependent layout, `?url=` startup handling, and leave-admin navigation back into the current iframe URL
- `views/shell/page.js` owns admin tabs, dashboard quick actions, tab keyboard behavior, cached `space.api.userSelfInfo()` state, and `_admin` membership checks derived from `groups`
- the admin topbar keeps tab controls in a real tablist, stretches to the current left-pane width with admin-shell-specific sizing that overrides the shared `space-topbar` fit-content default before it decides whether to keep the full strip, drop the active-tab label, or collapse non-active tabs into an expandable dropdown, keeps that dropdown layered above active admin-panel content so routed views cannot obstruct it, and ends with a non-tab leave-admin icon button that calls the same `adminShell.leaveAdminArea()` action as the dashboard card
- tab-specific routed controls injected into `[id="_core/onscreen_menu/bar_start"]` should appear in the mirrored admin host only while their tab is active; lazy-mount those panels when needed instead of leaving stale injected controls behind
- `ext/html/_core/onscreen_menu/items/admin.html` owns the routed header-menu Admin action, orders it with `data-order="400"`, and builds `/admin?url=<current-path-search-hash>` so the admin iframe opens on the current app location
- the active admin tab is remembered in `sessionStorage`
- iframe-local routed navigation such as the onscreen menu Dashboard action should keep the right-hand pane inside the iframe unless the action explicitly leaves `/admin`

`/admin` runs with `maxLayer=0`, so all module and extension fetches for the admin UI stay firmware-backed even though app-file APIs still work across normal readable or writable layers. Standard same-origin `fetch("/mod/...")` requests from the browser runtime must carry that active max-layer value too so ad hoc module reads stay L0-clamped.

### Admin Sub-Areas

High-level ownership:

- `views/dashboard/` is the lightweight dashboard and launch surface
- `views/agent/` is the admin-side chat or execution surface, owns `space.admin.loadSkill(...)` plus the admin-side `space.skills.load(...)` alias, reuses the standard prepared prompt builder shared with the onscreen agent through `_core/agent_prompt/`, and supports remote API transport plus a browser-local Hugging Face provider behind one shared admin loop
- `views/files/` is the admin Files tab adapter; reusable file browsing, editing, creation, copy, move, delete, and download behavior is owned by `_core/file_explorer`
- `views/time_travel/` is the admin Time Travel tab adapter; reusable history state, repository discovery, diffs, travel, revert, and injected refresh or repository controls are owned by `_core/time_travel`
- `views/modules/` is the firmware-backed module list and removal surface

### Skills Contract

Admin agent skills use the same shared browser-side discovery and prompt-shaping contract as the onscreen agent.

Current rules:

- `views/agent/skills.js` exposes `space.admin.loadSkill(...)` for admin-owned code and mirrors that same loader onto `space.skills.load(...)` so the standard prepared prompt can keep its normal load hint
- live page-owned `<x-context>` tags still filter that catalog the same way they do for the onscreen agent; the admin shell exports `admin`, and individual skills may use `metadata.when` and `metadata.loaded` as either `true` or `{ tags: [...] }` conditions plus `metadata.placement`
- the admin agent prompt now reuses the same standard catalog, auto-loaded skill, examples, history, and transient path that the onscreen agent uses; custom admin instructions are still appended last
- the actual skill content is loaded on demand through `space.admin.loadSkill(name)`, with `history` placement entering ordinary execution-output history and `system` or `transient` placement registering runtime prompt context plus the short load-result text
- keep skill folders stable and top-level if they should appear in the catalog
- admin-owned skill files now live under `ext/skills/...` inside the owning module instead of a private `skills/` root

## Work Guidance

### Child DOX Guidance

Admin view docs should follow the DOX section spine:

- `Purpose`
- `Ownership`
- `Local Contracts`
- `Work Guidance`
- `Verification`
- `Child DOX Index`

Required coverage for an admin view:

- which HTML, JS, store, CSS, and asset files make up the view
- which admin or shared APIs it calls and what app paths or backend endpoints it reads or mutates
- which state is transient, persisted in session or local storage, or derived from server responses
- which shell hooks, tabs, iframes, dialogs, or quick actions connect it to the broader admin surface
- which styling is local versus inherited from `_core/visual`, `_core/framework`, or admin shell assets

This file keeps shell-wide behavior and skill loading. Child view docs own the concrete UI, store, and API contracts of each view.

### Local Work Rules

- keep admin UI logic inside this module; do not spread admin-only behavior into unrelated modules
- keep repo-owned app image assets under `_core/visual/res/`; do not store admin-module image files under `_core/admin/`
- keep the admin shell firmware-backed; do not introduce writable-layer dependencies for the admin UI contract itself
- if you add tabs, change the shell seam, change the app-menu admin handoff, or change how skills are discovered, update this file and `/app/AGENTS.md`

## Verification



## Child DOX Index

- `/app/L0/_all/mod/_core/admin/views/agent/AGENTS.md` - _core/admin/views/agent/ owns the admin-side agent surface.
- `/app/L0/_all/mod/_core/admin/views/files/AGENTS.md` - _core/admin/views/files/ owns the admin Files tab adapter.
- `/app/L0/_all/mod/_core/admin/views/modules/AGENTS.md` - _core/admin/views/modules/ owns the firmware-backed modules panel.
- `/app/L0/_all/mod/_core/admin/views/time_travel/AGENTS.md` - _core/admin/views/time_travel/ owns the admin Time Travel tab adapter.
