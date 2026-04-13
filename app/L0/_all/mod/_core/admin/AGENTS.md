# AGENTS

## Purpose

`_core/admin/` owns the firmware-backed admin area.

It mounts into `/admin`, keeps admin UI assets on `L0`, provides the split admin-shell layout, and owns the current admin panels and admin-specific skill-loading runtime.

Documentation is top priority for this module. After any change under `_core/admin/`, update this file, any affected deeper admin docs, and any affected parent docs in the same session.

## Documentation Hierarchy

`_core/admin/AGENTS.md` owns the admin-wide shell, tabs, shared admin runtime, and the map of deeper admin surfaces.

Current deeper admin docs:

- `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/files/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/modules/AGENTS.md`

Update rules:

- update the nearest view doc when that view's files, API usage, state model, or CSS contract changes
- update this file when the admin shell, tabs, shared admin runtime, skill loading, or view ownership map changes
- add new deeper docs only for sub-areas with independent runtime, UI, or API contracts

## How To Document Admin Child Docs

Admin view docs should follow one consistent shape:

- `Purpose`
- `Ownership`
- `Runtime And API Contract` or equivalent concrete contract sections
- `UI And State Contract`
- `Development Guidance`

Required coverage for an admin view:

- which HTML, JS, store, CSS, and asset files make up the view
- which admin or shared APIs it calls and what app paths or backend endpoints it reads or mutates
- which state is transient, persisted in session or local storage, or derived from server responses
- which shell hooks, tabs, iframes, dialogs, or quick actions connect it to the broader admin surface
- which styling is local versus inherited from `_core/visual`, `_core/framework`, or admin shell assets

This file keeps shell-wide behavior and skill loading. Child view docs own the concrete UI, store, and API contracts of each view.

## Ownership

This module owns:

- `ext/html/page/admin/body/start/admin-shell.html`: thin adapter that mounts the admin shell into `server/pages/admin.html`
- `ext/html/_core/onscreen_menu/items/admin.html`: top-right app menu item adapter, ordered with `data-order="400"`, that opens the admin shell for the current app URL
- `views/shell/`: split shell layout, tab state, and iframe orchestration
- `views/dashboard/`: dashboard and launch surface inside the admin pane
- `views/agent/`: admin-side agent surface
- `views/files/`: admin Files tab adapter that mounts `_core/file_explorer`
- `views/modules/`: firmware-backed modules panel
- `res/`: admin-local visual assets
- `ext/skills/`: admin-owned skill files exposed through the shared module skill discovery contract

Inactive area:

- `views/documentation/` exists on disk but is not currently mounted by the admin shell; do not document it as an active admin surface until the shell actually wires it in

## Shell Contract

The admin module is mounted only through the page-specific `page/admin/body/start` anchor.

Current shell responsibilities:

- `views/shell/shell.html` owns the split two-pane layout
- `views/shell/shell.html` also exports the admin-page skill-context tag through `<x-skill-context tag="admin">`
- `views/shell/shell.js` owns split sizing, drag-resize behavior, orientation-dependent layout, `?url=` startup handling, and leave-admin navigation back into the current iframe URL
- `views/shell/page.js` owns admin tabs, quick actions, tab keyboard behavior, cached `space.api.userSelfInfo()` state, and `_admin` membership checks derived from `groups`
- the admin topbar keeps tab controls in a real tablist and ends with a non-tab leave-admin icon button that calls the same `adminShell.leaveAdminArea()` action as the dashboard card
- `ext/html/_core/onscreen_menu/items/admin.html` owns the app-menu Admin action, orders it with `data-order="400"`, and builds `/admin?url=<current-path-search-hash>` so the admin iframe opens on the current app location
- the active admin tab is remembered in `sessionStorage`
- iframe-local routed navigation such as the onscreen menu Dashboard action should keep the right-hand pane inside the iframe unless the action explicitly leaves `/admin`

`/admin` runs with `maxLayer=0`, so all module and extension fetches for the admin UI stay firmware-backed even though app-file APIs still work across normal readable or writable layers. Standard same-origin `fetch("/mod/...")` requests from the browser runtime must carry that active max-layer value too so ad hoc module reads stay L0-clamped.

## Admin Sub-Areas

High-level ownership:

- `views/dashboard/` is the lightweight dashboard and launch surface
- `views/agent/` is the admin-side chat or execution surface, owns `space.admin.loadSkill(...)`, and supports remote API transport plus a browser-local Hugging Face provider behind one shared admin loop
- `views/files/` is the admin Files tab adapter; reusable file browsing, editing, creation, copy, move, delete, and download behavior is owned by `_core/file_explorer`
- `views/modules/` is the firmware-backed module list and removal surface

## Skills Contract

Admin agent skills are discovered through the same shared browser-side skill helper as the onscreen agent, but the admin runtime explicitly resolves them with `maxLayer=0` so only firmware-backed skill files influence the admin prompt and `space.admin.loadSkill(...)`.

Current rules:

- `views/agent/skills.js` discovers top-level skill files through the shared `ext/skills` contract with an explicit `maxLayer=0` lookup
- live page-owned `<x-skill-context>` tags still filter that catalog the same way they do for the onscreen agent; the admin shell exports `admin`, and individual skills may use `metadata.when.tags` or `metadata.just_loaded`
- the admin agent prompt receives a compact catalog of those top-level skills plus a `just loaded` block for currently eligible `metadata.just_loaded` skills
- the actual skill content is loaded on demand through `space.admin.loadSkill(name)`
- keep skill folders stable and top-level if they should appear in the catalog
- admin-owned skill files now live under `ext/skills/...` inside the owning module instead of a private `skills/` root

## Development Guidance

- keep admin UI logic inside this module; do not spread admin-only behavior into unrelated modules
- keep admin assets local under `admin/res/` instead of borrowing from unrelated feature modules
- keep the admin shell firmware-backed; do not introduce writable-layer dependencies for the admin UI contract itself
- if you add tabs, change the shell seam, change the app-menu admin handoff, or change how skills are discovered, update this file and `/app/AGENTS.md`
