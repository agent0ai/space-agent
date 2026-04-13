# AGENTS

## Purpose

`_core/spaces/` owns the main user-facing spaces canvas.

It is the routed feature module that lists spaces, opens a selected space, persists per-space manifests and per-widget YAML files under the authenticated user's app files, exposes `space.current` plus the stable `space.spaces` runtime namespace, and replays widget renderers into the framework-owned grid.

Documentation is top priority for this module. After any change under `_core/spaces/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed spaces canvas shell, the top-left current-space settings drawer, the widget-grid mount point, and the live `space:open` skill-context tag while a current space is open
- `store.js`: spaces store, route-driven loading, runtime namespace registration, current-space replay, widget-card lifecycle, empty-space multi-step onboarding choreography, current-space metadata autosave, renderer cleanup, and direct-manipulation layout interactions
- `spaces.css`: spaces shell layout, the top-left glass settings drawer, widget-grid styling, empty-space multi-step onboarding presentation, and lightweight widget fallback presentation
- `widget-content.css`: widget-body markdown and shared content presentation for rendered widget output
- `dashboard-launcher.html`, `dashboard-launcher.js`, and `dashboard-launcher.css`: dashboard-injected spaces launcher surface
- `constants.js`: stable route, filesystem, schema, and widget-size constants for this module
- `empty-canvas-examples.yaml` and `empty-canvas-examples.js`: configurable empty-canvas example definitions plus their loader and click-action helper surface
- `first-login-onboarding.js`: spaces-owned first-login onboarding helper that copies or reuses the initial Big Bang onboarding space and rewrites the main-shell landing route before router default-to-dashboard behavior runs
- `onboarding_space/`: module-owned first-login onboarding space template folder copied into the user's writable spaces area when they have no spaces yet; `space.yaml` in this folder owns the initial title, icon, color, and agent instructions
- `space-metadata.js`: shared space metadata normalization helpers and display fallbacks for untitled titles plus icon metadata
- `storage.js`: logical app-file paths, `space.yaml` and widget-YAML parsing and serialization, space CRUD helpers, legacy widget migration, widget file writes, numbered widget-definition reads plus line-edit patching for agent consumption, and public `/~/...` URL resolution
- `layout.js`: grid layout normalization, collision-safe placement, render-size resolution, and centered viewport-width first-fit packing for moving, resizing, minimizing, repairing, and rearranging widgets
- `widget-sdk-core.js` and `widget-sdk.js`: compatibility widget SDK for legacy `defineWidget(...)` modules plus shared widget-size normalization helpers
- `widget-render.js`: lightweight DOM rendering for simple widget return values such as strings, arrays, nodes, or JSON fallbacks
- `ext/html/_core/dashboard/content_middle/spaces-dashboard-launcher.html`: thin dashboard extension adapter
- `ext/js/_core/login_hooks/first_login/big-bang-space.js`: spaces-owned first-login hook extension that runs the onboarding helper through `_core/login_hooks/first_login`
- `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentSystemPromptSections/end/current-space.js`: canonical spaces-owned prompt-section injection that adds only current-space agent instructions to the onscreen agent when the routed space is open
- `ext/js/_core/onscreen_agent/execution.js/validateOnscreenAgentExecutionBlockPlan/end/widget-turn-staging.js`: spaces-owned execution-plan validator that enforces staged widget discovery and current-widget transient usage without hardcoding widget policy into `_core/onscreen_agent`
- `ext/skills/spaces/SKILL.md`: route-scoped onscreen-agent guidance for creating or updating space widgets; it is eligible only while the router exports `route:spaces`, becomes `just loaded` only while the page exports `space:open`, and owns the prompt-level spaces workflow so the base firmware prompt and current-space prompt section do not duplicate that guidance

## Persistence And Widget Contract

Spaces persist under the authenticated user's `~/spaces/<spaceId>/` root.

Current files and folders:

- `space.yaml`: canonical space manifest with `schema`, `id`, optional `title`, optional `icon`, optional `icon_color`, optional `agent_instructions`, timestamps, layout order, signed position overrides, size overrides, and minimized widget ids
- spaces should read legacy `special_instructions` values for backward compatibility, but rewrites should serialize the canonical `agent_instructions` field
- `widgets/<widgetId>.yaml`: persisted widget definition file with `schema`, `id`, `name`, default `cols`, default `rows`, optional default `col` or `row`, and a multiline `renderer` function source string
- `data/`: widget-owned structured data or downloaded files
- `assets/`: widget-owned images or other static assets referenced through `/~/...` fetch URLs
- new spaces are created empty; do not seed starter widgets into fresh manifests or widget folders
- the first-login onboarding space should stay copy-driven and easy to edit: `_core/spaces/first-login-onboarding.js` should install `_core/spaces/onboarding_space/` only when the user has no spaces yet, and on the main `/` shell it should rewrite the initial route to that copied space before the router defaults to `#/dashboard`
- `_core/spaces/onboarding_space/space.yaml` owns the initial `Big Bang` metadata and onboarding `agent_instructions`; do not hardcode that copy in JavaScript when the bundled folder can carry it instead
- the routed empty-space canvas should keep example-card placeholders above the text block for now, but hide those buttons until the onboarding sequence reaches the final step
- the empty-space onboarding copy should animate as independent text blocks with noticeable delays between steps and a slow text fade, and each visible text should float on its own instead of moving as one glued cluster: first `Just an empty space here`, then a smaller `for now` with a clearly wider gap below the primary line and enough hold time to read both intro lines before the swap, then after a brief swap gap `Tell your agent what to create`, then a smaller `or try one of the examples above` with the same wider pair spacing, then reveal the example buttons
- the empty-space copy block itself should stay clickable so users can skip the staged animation and jump straight to the fully revealed final state with the examples visible
- empty-canvas example cards should load from the module-owned `empty-canvas-examples.yaml` config, where each entry supplies the visible button text plus a JavaScript click handler body; `empty-canvas-examples.js` owns YAML parsing, code compilation, and the helper surface exposed to those handlers
- untitled spaces should stay truly untitled in storage: do not write synthetic manifest titles such as `Untitled Space` or `Untitled 2`; leave the stored title empty or omitted and let UI surfaces render the `Untitled` placeholder at display time
- when an unnamed space needs a generated folder id, allocate it from the numbered `space-1`, `space-2`, `space-3` sequence; do not derive ids from placeholder UI copy, and do not synthesize a stored title during creation
- when the first widget is added to a space whose stored title is still empty, promote that widget name into the initial persisted space title instead of leaving the space unnamed forever
- `listSpaces()` should enumerate manifests by recursively listing the authenticated user's `~/spaces/` root and selecting `spaces/<spaceId>/space.yaml`; if that root does not exist yet, treat it as the normal empty-state case instead of surfacing an error in the dashboard launcher
- `duplicateSpace(...)` should clone an existing `~/spaces/<spaceId>/` tree through the authenticated file-copy API into a new unique folder id, then rewrite only the copied manifest metadata that must change for the clone such as `id` and timestamps
- `removeSpace(...)` should delete the entire `~/spaces/<spaceId>/` tree recursively instead of trying to remove files piecemeal from the dashboard launcher
- legacy `widgets/*.js` files should be treated as migration input only; `storage.js` now converts them to widget YAML on read and removes the old module files
- `removeWidgets(...)` should rewrite `space.yaml` once, batch-delete the current widget YAML files, and still tolerate already-migrated missing legacy `widgets/*.js` paths

