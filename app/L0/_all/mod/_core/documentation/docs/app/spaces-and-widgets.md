# Spaces And Widgets

This doc covers the spaces runtime because it is one of the most important agent-facing feature areas.

## Primary Sources

- `app/L0/_all/mod/_core/spaces/AGENTS.md`
- `app/L0/_all/mod/_core/spaces/empty-canvas-examples.yaml`
- `app/L0/_all/mod/_core/spaces/empty-canvas-examples.js`
- `app/L0/_all/mod/_core/spaces/ext/skills/spaces/SKILL.md`
- `app/L0/_all/mod/_core/spaces/storage.js`
- `app/L0/_all/mod/_core/spaces/store.js`

## Storage Layout

Spaces persist under the authenticated user's `~/spaces/<spaceId>/` root.

Important files:

- `space.yaml`: manifest, metadata, layout, minimized widgets, and timestamps
- `widgets/<widgetId>.yaml`: widget metadata plus the renderer source string
- `data/`: widget-owned structured files
- `assets/`: widget-owned assets fetched through `/~/...`

Important rules:

- new spaces start empty
- on first login, `_core/spaces` uses the shared `_core/login_hooks/first_login` seam to copy or reuse the bundled `_core/spaces/onboarding_space/` template, whose `space.yaml` owns the `Big Bang` title, icon, color, and onboarding instructions, then on the main `/` shell rewrites the initial route so the router lands in that space instead of the default dashboard
- while the spaces page is mounted with a current space, `view.html` exports a hidden `space:open` skill-context tag
- widget ids come from widget filenames
- the manifest should not invent fake untitled titles
- widget source is now YAML-first; old `widgets/*.js` files are migration input only
- space title and agent-instruction edits are draft-first in the sidebar and should flush on blur, panel close, route change, or unmount rather than persisting on every keystroke

## Runtime Namespaces

`_core/spaces` publishes:

- `space.current`: helpers for the currently open space
- `space.spaces`: helpers for cross-space CRUD and lower-level operations

Frequently used `space.current` helpers:

- `listWidgets()`
- `readWidget(widgetIdOrName)`
- `seeWidget(widgetIdOrName, full?)`
- `patchWidget(widgetId, { ... })`
- `renderWidget({ id, name, cols, rows, renderer })`
- `reloadWidget(widgetId)`
- `removeWidget(...)`, `removeWidgets(...)`, `removeAllWidgets()`
- `rearrange()`, `repairLayout()`, `toggleWidgets(...)`

Frequently used `space.spaces` helpers:

- `listSpaces()`
- `createSpace(...)`
- `openSpace(spaceId, options?)`
- `duplicateSpace(...)`
- `removeSpace(...)`
- `upsertWidget(...)`
- `patchWidget(...)`
- `renderWidget(...)`

## Layout Packing

Rearrange and default new-widget placement share one first-fit packer.

Rules:

- scan cells left to right, then top to bottom
- skip occupied cells immediately
- at each free cell, place the largest remaining widget that physically fits within the viewport-width threshold
- do not skip an obvious free slot just to chase a more compact aspect ratio later
- center the packed result back onto the canvas after placement

## Dashboard Launcher

The dashboard-facing spaces launcher keeps its cards visually fixed instead of using stretch-to-fill widths.

Rules:

- cards stay square at one shared size until the viewport is too narrow to hold that size
- when the current card count is still below the row capacity, that single row is centered within the launcher
- row capacity is based on fixed card size plus a required minimum horizontal gap, so narrow layouts drop columns before cards collide and full dashboard width can still host five cards when it truly fits
- once the launcher reaches the current row capacity, it uses one explicit left-to-right column stage with stretched parent slots while the cards inside those slots stay square
- wrapped remainder rows stay left-aligned and reuse the same horizontal spacing as the full row above them through that shared slot stage
- widget-name pills are capped to two visible rows inside each card
- the launcher still caps wide-screen rows at five cards

## Empty Space Canvas

When a space has no widgets yet, the routed canvas uses a slower staged onboarding sequence instead of one static placeholder.

Rules:

- keep the example-card placeholders above the text block for now, but keep them hidden until the final reveal
- load the example buttons from `_core/spaces/empty-canvas-examples.yaml` instead of a hardcoded prompt array; each entry supplies visible button text plus a JavaScript click body compiled by `_core/spaces/empty-canvas-examples.js`
- animate each onboarding text block independently instead of rewriting one existing sentence in place, and float each visible text independently so the copy does not move as one glued cluster
- phase 1 shows `Just an empty space here`
- phase 2 reveals a smaller `for now` with a visibly wider gap below the primary line and enough hold time to read both intro lines comfortably
- phase 3 reveals `Tell your agent what to create`
- phase 4 reveals a smaller `or try one of the examples above`
- phase 5 reveals the example buttons after the examples line is already visible
- keep the intro pair visible long enough to read after `for now` appears, and keep a brief gap between the intro pair fading out and the replacement pair fading in so the new lines do not appear during the old lines' exit animation
- make the copy block itself clickable so users can skip the staged sequence and jump directly to the fully revealed final state
- prompt-style example actions should call the spaces helper `sendPrompt(...)`, which routes into `space.onscreenAgent.submitExamplePrompt(...)` so default API-key blockers surface `Don't forget to configure your LLM first.` and active streaming or execution surfaces `I'm in the middle of something...` through the overlay bubble instead of silently queueing
- reduced-motion users should not be forced through the staged animation; show the stable final copy and buttons immediately

## Widget Renderer Contract

Preferred renderer shape:

```js
async (parent, currentSpace) => {
  // render into parent
}
```

Rules:

- render directly into `parent`
- do not add outer wrapper padding just to inset content; the widget shell already provides that space
- the default widget card surface is `#101b2d` (`rgba(16, 27, 45, 0.92)`); avoid another generic full-card background unless the content needs a dedicated stage
- prefer light text and UI elements by default because widget content sits on a dark surface
- use `space.utils.markdown.render(text, parent)` for markdown-heavy content
- for remote HTTP data, use plain `fetch(...)` or `space.fetchExternal(...)`; do not hardcode third-party CORS proxy services in widget renderers because the runtime already falls back to `/api/proxy`
- do not import required widget scripts, styles, fonts, or other non-data runtime assets from external CDNs in repo-owned widgets or bundled demo spaces; vendor required assets locally or use system/browser-native assets so offline app rendering still works
- return a cleanup function when listeners, timers, or similar long-lived effects are attached
- widget size is capped at `24x24`
- choose only the footprint the widget needs

The framework owns the outer card and the responsive grid. Widgets own only their content.

## Agent Workflow

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
- the first-party `spaces` skill is eligible only while the router exports `route:spaces`, and it becomes `just loaded` only while the page exports `space:open`

## When To Read More

- For the overlay execution protocol itself: `agent/prompt-and-execution.md`
- For file path and permission rules: `server/customware-layers-and-paths.md`
