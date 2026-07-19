# AGENTS

## Purpose

`_core/time_travel/` owns the user-facing Time Travel page for writable-layer local history.

It is a routed first-party feature module that lets the authenticated user inspect writable `L2` or managed `L1` history, filter by changed file, review file diffs, travel to another commit, and revert a commit as a new history point. The page defaults to the authenticated user's `~` history, uses a write-permission-aware repository picker before opening any other owner root, and injects its route-owned topbar controls into the shared onscreen-menu left header container.

Documentation is top priority for this module. After any change under `_core/time_travel/`, update this file and any affected parent or supplemental docs in the same session.

## Ownership

This module owns:

- `view.html`: routed Time Travel page markup, repository-picker modal markup, route-owned header-control inject markup, and Alpine bindings
- `store.js`: page-local writable-repository discovery, selected history-path state, paginated history loading, file filtering, selection preservation, timestamp formatting, diff loading, operation-preview loading, rollback calls, and revert calls
- `time-travel.css`: page-local layout and visual styling
- `ext/panels/time_travel.yaml`: dashboard panel manifest for the `#/time_travel` route
- `ext/html/_core/onscreen_menu/items/time-travel.html`: routed header-menu item adapter for the Time Travel route

## Local Contracts

### Local Contracts

- the route is `#/time_travel`
- the same `view.html` is also mounted by the admin Time Travel tab adapter at `/mod/_core/admin/views/time_travel/panel.html`
- the Time Travel action in the routed header menu is owned here through `_core/onscreen_menu/items` with `data-order="300"`
- history defaults to the authenticated user's L2 root via `space.api.gitHistoryList({ path: "~", limit, offset, fileFilter })`
- the route injects its topbar controls into `[id="_core/onscreen_menu/bar_start"]` with `x-inject`; the header keeps a text-labeled Refresh button before the folder repository button there, both controls should rely on the shared shell chrome and stay borderless or background-free unless a state-specific override is necessary, and the repository button label is always the last folder name from the selected Git path, such as the username or group id
- embedded admin use should rely on the admin shell mirroring that same `[id="_core/onscreen_menu/bar_start"]` host above tab content instead of forking a second topbar-controls contract
- the routed page header itself keeps the `Time Travel` title on the left and the descriptive subtitle on the right at wider widths, then stacks them naturally on smaller screens
- the routed page should stay flush with the shared route column and should not add extra horizontal page padding; the inner `.time-travel-shell` width clamp and panel chrome already provide the desktop inset
- the page background stays plain; do not add decorative gradient or glow backdrops behind the shell, because the panels already carry the module chrome
- the folder button opens a repository-picker dialog with the subtitle `Select Time Travel scope (git repository folder)` and calls `space.api.call("file_paths", { method: "POST", body: { patterns: ["**/.git/"], gitRepositories: true, access: "write" } })`
- repository discovery must list writable local-history owner roots such as `L1/<group>/` and `L2/<user>/` without exposing `.git` metadata paths to the browser
- selecting a repository switches `historyPath` to that app-relative owner root and reloads the first history page; `~` remains the default on fresh page load
- the commit sidebar requests one page of 100 commits at a time, should not load diff bodies during list rendering, and must tolerate `total: null` on filtered pages by relying on `hasMore` for pagination
- successful history status text should append the server-reported Git implementation as `(git: <backend>)`, using the `backend` value returned by `git_history_list`
- the file filter is open-ended and filters which commits are listed; matching commits still receive full changed-file metadata so sidebar pills and right-side details are not limited to the matching file
- list rows should emphasize human-readable relative time, place a `CURRENT` pill between relative and full time when the commit is current, and summarize changed filenames in compact outline-only action-colored pills capped to three full rows
- regular commit timeline nodes, relative time labels, and non-current selected hashes use the blue changed-file accent; only the current commit keeps the green current-time accent
- commit rows suppress the browser's native blue tap-highlight flash so click and touch feedback stays inside the module-owned hover, selection, and current-state styling
- the commit-pill overflow marker must be the first pill, and its count must include every changed file not actually rendered because of the 10-file cap or the measured three-row fit
- the selected-commit detail header should show separate outline pills for added, modified, and deleted file counts when those counts are non-zero
- changed-file detail rows should use neutral row chrome, color only the action icon, and open a colorized diff modal through `space.api.gitHistoryDiff(...)`
- the shared diff dialog must refuse to render patch bodies larger than 1 MB and should show a short explanatory notice instead, so routed and admin Time Travel reuse the same DOM-safety guard
- left and right panels should remain viewport-height bounded and scroll their own content independently so long file lists do not push pagination or actions offscreen
- travel and revert buttons open a preview dialog through `space.api.gitHistoryPreview(...)`; the dialog lists affected files and lets users open operation-specific file diffs before confirming
- travel calls `space.api.gitHistoryRollback({ path: historyPath, commitHash })` after preview confirmation
- revert calls `space.api.gitHistoryRevert({ path: historyPath, commitHash })` and creates a new history point with inverse changes rather than moving the current point
- revert conflicts in the action dialog should show a short readable summary and next-step hint by default, and keep the raw backend error available only inside an expandable technical-details block
- the backend returns `currentHash`; that commit is treated as the current point in time and should not present a rollback action
- travel must ask for explicit user confirmation in the preview modal because it hard-resets the selected writable owner root on the server
- rollback preserves the previous head in backend-owned history refs so commits after the travelled-to point remain visible for forward travel
- the backend preserves ignored auth files such as `meta/password.json` and `meta/logins.json`; the page should not claim to roll those files back
- Travel In Time and Revert Changes should stay in a shared action-button parent and render at matching widths

## Work Guidance

### Local Work Rules

- keep this page as a frontend client for the server-owned Git history API; do not add direct file-system semantics here
- keep errors visible in the page because `CUSTOMWARE_GIT_HISTORY` may be disabled at runtime
- keep page-level title copy in the routed header itself, but move ephemeral route actions such as Refresh and repository selection into the shared onscreen-menu left header container through route-owned `x-inject` markup so those controls disappear automatically when the route unmounts
- if the route, dashboard panel manifest, onscreen menu item, default `~` scope, or repository-picker contract changes, update `app/AGENTS.md` and the relevant docs under `_core/documentation/docs/`

## Verification



## Child DOX Index

- No child DOX docs.