Current widget contract:

- the preferred authoring surface is `space.current.renderWidget({ id, name, cols, rows, renderer })`; the old `defineWidget(...)` module surface remains compatibility-only
- widget ids come from the widget filename; the manifest does not own the canonical widget registry anymore
- the widget `renderer` is stored as one function source string in widget YAML; first-party examples and skills should prefer the concise async-arrow shape shown in `ext/skills/spaces/SKILL.md`
- the framework creates the outer padded widget body plus an inner `[data-widget-body]` render target sized to the visible content box, excluding the title bar and chrome padding, and passes that inner target to `renderer(parent, space, ctx)`
- `renderer(...)` should normally render directly into `parent`; simple returned strings, arrays, nodes, or fallback objects may still be rendered by the framework, but widget primitive helper DSLs are no longer part of this module contract
- widgets that need formatted prose should prefer `space.utils.markdown.render(text, target)` so the framework-owned markdown wrapper and widget-global markdown styles stay aligned
- `renderer(...)` may optionally return a cleanup function, or `{ output, cleanup }`, so rerenders and removals can tear down listeners or timers safely
- the framework owns the outer card, the responsive grid, error states, rerender cleanup, and reload behavior, but it must not inject widget header chrome such as ids, titles, or dimension labels above widget output
- widget default size and optional default position live in the widget YAML file; the actual live layout after rearrange or resize lives in `space.yaml`
- widget size is capped at `24` columns by `24` rows; size normalization and resize interactions must clamp to that ceiling
- generated or agent-authored widgets should choose only the grid footprint they actually need rather than defaulting to oversized cards; one logical grid cell is roughly `85px` square, about `5.3rem` at a `16px` root size, so widget defaults should use a reasonable column/row count and aspect ratio for the rendered content
- generated or agent-authored widgets should treat the framework-owned card shell as the default visual container: do not add extra outer padding wrappers, do not add another generic full-card background unless the content truly needs its own stage, and prefer light foreground text or controls that read cleanly on the shell's dark space-blue surface `#101b2d` (`rgba(16, 27, 45, 0.92)`)
- widgets that fetch remote HTTP data should use runtime-managed `fetch(...)` or `space.fetchExternal(...)`; do not hardcode third-party CORS proxy services such as allorigins or corsproxy inside widget renderers, because the frontend runtime already retries blocked origins through `/api/proxy` and remembers successful proxy-needed origins for the rest of the page lifetime
- generated widget scaffolds should not inject instructional title blocks or storage-explainer copy into the visible widget output

