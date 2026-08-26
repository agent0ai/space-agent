# AGENTS

## Purpose

`_core/onscreen_menu/` owns the viewport-fixed routed header bar, page menu, and Home shortcut.

It is a thin shell extension that mounts into the router shell, pins itself to the top of the viewport without taking routed layout height, keeps menu-owned Home and menu buttons on the right, exposes `_core/onscreen_menu/bar_start` and `_core/onscreen_menu/bar_end` HTML extension seams for shell-level controls, exposes `_core/onscreen_menu/items` inside the dropdown panel for feature-owned menu actions, and keeps only the auth exit action local after that seam.

Documentation is top priority for this module. After any change under `_core/onscreen_menu/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/html/_core/router/shell_start/menu.html`: thin shell-start extension that declares the viewport-fixed header bar, Home and menu buttons, the left and right header seams, the dropdown item seam, and the local auth exit action
- `onscreen-menu.css`: menu-specific styling layered on the shared topbar primitives

Feature-owned menu item extensions do not belong in this module. Current first-party item adapters live in `_core/agent`, `_core/user`, `_core/time_travel`, `_core/file_explorer`, and `_core/admin`.

## Local Contracts

### Current Contract

Current behavior:

- the menu mounts through `_core/router/shell_start`
- the menu is pinned to the top of the viewport instead of joining document scroll, so routed content can scroll underneath it
- the centered bar sits flush to the top of the viewport, stretches to the module-owned fixed shell width instead of shrinking to current content width, keeps only the bottom corners rounded, carries any safe-area top inset inside the shell surface itself, and should not reserve layout height in the routed page flow
- the menu shell width clamp is module-owned through the router-page custom property `--onscreen-menu-shell-max-width`, currently `56rem` by default and `48rem` at `860px` and below; routed surfaces that must visually align to the overlay bar, such as `_core/dashboard`, should reuse that same property instead of introducing a second max-width
- the router owns the fixed `--router-shell-start-clearance` inset used by standard routed pages, while this menu stays purely viewport-fixed chrome
- the shell height should stay visually stable as the bar transitions between its max-width clamp and narrower viewport widths; keep one shared shell height instead of a wider-layout and narrower-layout split, and do not couple top or bottom padding to width-driven clamps
- the shell should stay vertically compact and space-economic rather than hero-sized, and it should read as translucent glass: softened gradients, strong visible transparency, only a very light backdrop blur instead of a heavy frosted slab, no top edge border line, and only a restrained bottom edge line or reflection treatment
- the Home button is always visible on the right side of the bar beside the menu button
- the Home button routes to the empty router path `#/` so the router's default-route contract, currently Dashboard, decides the actual home screen
- `_core/onscreen_menu/bar_start` renders on the left side of the header bar for shell-level buttons or icons
- route-owned `x-inject` content may target the existing left-side `[id="_core/onscreen_menu/bar_start"]` container when a feature needs ephemeral controls that should be destroyed with the route instead of staying mounted as a shell extension, and when that header target may not exist yet at the moment the route boots
- a routed feature may inject one local wrapper into `[id="_core/onscreen_menu/bar_start"]` and expose additional feature-owned seams inside that wrapper; `_core/dashboard` uses that pattern for dashboard-only topbar controls so the shell still stays route-agnostic
- `_core/onscreen_menu/bar_end` renders on the right side of the header bar before Home for shell-level buttons or icons
- `_core/onscreen_menu/bar_start` and `_core/onscreen_menu/bar_end` both sort contributed extension wrappers by the first descendant `data-order` or `order` value they find
- header-bar extensions should render shared `space-topbar-button` controls when they want to match the shell chrome, but route-owned injected controls should usually stay visually bare against the bar itself instead of adding extra per-button borders or backgrounds
- `_core/onscreen_menu/items` is rendered inside the menu panel before the local auth exit action
- item adapters should be thin HTML extension files that render shared `space-topbar-menu-action` buttons
- item buttons should set numeric `data-order` values, usually spaced by hundreds, because the menu shell sorts contributed extension wrappers by the first descendant `data-order` or `order` value it finds
- route item adapters call the menu-provided `openRoute(routeHash)` helper with their owning route
- `openRoute(routeHash)` keeps iframe-local routed navigation inside the `/admin` split-view iframe and otherwise prefers `window.top` with a current-window fallback
- the Agent item is contributed by `_core/agent` with `data-order="100"`
- the User item is contributed by `_core/user` with `data-order="150"`
- the Files item is contributed by `_core/file_explorer` with `data-order="200"`
- the Time Travel item is contributed by `_core/time_travel` with `data-order="300"`
- the Admin item is contributed by `_core/admin` with `data-order="400"` and owns the `/admin?url=<current-path-search-hash>` handoff
- the local auth exit action is rendered after `_core/onscreen_menu/items`
- when frontend config reports `SINGLE_USER_APP=true`, the local auth exit action is labeled Leave, clears the current tab's launcher-access grant, and navigates to `/enter`
- otherwise, the local auth exit action is labeled Logout, clears the current `space.utils.userCrypto` browser cache before navigation, and then navigates to `/logout`

## Work Guidance

### Local Work Rules

- keep this module thin; it should stay a routed shell affordance, not a second app shell
- prefer shared topbar and menu styles from `_core/visual/chrome/topbar.css`
- keep Home pointed at the empty route instead of hardcoding `#/dashboard`, so the router can change its default home without menu changes
- add shell-level header buttons from the owning feature module through `_core/onscreen_menu/bar_start` or `_core/onscreen_menu/bar_end` instead of hardcoding them in `menu.html`
- add route-owned, ephemeral header controls by injecting into `[id="_core/onscreen_menu/bar_start"]` with `x-inject` from the owning route, not by mounting a persistent shell extension and hiding it with route checks
- when one routed page needs multiple independently owned header buttons, keep the injected wrapper route-owned and let that route expose local seams inside it rather than teaching `menu.html` about feature-specific controls
- add feature menu entries from the owning feature module through `_core/onscreen_menu/items` instead of hardcoding them in `menu.html`
- pick `data-order` values with gaps so downstream modules can insert actions between first-party items without replacing them
- if the header seams, route inject target behavior, item seam, router shell seam, route helper behavior, or auth exit behavior changes, update this file and any owning feature docs that rely on that contract

## Verification



## Child DOX Index

- No child DOX docs.
