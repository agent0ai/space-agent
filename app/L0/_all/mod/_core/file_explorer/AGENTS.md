# AGENTS

## Purpose

`_core/file_explorer/` owns the first-party app file explorer.

It is a standalone frontend module for browsing, selecting, creating, editing, copying, moving, deleting, renaming, and downloading app-rooted files through the authenticated file APIs. The admin Files tab mounts this same component as an adapter instead of owning the implementation.

Documentation is top priority for this module. After any change under `_core/file_explorer/`, update this file, affected parent docs, and relevant supplemental docs under `_core/documentation/docs/` in the same session.

## Ownership

This module owns:

- `component.html`: reusable file-explorer component mounted by the routed page and admin adapter
- `view.html`: routed `#/file_explorer` page that embeds `component.html`
- `store.js`: navigation, selection, clipboard, dialogs, path memory, and file API orchestration
- `file-explorer.css`: component and routed-page layout on top of shared visual primitives
- `ext/panels/file_explorer.yaml`: dashboard panel manifest for the routed Files page
- `ext/html/_core/onscreen_menu/items/file-explorer.html`: routed header-menu item adapter for the Files route

## Local Contracts

### Runtime And API Contract

This module talks to the shared server file APIs through `space.api`.

Current behavior:

- the route is `#/file_explorer`
- the routed header-menu action is owned here through `_core/onscreen_menu/items` with `data-order="200"`
- the starting path is the authenticated user's home path `~/`
- paths are app-rooted and may use `~` shorthand where supported
- directory listing uses `space.api.fileList(...)`
- metadata checks use `space.api.fileInfo(...)`
- text reads and writes use `space.api.fileRead(...)` and `space.api.fileWrite(...)`
- new files are created through `space.api.fileWrite(path, "", "utf8")`
- new folders are created through `space.api.fileWrite(pathWithTrailingSlash, "", "utf8")`
- delete, copy, and move actions use the corresponding `space.api` helpers
- files still download through direct authenticated app fetches
- single-folder downloads use `space.api.folderDownloadUrl(...)`, which targets the streamed `/api/folder_download` ZIP attachment endpoint
- downloads preflight backend access before the browser transfer starts, and failures surface through the shared visual toast primitive

Current editor rule:

- text editing is refused for files larger than `1 MB` based on `fileInfo(...)` metadata before the editor dialog opens

### UI And State Contract

`store.js` owns:

- editable current-path navigation
- Up, Home, Refresh, New file, and New folder actions
- highlighted entry, selection, and per-directory scroll memory
- double-click opens folders by navigating into them and opens files in the text editor dialog
- row-level overflow actions through the shared popover contract
- selection-summary actions when one or more paths are checked, including a `Select All` header action for the current folder
- clipboard state for cut or copied items plus paste into the current folder
- shared dialogs for create, rename, delete confirmation, and text editing
- file and folder download actions, with folders routed through the server ZIP endpoint
- inline reporting for not-found and permission errors
- routed-page and list-row sizing clamps the explorer to its route column with `min-width: 0`, `max-width: 100%`, `overflow: hidden`, and border-box sizing on the internal card, list, and rows so padding or borders cannot create horizontal scroll
- the routed `view.html` wrapper should stay flush with the shared route column and should not add extra horizontal padding around the reusable explorer card

## Work Guidance

### Local Work Rules

- keep file-explorer workflow logic centralized in `store.js`
- keep admin-specific shell behavior in `_core/admin/views/files/`; this module should stay reusable outside `/admin`
- use shared visual primitives for buttons, popovers, cards, and dialogs instead of creating a feature-only theme
- keep layout overflow fixes inside this reusable module instead of relying on the admin shell to hide route-page sizing issues
- keep server permission rules authoritative; do not duplicate them in the browser beyond UI affordances
- if you change file-API expectations, update this file and the relevant server docs in the same session

## Verification



## Child DOX Index

- No child DOX docs.
