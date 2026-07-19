# Spaces And Widgets

This doc covers the spaces runtime because it is one of the most important agent-facing feature areas.

## Primary Sources

- `app/L0/_all/mod/_core/spaces/AGENTS.md`
- `app/L0/_all/mod/_core/spaces/onboarding/empty-canvas.css`
- `app/L0/_all/mod/_core/spaces/onboarding/empty-canvas.js`
- `app/L0/_all/mod/_core/spaces/onboarding/empty-canvas-examples.yaml`
- `app/L0/_all/mod/_core/spaces/onboarding/empty-canvas-examples.js`
- `app/L0/_all/mod/_core/spaces/onboarding/empty-canvas-example-helpers.js`
- `app/L0/_all/mod/_core/spaces/onboarding/examples/`
- `app/L0/_all/mod/_core/spaces/onboarding/first-login-onboarding.js`
- `app/L0/_all/mod/_core/spaces/ext/skills/spaces/SKILL.md`
- `app/L0/_all/mod/_core/spaces/ext/skills/space-widgets/SKILL.md`
- `app/L0/_all/mod/_core/spaces/ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections/end/available-spaces.js`
- `app/L0/_all/mod/_core/spaces/ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections/end/current-space-widgets.js`
- `app/L0/_all/mod/_core/spaces/prompt-context.js`
- `app/L0/_all/mod/_core/spaces/storage.js`
- `app/L0/_all/mod/_core/spaces/store.js`
- `app/L0/_all/mod/_core/spaces/view.html`
- `app/L0/_all/mod/_core/spaces/spaces.css`
- `app/L0/_all/mod/_core/spaces/space-share-modal.js`

## Storage Layout

Spaces persist under the authenticated user's `~/spaces/<spaceId>/` root.

Important files:

- `space.yaml`: manifest, metadata, layout, minimized widgets, and timestamps
- `widgets/<widgetId>.yaml`: widget metadata plus the renderer source string
- `data/`: widget-owned structured files
- `assets/`: widget-owned assets fetched through `/~/...`
- `scripts/`: current-space shared JavaScript modules loaded from widget renderers through `context.import("scripts/...")`
- `thumbnail.webp` or `thumbnail.jpg`: optional experimental dashboard-card background captured from the currently open space and cropped toward the visible widget cluster

Important rules:

- new spaces start empty
- on first login, `_core/spaces` uses the shared `_core/login_hooks/first_login` seam to copy or reuse the bundled `_core/spaces/onboarding/onboarding_space/` template, whose `space.yaml` owns the `Big Bang` title, icon, color, and onboarding instructions, then on the main `/` shell rewrites the initial route so the router lands in that space instead of the default dashboard
- on the dashboard, `_core/spaces` now exposes the same create flow through both the spaces launcher and the always-available `New Space` topbar action injected through `_core/dashboard/topbar_primary`, so either entry point creates an empty space and opens it as a new route history entry
- while the spaces page is mounted with a current space, `view.html` exports hidden `space:open` and `space:id:<id>` context tags on top of the framework-owned runtime context that already exposes `runtime-browser` or `runtime-app`
- widget ids come from widget filenames
- the manifest should not invent fake untitled titles
- widget source is now YAML-first; old `widgets/*.js` files are migration input only
- `listSpaces()` should do one recursive `fileList("~/spaces/", true)` pass, then batch-read the discovered manifests plus YAML widget files together and keep a short-lived in-memory snapshot for direct-route reuse
- `readSpace(spaceId)` should reuse that fresh list snapshot when possible; otherwise it should list the widget folder once, run legacy `.js` migration against that same listing, relist only if migration changed the folder, and batch-read the manifest plus YAML widgets together instead of rediscovering widget files repeatedly
- the removable `_core/spaces/thumbnail_experiment/` helper owns the current testing path for dashboard card thumbnails; it should stay browser-only, write the thumbnail file under the space root, prefer `thumbnail.webp`, fall back to `thumbnail.jpg`, crop toward visible widget bounds instead of empty canvas, target a roughly `200x200` square image, delete stale thumbnail files when a space no longer has visible widget content to capture, and refresh thumbnails from the shared current-space post-save reload path instead of depending on onboarding-specific helper branches
- space title and agent-instruction edits are draft-first in the current-space header popover and should flush on blur, panel close, route change, or unmount rather than persisting on every keystroke
- while a current space is open, `_core/spaces` defines its Back, title-toggle, Share, Rearrange, and widget-dismiss controls directly inside the spaces route and injects them into the menu shell's existing `[id="_core/onscreen_menu/bar_start"]` container through `x-inject` instead of rendering a separate fixed in-canvas overlay; normal spaces keep the icon-only trash dismiss action and still confirm before clearing, but spaces whose current widgets all carry `metadata.example: true` swap that control to a labeled `Close example` button with a close icon that closes immediately