## Runtime Namespace

`store.js` registers both `space.current` and `space.spaces`.

Current stable helpers include:

- `space.current.renderWidget(optionsOrId, cols?, rows?, renderer?)`
- `space.current.readWidget(widgetName)`
- `space.current.seeWidget(widgetName, full = false)`
- `space.current.patchWidget(widgetId, { name?, cols?, rows?, col?, row?, edits? })`
- `space.current.removeWidget(widgetId)`
- `space.current.removeWidgets(widgetIds)`
- `space.current.removeAllWidgets()`
- `space.current.reload()`
- `space.current.reloadWidget(widgetId)`
- `space.current.listWidgets()`
- `space.current.repairLayout()`
- `space.current.rearrange()`
- `space.current.rearrangeWidgets([{ id, col?, row?, cols?, rows? }, ...])`
- `space.current.saveLayout({ ... })`
- `space.current.saveMeta({ ... })`
- `space.current.toggleWidgets(widgetIds)`
- `space.current.widgets`
- `space.current.byId`
- `space.spaces.items`
- `space.spaces.all`
- `space.spaces.byId`
- `space.spaces.current`
- `space.spaces.listSpaces()`
- `space.spaces.readSpace(spaceId)`
- `space.spaces.createSpace(options?)`
- `space.spaces.duplicateSpace(spaceIdOrOptions?)`
- `space.spaces.installExampleSpace(options?)`
- `space.spaces.removeSpace(spaceId?)`
- `space.spaces.openSpace(spaceId, options?)`
- `space.spaces.reloadWidget(widgetId | { widgetId, spaceId? })`
- `space.spaces.rearrangeWidgets({ spaceId?, widgets })`
- `space.spaces.saveSpaceMeta({ id, ... })`
- `space.spaces.saveSpaceLayout({ id, widgetIds?, widgetPositions?, widgetSizes?, minimizedWidgetIds? })`
- `space.spaces.toggleWidgets({ spaceId?, widgetIds })`
- `space.spaces.upsertWidget({ spaceId?, widgetId?, name?, cols?, rows?, renderer?, source? })`
- `space.spaces.patchWidget({ spaceId?, widgetId, name?, cols?, rows?, col?, row?, edits? })`
- `space.spaces.renderWidget(optionsOrId, cols?, rows?, renderer?)`
- `space.spaces.removeWidget({ spaceId?, widgetId })`
- `space.spaces.removeWidgets({ spaceId?, widgetIds })`
- `space.spaces.removeAllWidgets(spaceId? | { spaceId? })`
- `space.spaces.reloadCurrentSpace()`
- `space.spaces.repairLayout(spaceId?)`
- `space.spaces.getCurrentSpace()`
- `space.spaces.createWidgetSource(options?)`
- `space.spaces.resolveAppUrl(logicalPath)`
- `space.spaces.createSpace(options?)` and `space.spaces.installExampleSpace(options?)` should push a new `#/spaces?id=...` history entry by default when they open the created space so browser back can still traverse prior route state; the routed spaces page's own back button is separate and should always route directly to `#/dashboard` instead of delegating to browser history, and only callers that are intentionally collapsing an intermediate route such as `#/spaces?new=1` should pass `replace: true`

