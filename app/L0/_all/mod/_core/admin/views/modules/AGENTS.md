# AGENTS

## Purpose

`_core/admin/views/modules/` owns the firmware-backed modules panel.

It lists installed modules, filters them by area and search text, opens repository remotes when available, and removes writable modules through the authenticated module APIs.

Documentation is top priority for this surface. After any change under `views/modules/`, update this file and any affected parent docs in the same session.

## Ownership

This surface owns:

- `panel.html`: module-list UI
- `store.js`: area selection, debounced search, module loading, repository links, and module removal

## Local Contracts

### Module API Contract

Current API usage:

- list data comes from `space.api.call("module_list", ...)`
- removal uses `space.api.call("module_remove", ...)`
- repository links are derived client-side from the returned Git remote URL

Current UI areas:

- `l2_self` by default
- `l1`
- admin-only aggregated `l2_users`

Current behaviors:

- destructive actions are enabled only when the server says `canWrite`
- aggregated rows are not removable
- repository actions are enabled only when a browser-safe remote URL can be derived
- file-browser actions are intentionally disabled and point the user to the Files tab instead

## Work Guidance

### Local Work Rules

- keep permissions and visibility server-authoritative; use returned flags such as `canWrite`
- keep search and area changes centralized in `store.js`
- do not bolt unrelated module-management workflows into this panel unless the module API contract supports them cleanly
- if `module_list` or `module_remove` semantics change, update this file and the relevant server docs in the same session

## Verification



## Child DOX Index

- No child DOX docs.