## Share Modal

The current-space share button opens a spaces-owned modal that keeps local import and export separate from optional hosted sharing.

Current behaviors:

- `Download ZIP` always exports the current `~/spaces/<spaceId>/` folder through the authenticated backend `folder_download` endpoint, with a `HEAD` preflight for inline errors and the real ZIP download handed off to the browser as an attachment
- `Upload ZIP` always validates through the backend import endpoint; if the current space already has meaningful content, the modal asks whether to overwrite that current space or keep it and import as a new `imported-N` space
- imported destinations ignore the incoming archive id or title for naming; non-overwrite imports are always installed as `imported-1`, `imported-2`, and so on
- when `CLOUD_SHARE_URL` resolves to a base URL, the same native spaces dialog shows the hosted-share panel first, fetches the current space ZIP from the authenticated backend `folder_download` endpoint, uploads it to that receiver, returns the share link in an inline copy field, and keeps any hosted-share errors inside that panel while logging the underlying exception to the console
- the hosted-share branch can optionally encrypt the ZIP in the browser with a password before upload, using the same public `share-crypto` helper as the public share-open page
- local ZIP export and import stay available even when hosted sharing is disabled or the remote receiver rejects uploads

## Runtime Namespaces

`_core/spaces` publishes:

- `space.current`: helpers for the currently open space
- `space.spaces`: helpers for cross-space CRUD and lower-level operations

Frequently used `space.current` helpers:

- `listWidgets()`
- `readWidget(widgetIdOrName)`
- `seeWidget(widgetIdOrName, full?)`
- `patchWidget(widgetId, { ... })`
- `renderWidget({ id, name, cols, rows, metadata?, renderer })`
- `reload(options?)`
- `reloadWidget(widgetId)`
- `reposition(options?)`
- `removeWidget(...)`, `removeWidgets(...)`, `removeAllWidgets()`
- `rearrange()`, `repairLayout()`, `toggleWidgets(...)`

Frequently used `space.spaces` helpers:

- `listSpaces()`
- `createSpace(...)`
- `openSpace(spaceId, options?)`
- `duplicateSpace(...)`
- `removeSpace(...)`
- `repositionCurrentSpace(options?)`
- `reloadCurrentSpace(options?)`
- `upsertWidget({ ..., metadata? })`
- `upsertWidgets({ widgets, ... })`
- `patchWidget(...)`
- `renderWidget(...)`
- `openShareModal(options?)`

Widget YAML rules:

- widgets may carry an optional plain-object `metadata` block in their YAML file; the browser runtime should preserve that metadata through ordinary render/upsert flows unless a caller explicitly replaces it
- `readWidget(...)` should include a compact `metadata: ...` line when metadata exists, and `space.current.widgets` should expose both the raw `metadata` object and a convenience `example` boolean
- widget renderers that show a website, search page, URL, live web page, or browser-like surface that the agent may inspect or control must embed a registered browser surface with plain `<x-browser src="google.com"></x-browser>` or create the same element through DOM APIs; `_core/web_browsing` owns id allocation, address-bar-style `src` normalization, optional `controls="true|false"` chrome, and `space.browser` exposure while `_core/spaces` only provides the normal widget render target; plain iframes are not registered browser surfaces and should be reserved for provider-specific embeds that are intentionally not agent-controllable
- the framework-owned widget render target remains the widget scroll owner; keep its measured box aligned to the visible content area and disable overscroll chaining there so hitting a widget scroll boundary does not pan the whole space

