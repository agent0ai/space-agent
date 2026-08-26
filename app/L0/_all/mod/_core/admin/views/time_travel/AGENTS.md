# AGENTS

## Purpose

`_core/admin/views/time_travel/` owns the admin Time Travel tab adapter.

It keeps the admin tab mount point inside `_core/admin/` and delegates the actual Git-history UI, state, dialogs, and API workflow to `_core/time_travel/`.

Documentation is top priority for this surface. After any change under `views/time_travel/`, update this file and any affected parent docs in the same session.

## Ownership

This surface owns:

- `panel.html`: thin adapter that mounts `/mod/_core/time_travel/view.html`

## Local Contracts

### Runtime And API Contract

`panel.html` must stay a thin `<x-component>` wrapper. The admin shell mounts it from `_core/admin/views/shell/shell.html`, mirrors the routed `[id="_core/onscreen_menu/bar_start"]` inject host above admin tab content, and owns the admin-only layout overrides in `views/shell/shell.css`.

All Git-history API calls, repository discovery, diff dialogs, rollback behavior, revert behavior, and page state are owned by `_core/time_travel/`.

### UI And State Contract

The admin tab reuses the same Time Travel page body and injected Refresh or repository-picker controls as the routed `#/time_travel` page. The tab is lazy-mounted so those injected controls appear only while the Time Travel tab is active.

Do not add admin-only history state or duplicate Git-history UI here unless the admin shell truly needs a wrapper-specific mount or layout change.

## Work Guidance

### Local Work Rules

- keep this adapter thin; Time Travel behavior changes belong in `_core/time_travel/`
- update `_core/time_travel/AGENTS.md` when the shared page contract, injected controls, or Git-history workflow changes
- update this file only when the admin mount contract changes

## Verification



## Child DOX Index

- No child DOX docs.