Current runtime split:

- Alpine UI state lives in the `spacesPage` store exposed as `$store.spacesPage`
- current-space browser authoring should go through `space.current`
- `view.html` should expose the live `space:open` skill-context tag only when a current space is active so the shared skill loader can gate route-specific prompt skills without a separate runtime registry
- `space.current.readWidget(widgetName)` should resolve the current space's widgets by id or displayed name, build the metadata-first numbered readback with a `renderer↓` line before the numbered renderer source, log a short plain-text status line, and return that full readback directly in the framework result without touching the onscreen-agent transient `Current Widget` context
- `space.current.listWidgets()` should return a compact plain-text catalog in the form `widgets (id|name|description)↓` plus one `<id>|<name>|<description>` row per widget so agents can discover the catalog without paying JSON overhead or pulling layout internals or renderer source into conversation history
- `space.current.seeWidget(widgetName, full = false)` should inspect the currently mounted widget instance, return its live `innerHTML` in the framework result, and strip script or style tags plus event handlers and other nonessential attributes such as `class`, `style`, `id`, and `data-*` when `full` is false so the default output stays short and DOM-structure-focused
- `space.current.patchWidget(widgetId, options)` should patch only the renderer body and should accept either exact readable-renderer snippet edits in the form `edits: [{ find, replace? }]` or canonical line edits in the form `edits: [{ from, to?, content? }]` against the latest numbered source the agent saw from `readWidget(...)` or from the transient `Current Widget` envelope's `source↓` block last refreshed by `renderWidget(...)`, `patchWidget(...)`, or `reloadWidget(...)`; exact-snippet edits should match one unique renderer snippet and apply from the end of the renderer toward the start, line edits should use zero-based inclusive numbered renderer lines and also apply from the highest original line toward the lowest so inserts and deletes do not drift later edit coordinates, and direct widget metadata updates such as `name`, `cols`, `rows`, `col`, or `row` should continue to flow through explicit inputs on the patch request
- `space.current.patchWidget(widgetId, options)` should reject full-renderer replacement edits that span line `0` through the last readable renderer line; whole-widget rewrites belong to `renderWidget(...)`, not to `patchWidget(...)`
- `space.current.renderWidget(...)`, `space.current.patchWidget(...)`, `space.current.reloadWidget(...)`, `space.spaces.renderWidget(...)`, `space.spaces.upsertWidget(...)`, `space.spaces.patchWidget(...)`, and `space.spaces.reloadWidget(...)` should return only short plain-text status strings, should also emit matching `console.log(...)` or `console.error(...)` lines during execution, and should refresh the onscreen-agent transient `Current Widget` context with one envelope that carries both stripped `rendered↓` HTML and a fresh numbered `source↓` readback rather than echoing full source into normal history
- prompt-facing widget workflow should be explicitly turn-staged: when the next action depends on `listWidgets(...)`, `readWidget(...)`, `seeWidget(...)`, or a refreshed widget readback after a write, the agent should end that execution and wait for the next turn where the returned framework result or transient content is actually visible before deciding the next edit
- prompt-facing widget workflow should also be explicitly block-framed in the prepared prompt: optional example messages may appear before the live thread, the real human request arrives in a `_____user` block, framework-generated read or write follow-ups arrive in a `_____framework` block, and the latest post-write `Current Widget` envelope carrying `rendered↓` plus numbered `source↓` is emitted as its own trailing `_____transient` message
- prompt-facing widget workflow should be id-first: when `listWidgets(...)` returns a widget id, later `readWidget(...)`, `seeWidget(...)`, `patchWidget(...)`, and `reloadWidget(...)` calls should use that id as the primary target and only fall back to display-name matching if the id is unavailable
- widget writes should fail before persistence when the resulting renderer source is not valid JavaScript, so agent patches do not leave broken syntax serialized into widget YAML
- prompt-facing guidance should strongly prefer `readWidget(...)` plus `patchWidget(...)` when the user wants to modify an existing widget, should use `seeWidget(...)` when the user needs the live rendered DOM instead of source, should treat the transient `Current Widget` block as the post-write envelope where `rendered↓` is for quick visual confirmation and `source↓` is the numbered patch context, and should avoid direct file reads or full `renderWidget(...)` rewrites unless the user explicitly asks for a rewrite, the change is too broad for a clear patch, or JavaScript truly needs the raw widget file content
- `space.current.widgets` and `space.current.byId` should expose each live widget's `id`, `name`, short `description`, `state`, `position`, logical `size`, `renderedSize`, and live render health fields such as `renderStatus`, `needsRepair`, and `render.message`, but should not expose full renderer source; source inspection belongs to `readWidget(...)` results and the post-write transient `Current Widget` envelope
- `space.current.agentInstructions` should expose the live draft-backed current-space agent instructions, and `space.current.specialInstructions` should remain as a legacy alias for older prompt or widget code
- cross-space CRUD, collections, and lower-level helpers live under `space.spaces`
- caught spaces errors should be logged with `console.error(...)` before the UI shows its fallback notice
- while the routed spaces canvas is open, the spaces-owned prompt extension should inject only a `## Current Space Agent Instructions` section whenever the current space defines agent instructions; generic widget-authoring guidance belongs in the route-scoped `just loaded` `spaces` skill, and current-space metadata, widget catalogs, and widget source should be loaded on demand through runtime helpers instead of being pre-injected into the prompt
- the routed spaces page should stay canvas-only; listing spaces, creating spaces, and other management chrome belong on dashboard or overlay seams, not inside the space itself
- the routed spaces page should expose a top-left current-space settings drawer that reuses the shared topbar and menu-panel glass primitives, stays about four logical grid cells wide when collapsed, keeps the rearrange action as an adjacent icon button in that same top bar, and expands downward to the bottom viewport edge for current-space settings
- the settings drawer currently owns the editable space name plus a small icon trigger button immediately after that name field, and the space-level `Agent Instructions` textarea; title edits should stay draft-only while the name field is active and persist when editing ends through blur, Enter, drawer close, or route change, while agent instructions continue to debounce through `saveSpaceMeta(...)`; icon and color selection should open the shared `_core/visual/icons/` modal instead of embedding a large picker directly inside the drawer
- a space with zero widgets should render the centered empty-canvas prompt with the login-style floating title motion instead of injecting demo widget content, and the prompt headline should stay white, regular-weight, and keep its intended short line breaks when viewport width allows
- while a space is loading, the canvas should use the same centered floating-title treatment instead of a generic path/status card, and the loading copy should reveal itself with a slow one-second fade so fast loads do not flash it immediately
- the empty-canvas prompt should also show a muted, non-animated example grid under the floating headline so the page suggests the kinds of agent-driven spaces users can ask for
- the example grid should render from the module-owned YAML config instead of hardcoded prompt arrays, and prompt-style examples should route through the spaces helper script into `space.onscreenAgent.submitExamplePrompt(...)` rather than reaching into overlay DOM internals or queueing into an already-busy send loop; that helper should preserve the overlay's current display mode unless a mode is explicitly requested
- the persisted widget coordinate system is centered: `0,0` is the canvas origin at screen center, positions can be negative, and widget positions are saved as signed logical grid coordinates rather than viewport-relative offsets
- the visible space canvas should stay viewport-sized with no native scrollbars and should visually cover the whole routed page width; navigation outside the initial view happens through explicit background drag panning, not by turning the page into a tall scroll surface
- the spaces root may keep a local viewport-bleed fallback so the canvas still fills the screen even if an upstream routed shell wrapper remains narrower than the viewport
- grid cells should stay square; on wider screens the canvas should reveal more columns rather than stretching each column wider than its row height
- the canvas navigation model is camera-based: background dragging pans the visible window over the logical grid without resetting to keep widgets in frame, and camera movement is clamped to the current widget extent instead of allowing unbounded travel away from placed content
- the drag cursor belongs only to surfaces that actually drag: the canvas background while panning and the widget header drag strip while moving a widget; widget bodies should not inherit the canvas grab cursor so text and normal widget interactions feel native
- wheel navigation should pan the same camera in both axes using the browser-provided `WheelEvent` deltas directly, only normalizing `deltaMode` for line/page units, and should not hijack wheel input from widget-local scroll containers that can still scroll natively
- widgets can be moved by the subtle full-width top drag strip, reloaded from the left header control, resized from the bottom-right handle, minimized from the top control button, and removed from the top close button
- icon-bearing header controls such as reload and close should render with the shared `x-icon` glyph path instead of raw text characters so the control chrome stays visually aligned
- widget header controls must stay pointer-interactive above the drag strip; clicking reload, minimize, or close must not fall through into widget-move drag start
- widget cards should use one flat dark surface color rather than a gradient, and the header chrome should use that same surface color with light transparency plus a restrained blur so text never overlaps title or control icons while scrolling underneath
- the framework-owned `[data-widget-body]` render target is the scroll owner; its measured box must stay equal to the net visible content area so widgets that size themselves from `clientWidth`, `clientHeight`, or `ResizeObserver` do not count the title bar or outer chrome padding
- widget keyboard handling must not steal normal onscreen-agent chat typing through global plain-key listeners; widgets that need keyboard input should either listen only while their own DOM is focused or use modified shortcuts such as `Ctrl` or `Cmd` combinations instead of bare letters, `Space`, or bare `Enter`
- widget content should stay responsive to its own card dimensions and to later user resizes; avoid renderer layouts that depend on one fixed widget size, and prefer flexible wrapping, percentage-based sizing within the render target, and local scrolling when content outgrows the available area
- move and resize interactions should feel smooth during pointer movement, then resolve and persist onto the snapped logical grid when released; temporary grid lines should appear only during widget move or resize, not during background pan, and dragging near the viewport edge may nudge the camera slowly but must stay within the existing widget bounds
- widget titles belong in the top bar so minimized widgets remain identifiable
- the outer widget card is the only required visual container; generated widget renderers should not impose their own nested rounded card backgrounds by default unless the user explicitly asks for that extra chrome
- widget removal should delete the current widget file and tolerate a missing legacy widget-file path instead of failing the close action on already-migrated spaces
- the routed canvas top-left glass bar should expose a chevron-style back icon button on the left, the rearrange icon button in the middle, and the current space title toggle on the right; when the config drawer is open, the back and rearrange buttons should hide so the expanded drawer reads as one focused surface instead of competing with leave-space actions; the rearrange action recenters the camera at `0,0`, preserves minimized widgets, and rewrites widget positions into a centered packed layout that scans cells left to right and top to bottom, skips occupied cells immediately, and at each free cell places the largest remaining widget that physically fits within the viewport-width column threshold before moving onward without skipping that row for shape heuristics
- widgets created through `space.current.renderWidget(...)`, `space.spaces.renderWidget(...)`, or `space.spaces.upsertWidget(...)` should default into the first-fit best open slot under that same viewport-width packing rule rather than always starting at the origin or a static fallback coordinate
- full space replays, including refreshes and agent-driven widget additions, should use a short fade-in so content does not pop in abruptly