## Layout Packing

Rearrange and default new-widget placement share one first-fit packer.

Rules:

- scan cells left to right, then top to bottom
- skip occupied cells immediately
- at each free cell, place the largest remaining widget that physically fits within the viewport-width threshold
- do not skip an obvious free slot just to chase a more compact aspect ratio later
- center the packed result back onto the canvas after placement
- the routed canvas height should be measured from the live router stage and applied explicitly by the spaces store, so the widget grid does not collapse when shell-level bars above the route change height
- the viewport-sized spaces canvas should not clip its own grid; keep canvas overflow visible so camera-panned widgets can slide visually beneath the fixed routed header bar
- when a space is opened, page-reloaded into the spaces route, shown for the first time after the empty canvas, or rearranged, the camera should reset to the default occupied-span view: center the occupied cells horizontally and place the top-most occupied row on the first visible grid row below the fixed shell bar with an extra `0.5em` gap, using the live onscreen-menu bottom when available and otherwise the router's `--router-shell-start-clearance` fallback
- after that initial placement, camera panning should remain bounded only until an outer occupied row or column would leave the viewport entirely, so one occupied edge cell always stays visible instead of forcing the whole layout to stay framed; falling back to the empty canvas should still clear stale offsets before the next first-widget render
- wheel input may still pan the canvas directly on the space background, but wheel events that start inside a scrollable widget should stay with that widget even after it reaches its top, bottom, or horizontal edge

## Dashboard Launcher

The dashboard-facing spaces launcher keeps its cards visually fixed instead of using stretch-to-fill widths.

Rules:

- the launcher heading reads `Spaces` and uses the shared dashboard section-title treatment from `_core/dashboard/dashboard.css`, which centers the title, uppercases it, and adds short mirrored cool-blue gradient divider lines that brighten toward the text; the dashboard panels section should reuse that same heading so both titles align in scale and chrome
- when `listSpaces()` exposes a saved `thumbnail.webp` or `thumbnail.jpg`, the launcher should use that image as the space-card background instead of live-capturing from dashboard time, and should keep the card copy readable with a dark overlay plus a slight blur so the screenshot feels like content behind glass without losing recognizability
- cards stay square at one shared size until the viewport is too narrow to hold that size
- when the current card count is still below the row capacity, that single row is centered within the launcher
- row capacity is based on fixed card size plus a required minimum horizontal gap, so narrow layouts drop columns before cards collide and full dashboard width can still host five cards when it truly fits
- once the launcher reaches the current row capacity, it uses one explicit left-to-right column stage with stretched parent slots while the cards inside those slots stay square
- wrapped remainder rows stay left-aligned and reuse the same horizontal spacing as the full row above them through that shared slot stage
- widget-name pills are capped to two visible rows inside each card
- the launcher still caps wide-screen rows at five cards

## Empty Space Canvas

When a space has no widgets yet, the routed canvas uses a staged onboarding sequence instead of one static placeholder.

Rules:

