# AGENTS

## Purpose

`_core/admin/views/files/` owns the admin Files tab adapter.

The reusable file explorer now lives in `_core/file_explorer/`. This admin view keeps the existing admin tab mount point and delegates the actual UI, store, CSS, and file API workflow to the standalone component.

Documentation is top priority for this surface. After any change under `views/files/`, update this file and any affected parent docs in the same session.

## Ownership

This surface owns:

- `panel.html`: thin adapter that mounts `/mod/_core/file_explorer/component.html`

## Local Contracts

### Runtime And API Contract

`panel.html` must stay a thin `<x-component>` wrapper. The admin shell still mounts it from `_core/admin/views/shell/shell.html`, but all file API calls, state, dialogs, and styles are owned by `_core/file_explorer/`.

### UI And State Contract

The admin tab receives the same reusable component as the routed Files page. Do not add admin-only file browser state or styling here unless the admin shell needs a wrapper-specific layout adjustment.

## Work Guidance

### Local Work Rules

- keep this adapter thin; file-explorer changes belong in `_core/file_explorer/`
- update `_core/file_explorer/AGENTS.md` when the component API, state, route, menu item, or file API workflow changes
- update this file only when the admin mount contract changes

## Verification



## Child DOX Index

- No child DOX docs.