Current dashboard integration:

- `_core/dashboard/` exposes the `_core/dashboard/content_middle` seam
- `_core/spaces` injects the existing-space list, bottom footer metadata row, duplicate action, bottom-right trash-can delete action, and New Space card through that seam; the spaces section should stay above the dashboard pages section, and regular space cards should feel obviously clickable with pointer and press feedback, while the create card should stand apart with a centered larger icon, a bottom-centered label, and a restrained background glow rather than a loud gradient wash
- when the dashboard list is empty, the centered `You do not have any spaces yet.` line should reuse the same slow floating title motion language as the routed empty-space canvas, while the create button stays plain and non-heroic
- dashboard cards and other list surfaces should keep the icon in a dedicated right-side column, let long titles wrap with word breaking without breaking the row layout, keep launcher cards square at one consistent size instead of stretching them wider for sparse rows, center the row only while the current card count is still below the row capacity, cap the launcher at five columns on wide screens, keep the footer date on the same row as duplicate and delete controls, use a concise no-comma timestamp with a two-digit year, and still show the selected space icon in its stored color plus widget-name pills; row capacity should be calculated from fixed card size plus a required minimum gutter so five cards fit across the full dashboard width when that width truly supports them, and once the launcher reaches that capacity it should switch to one explicit left-to-right column stage built from stretched parent slots while the cards inside those slots stay square; wrapped remainder rows should reuse that same slot spacing from the left edge, and widget-name pills inside each card should be capped to two visible rows so the square size can stay compact; when the stored title is empty, render the `Untitled` placeholder instead of exposing the internal space id as user-facing copy
- dashboard-specific spaces UI should stay in this module, not in the dashboard owner