- keep the example-card placeholders above the text block for now, but keep them hidden until the final reveal
- keep the empty-space onboarding stack starting near the top of the routed page with regular route-style top padding instead of floating around the viewport midpoint, and keep the gap between the example-button row and the CTA copy tight enough that the text reads directly beneath the examples
- keep the empty-space runtime under `_core/spaces/onboarding/`: `_core/spaces/onboarding/empty-canvas.js` owns the DOM and animation wiring, `_core/spaces/onboarding/empty-canvas.css` owns the empty-space and loading-canvas presentation, and the first-login bootstrap plus bundled onboarding space also live in that folder
- load the example buttons from `_core/spaces/onboarding/empty-canvas-examples.yaml` instead of a hardcoded prompt array; each entry supplies visible button text, may also supply a separate submitted `prompt` string for chat launches, plus icon, color, and a JavaScript click body compiled by `_core/spaces/onboarding/empty-canvas-examples.js`
- keep example-button hover and focus feedback hitbox-stable; use border, background, outline, or opacity changes instead of translate-based lift so the pointer does not slip off the button when entering from an edge
- keep that example-button catalog curated rather than exhaustive; weather should stay available through bundled presets such as `Daily News` or by asking the agent directly, not as a separate standalone top-level example card
- the top-left weather chat example should read `Create a weather report` and send a short instruction that tells the agent to get approximate location from `https://ipapi.co/json/`, avoid exact browser geolocation, fetch weather from `https://api.met.no/weatherapi/locationforecast/2.0/compact`, use the shared `pdf-report` skill to create and download a browser PDF report with report-specific structure and styling instead of a canned template, and end with a brief weather summary reply
- the center chat example should keep the visible label `Flip the space` but send `Rotate the whole page by another 180 degrees from whatever its current rotation is. Do not reset it to an absolute orientation or reuse the same fixed transform value; preserve the current rotation state and add 180 degrees with a two-second CSS transition.` so repeated launches ask for a cumulative re-flip instead of the same absolute transform
- the bottom-right chat example should keep the visible label `Check documentation` but send a prompt that tells the agent to load the top-level `documentation` skill first, then ask the user exactly `What would you like to know from the documentation?`
- animate each onboarding text block independently instead of rewriting one existing sentence in place, and float each visible text independently so the copy does not move as one glued cluster
- phase 1 shows `Just an empty space here`
- phase 2 reveals a smaller `for now` with a visibly wider gap below the primary line and enough hold time to read both intro lines comfortably
- phase 3 reveals `Tell your agent what to create`
- phase 4 reveals a smaller `or try one of the examples above`
- phase 5 reveals the example buttons after the examples line is already visible
- keep the intro pair visible long enough to read after `for now` appears, but keep the overall text sequence about 25% faster than the previous pass while preserving readability, and keep a brief gap between the intro pair fading out and the replacement pair fading in so the new lines do not appear during the old lines' exit animation
- play the full staged sequence only once for each pristine newly created empty space; if that space is opened again later, or if an existing space becomes empty after its last widget is removed, render the final examples-visible state immediately instead of replaying the early steps
- make the copy block itself clickable so users can skip the staged sequence and jump directly to the fully revealed final state
- each YAML example body runs as ordinary async JavaScript inside a tiny ES module that imports `_core/spaces/onboarding/empty-canvas-example-helpers.js` as `helpers`, so example code can use normal browser-side JavaScript plus that helper module instead of a runtime-injected helper object
- prompt-style example actions should call `helpers.submitPrompt(...)`, using `example.prompt` when the sent chat text should differ from the visible label; that helper routes into `space.onscreenAgent.submitExamplePrompt(...)` so default API-key blockers surface `Don't forget to configure your LLM first.` and active streaming or execution surfaces `I'm working on something...` through the overlay bubble instead of silently queueing
- those onboarding YAML entries should also declare `kind`, and the empty-canvas renderer should use the global Alpine `onscreenAgent` store getters to fade only the `kind: chat` buttons while the overlay is inactive, without making them unclickable
- on the default three-column empty-space layout, keep the three `kind: chat` examples in positions `1`, `5`, and `9` so the chat launchers sit on the grid diagonal; responsive narrower layouts may simply reflow that same source order
- when one of those `kind: chat` buttons is clicked while the overlay store still reports an inactive state, the empty-canvas click handler should short-circuit before the YAML body runs and call `showExamplePromptInactiveBubble()` on the same global store so the blocker bubble still appears
- example actions that should create widgets directly should copy local widget YAML bundles from `_core/spaces/onboarding/examples/` through `helpers.installOnboardingExampleWidget(...)` for one-off widgets or `helpers.installOnboardingExampleWidgets(...)` for multi-widget presets instead of referencing `dashboard_welcome/examples/...` at runtime; those helper paths should funnel widget writes through `space.spaces.upsertWidget(...)` or `space.spaces.upsertWidgets(...)`, stamp the installed widget YAML with `metadata.example: true`, and let that shared save-driven refresh carry `resetCamera: true` when copied example layouts need to open in the right place without a second visible camera jump
- the bundled `WYSIWYG Editor` example is one of those local direct-install widgets: it lives in `_core/spaces/onboarding/examples/wysiwyg-editor.yaml`, stores one title-keyed `.doc` file per document under the current space `data/word-docs/` folder through app-file APIs, makes `New File` immediately create the next unused numbered document, uses a full-row load target plus inline delete behavior in its compact stored-doc list, and uses one merged browser `PDF / Print` flow for both printing and PDF export
- the bundled `Crypto Dashboard` preset is one of those local multi-widget bundles: it keeps a copied crypto ticker plus a directly rendered one-month `BTC vs S&P 500` chart and a crypto RSS list together under `_core/spaces/onboarding/examples/crypto-dashboard/`
- that copied `BTC vs S&P 500` chart should treat non-positive upstream values as feed gaps and repair them before normalization so holiday or missing-data placeholders do not appear as real collapses to zero
- when one of those onboarding widget bundles is copied from a first-party demo widget, keep the local snapshot under `_core/spaces/onboarding/examples/`; single-widget copies should still strip source-demo placement fields such as `col` or `row` so normal placement applies, but curated multi-widget presets that intentionally recreate a demo layout should preserve copied `col`, `row`, `cols`, and `rows` values
- those local onboarding copies may also rename demo-specific widget ids or names into cleaner generic ones when the copied widget is meant to stand alone in onboarding, so a generic weather card does not keep an `iphone-...` name after it leaves the demo bundle
- when one curated onboarding preset combines multiple related widgets, keep any small shared user-owned preference files aligned across those copied widgets so feed or location changes stay coherent inside that preset
- curated onboarding presets cloned from welcome examples may also keep paired widget surfaces together, so a copied YouTube list-and-player pair should stay local to one onboarding preset folder and keep its preserved layout there
- the dashboard welcome example-space bundle should mirror the empty-canvas preset names for `Daily News`, `Crypto Dashboard`, `Retro Arcade`, and `Agent Zero Videos` so both onboarding entry points advertise the same first-party demos even though the dashboard opens whole spaces and the empty canvas installs widgets into the current space
- the bundled `Daily News` welcome space should mirror the empty-canvas preset layout too, with `News Feed` on the left, `Top News` on the top right, and `Weather` on the bottom right
- the `Daily News` weather widget in both entry flows should default to `London, England` without requesting browser geolocation until the user explicitly changes it, and its saved location should stay in Daily News-specific preference keys so other weather widgets do not change that default implicitly
- when a caller intentionally batches several onboarding widget writes into the current space, metadata saves may still use `refresh: false`, but the preset helper should persist the widget bundle through one storage-level batched write and then issue one final `reloadCurrentSpace({ resetCamera: true })` pass so widget renderers start together instead of waiting behind several sequential widget saves
- compact onboarding article-detail cards should prefer making the image and headline themselves open the article, and should avoid redundant header labels or separate open buttons when that vertical space is better spent on summary text; related compact news cards, including the Daily News top-headline widget, should also rely on the widget shell's built-in reload control instead of adding duplicate in-card refresh buttons, and that manual reload control should rerun the widget without mutating the onscreen-agent `Current Widget` transient state
- if one of those onboarding widget bundles relies on YouTube embedding, prefer copying the proven `_core/dashboard_welcome/examples/agent-zero-videos/widgets/yt-video-player.yaml` loading pattern into the local onboarding copy and only swap the initial video id or feed source
- example button icon ligatures and accent colors should also come from that onboarding YAML so chat actions and bundled widget-clone actions can present different button chrome without hardcoded per-example styling in JS
- the same imported helper module also exposes direct runtime access through `helpers.getSpaceRuntime()`, `helpers.getSpacesRuntime()`, `helpers.getOnscreenAgentRuntime()`, and `helpers.repositionCurrentSpace()` for future non-prompt examples
- the one-time empty-space onboarding marker is client-owned browser UI state stored per user under `space.spaces.emptyCanvasSeen.<username>` with `sessionStorage` and `localStorage` mirrors; it is not part of persisted `space.yaml`
- reduced-motion users should not be forced through the staged animation; show the stable final copy and buttons immediately

## Widget Renderer Contract

Preferred renderer shape:

```js
async (parent, currentSpace, context) => {
  // render into parent
}
```

Rules:

- render directly into `parent`
- `context.paths` includes `root`, `data`, `assets`, `scripts`, and `widget` for the current space
- `context.import("scripts/utils.js")` loads a current-space module without hardcoded space ids or titles
- if several widgets need shared state or a common event bus or other global space behavior, import the same `scripts/...` module from each widget
- for very large or complex widgets, keep the renderer thin and move substantial logic into `scripts/*.js` modules
- if imported modules need widget helpers or state, export functions that receive `context` instead of hardcoding widget ids or space paths
- do not add outer wrapper padding just to inset content; the widget shell already provides that space
- the default widget card surface is `#101b2d` (`rgba(16, 27, 45, 0.92)`); avoid another generic full-card background unless the content needs a dedicated stage
- prefer light text and UI elements by default because widget content sits on a dark surface
- widget replay should evaluate renderer source through a named virtual `space-widget-...renderer.js` script so DevTools and console errors link back to widget lines instead of `index.html`; keep the wrapper minimal so the displayed line numbers stay close to the stored renderer source
- for website, search, URL, live-page, or browser-like widget surfaces that the agent may need to inspect or control, use `<x-browser src="google.com"></x-browser>` rather than an iframe so the surface registers with `space.browser` and supports injected browser actions
- repo-owned YouTube iframe widgets should set `iframe.referrerPolicy = "strict-origin-when-cross-origin"` so embedded playback keeps the referrer YouTube now expects
- repo-owned YouTube widgets that need to react when playback ends should use the official IFrame API state-change events with `enablejsapi=1` and the current `origin`, and should use `ctx.widget.id` plus `ctx.space.id` for self-removal instead of hardcoded widget ids
- use `space.utils.markdown.render(text, parent)` for markdown-heavy content
- for remote HTTP data, use plain `fetch(...)` or `space.fetchExternal(...)`; do not hardcode third-party CORS proxy services in widget renderers because the runtime already falls back to `/api/proxy`
- do not import required widget scripts, styles, fonts, or other non-data runtime assets from external CDNs in repo-owned widgets or bundled demo spaces; vendor required assets locally or use system/browser-native assets so offline app rendering still works
- return a cleanup function when listeners, timers, or similar long-lived effects are attached
- widget size is capped at `24x24`
- choose only the footprint the widget needs