## Development Guidance

- keep persistence in logical app files under `~/spaces/`; do not introduce server-owned special storage for spaces
- keep `space.yaml` and widget YAML files within the lightweight YAML subset that the shipped parser can round-trip reliably, including multiline block scalars for renderer source
- keep widget-source inspection compact: when exposing widget YAML to prompt consumers, parse it first, rebuild only the useful metadata fields as plain text, dedent the `renderer` string, and number only the renderer lines from `0` so later patch edits target the exact editable surface
- keep widget patching deterministic: `patchWidget(...)` should use either unique exact snippets from the latest numbered `readWidget(...)` result or the latest transient current-widget envelope's `source↓` block refreshed by `renderWidget(...)`, `patchWidget(...)`, or `reloadWidget(...)`, should apply multi-edit patches from the bottom of the renderer upward, should not renumber later edits after inserts or deletes, should reject overlapping edits, should reject mixed snippet and line edit styles in the same call, should keep metadata updates out of renderer line patches, and should refresh transient with the fresh rendered-html-plus-source envelope after every successful patch, render, or reload
- keep prompt and skill guidance explicit about numbered widget reads: the numeric prefixes in `readWidget(...)` results and in the transient `Current Widget` envelope's `source↓` block are display-only patch targets, not source text, so agents must not derive patch ranges from whole-text array indexes and must never echo those prefixes back inside patch `content`
- keep prompt and skill guidance explicit about large widget readbacks: `readWidget(...)` intentionally returns the numbered readback in `_____framework`, while writes should keep the latest stripped `rendered↓` plus numbered `source↓` envelope in transient; use `space.api.fileRead(...)` only when JavaScript truly needs the raw widget file content
- keep spaces agent guidance failure-aware: widget source reads, rendered-html inspection, writes, and explicit reload checks should surface short plain-text status lines or direct plain-text results plus matching console output, and when a widget write or reload reports a render failure the agent should repair from the transient `Current Widget` source of truth before claiming success, not continue from stale line numbers or parse structured tool payloads
- keep spaces agent guidance explicit about staged turns: do not encourage scripts that call a discovery helper and then make a dependent mutation by reading refreshed transient data in the same execution block; discovery and dependent mutation should usually be separate turns
- keep spaces-owned staged-turn runtime enforcement in `ext/js/_core/onscreen_agent/execution.js/validateOnscreenAgentExecutionBlockPlan/end/`; if widget execution-plan policy changes, update that hook, this doc, and `ext/skills/spaces/SKILL.md` together instead of patching `_core/onscreen_agent/execution.js`
- keep spaces agent guidance explicit about plain-text helper shapes: `listWidgets()` returns flat `id|name|description` text, not JSON, so prompt guidance should tell the agent to read those visible rows literally on the next turn
- keep spaces agent guidance explicit about obvious targets: if the user already named a widget clearly, prompt guidance should tell the agent to read or patch that widget directly instead of asking which widget
- keep spaces agent guidance explicit about prepared block markers: `_____user` is the real human request, `_____framework` is runtime feedback such as execution output plus direct `readWidget(...)` or `seeWidget(...)` results, and `_____transient` is auto-injected mutable context carrying the latest post-write `Current Widget` envelope with `rendered↓` and `source↓`
- keep spaces agent guidance explicit about execution narration: each execution block should start with one short plain-text sentence before `_____javascript`; this should stay strong prompt guidance rather than a hard runtime requirement
- keep spaces agent guidance explicit about separator placement: all narration belongs before `_____javascript`; text after the separator is code and should never be used for status narration
- keep spaces agent guidance explicit about line shape: the explanatory sentence must end on its own line and `_____javascript` must appear by itself on the following line; inline forms such as `Checking widget catalog._____javascript` should fail fast as protocol errors
- keep spaces agent guidance explicit that silent execution is wrong and that a line such as `Checking the current widget source` without a following execution block is not acceptable progress
- keep spaces agent guidance explicit about stopping conditions: after a successful widget write that appears to satisfy the request, the agent should answer the user instead of continuing with speculative extra patches
- keep spaces agent guidance explicit about promise-only follow-ups: after a successful widget write, do not let the agent emit another action line such as `Updating...` or `Applying...` unless it is immediately followed by a real execution block
- keep spaces agent guidance explicit about reply shape after failures: do not let the agent fall back to raw JavaScript or fenced code outside the execution protocol
- keep syntax failures fail-fast: when a patched or rendered renderer source is not valid JavaScript, reject the write before persistence and make the error say that no files were written so agents know they are still looking at the previous widget source
- keep agent-facing outputs compact: do not return full space records from widget helpers, keep `readWidget(...)` focused on the numbered source readback only, keep `seeWidget(...)` stripped by default unless `full=true` is explicitly requested, keep post-write transient envelopes limited to stripped `rendered↓` plus numbered `source↓`, do not duplicate the full spaces skill inside the always-visible current-space prompt section, and prefer flat text catalogs such as `id|name|description` rows over JSON arrays when the model only needs a lightweight list
- keep patch-vs-rewrite boundaries explicit in prompt-facing guidance and runtime validation: `patchWidget(...)` is for bounded edits against either known numbered lines or exact readable snippets after a prior `readWidget(...)`, while `renderWidget(...)` is the only rewrite surface for replacing an entire renderer
- keep widget renderer signatures clear in repo-owned examples and generated guidance: prefer `async (parent, currentSpace) => { ... }` so the global `space` runtime is not shadowed by a renderer parameter named `space`
- keep the `just loaded` spaces skill token-budgeted: when editing `ext/skills/spaces/SKILL.md`, measure prompt tokens in the same session and prefer plain text, short labels, minimal markdown, and no filler
- keep spaces skill and supplemental docs explicit about widget-shell visual defaults: the shell already provides outer content padding, the default widget card surface is `#101b2d` (`rgba(16, 27, 45, 0.92)`), extra full-card backgrounds are opt-in, and generated widgets should use light foreground styling by default
- keep space icon metadata lightweight and display-oriented: store just the Material Symbols ligature name in `icon` and a normalized hex color in `icon_color`, and route icon or color picking through the shared `_core/visual/icons/` selector instead of duplicating catalog UI inside spaces
- keep current-space metadata persistence route-safe and draft-safe: title and agent-instruction edits should not persist on every keystroke, blur or route change should still flush pending metadata, and a completed save must not write stale server-normalized values back over newer local drafts
- keep layout normalization non-recursive for both size and position coercion so malformed or defaulted manifest values cannot blow the stack during space load
- keep manifest normalization compatible with both serialized string size tokens and in-memory widget-size objects so persisted resizes survive refreshes
- keep rearrange packing deterministic and viewport-aware: prefer greedy largest-first cell scanning within a viewport-width column threshold over a simple one-line strip, reserve two columns of horizontal headroom before treating a spread as fitting, and still return stable non-overlapping logical coordinates centered back onto the canvas
- keep the packer literal and row-stable for both rearrange and default new-widget placement: once a cell scan reaches a free slot, place the largest remaining widget that physically fits there instead of skipping that slot to chase a different aspect ratio
- keep new-widget auto-placement and rearrange on the same shared first-fit placement logic instead of duplicating separate heuristics in store and storage layers
- keep current-space external mutations smooth: when the active space replays after agent-driven widget add or remove or layout changes, prefer in-place card reconciliation with previous-rect animation and camera preservation instead of a full loading-state reset, keep untouched widget cards mounted, rerender only brand-new or edited widgets, and never rerun untouched widget renderers just because another widget moved or resized or was removed or edited
- keep spaces height on a stable viewport-sized path that does not rely on fragile percentage-height chains; do not subtract stale fixed chrome heights such as old `100dvh - 5.5rem` offsets inside `spaces.css`
- keep widget renderers isolated and replayable; use the framework-owned grid rather than storing DOM snapshots
- keep widget-wide markdown or prose presentation in `widget-content.css` so direct widget rendering and markdown helpers share one global style owner
- do not rebuild widget primitive helper DSLs here; prefer direct DOM rendering and `space.utils.markdown.render(...)`
- if the spaces runtime surface or widget workflow changes, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/app/` and `docs/agent/`
- if the routed feature contract, runtime namespace, or persisted space layout changes, update this file and `/app/AGENTS.md`