The framework owns the outer card and the responsive grid. Widgets own only their content.

## Agent Workflow

The spaces runtime now splits always-on space-management guidance from in-space widget guidance.

Prompt context:

- the top-level `spaces` skill auto-loads always and covers opening, creating, removing, and editing spaces
- the top-level `space-widgets` skill auto-loads only while the page also exports `space:open` and covers current-space widget authoring
- the spaces module also appends an `Available Spaces` transient section with compact `id|title` rows on every prompt build
- when a current space is open, the route appends `Current Space Widgets` with compact `id|name|col|row|cols|rows|state|render status` rows
- after widget writes or reloads, the runtime still appends `Current Widget` as the last edited widget envelope with `rendered↓` and `source↓`

The spaces runtime is designed around staged turns.

Normal flow:

1. `listWidgets()` if the live catalog is unknown
2. `readWidget(...)` to load the latest numbered renderer readback
3. on the next turn, `patchWidget(...)` for bounded edits or `renderWidget(...)` for a rewrite
4. `reloadWidget(...)` or another read on a later turn if needed

Important protocol rules:

- `readWidget(...)` and `listWidgets()` are discovery steps
- the next dependent mutation should usually happen on the next turn, not in the same execution block
- `readWidget(...)` returns numbered renderer lines for patch targeting
- those numeric prefixes are display-only targets, not source text
- prompt-side readbacks land in `_____framework` or `_____transient`
- the first-party `spaces` skill is eligible and auto-loaded unconditionally, while the first-party `space-widgets` skill is eligible and auto-loaded only while the page exports `space:open`

## When To Read More

- For the overlay execution protocol itself: `agent/prompt-and-execution.md`
- For file path and permission rules: `server/customware-layers-and-paths.md`
