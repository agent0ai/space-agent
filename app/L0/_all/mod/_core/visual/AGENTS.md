# AGENTS

## Purpose

`_core/visual/` owns the shared Space Agent visual system.

It provides the reusable canvas, chrome, buttons, dialogs, cards, and conversation rendering primitives that feature modules compose on top of. It should own shared presentation logic, not feature-specific state or workflows.

Documentation is top priority for this module. After any change under `_core/visual/`, update this file and any affected parent docs in the same session.

## Ownership

Current sub-areas:

- `index.css`: shared visual aggregator that imports the reusable layers
- `canvas/`: authenticated shared backdrop CSS and JS runtimes
- `chrome/`: topbar, popover, toast, and light chrome behavior
- `icons/`: shared Material Symbols catalog helpers plus reusable icon-selection modal UI and runtime
- `actions/`: shared button and attachment-chip styling
- `forms/`: native dialog styling and helpers
- `conversation/`: shared agent-thread rendering helpers
- `surfaces/`: shared panel and card treatments

## Current Contracts

Canvas:

- `canvas/space-canvas.css` owns the DOM-backed space backdrop visuals for authenticated surfaces
- `canvas/space-canvas.css` keeps both the base canvas gradient and the star or glow scene on fixed viewport layers so routed surface scrolling never drags the backdrop
- `canvas/spaceBackdropCore.js` owns the shared backdrop runtime, including resize-safe scale resync that forces `--space-backdrop-scale` back to `1`
- `canvas/spaceBackdropStatic.js` installs the static authenticated backdrop and registers `space.visual.installStaticBackdrop(...)`
- `canvas/spaceBackdropAnimated.js` installs the animated variant and registers `space.visual.installAnimatedBackdrop(...)`
- `canvas/spaceBackdrop.js` re-exports the animated variant as the generic backdrop installer

Chrome:

- `chrome/topbar.css` owns the shared glass topbar and menu-panel contract used by routed menus and admin tabs
- `chrome/popover.css` plus `chrome/popover.js` own the shared fixed-position dropdown or overflow-menu positioning contract; auto placement should flip upward once available bottom space drops below `2.2x` the measured panel height and top space is larger, so row menus avoid cramped bottom-edge inner scrolling
- `chrome/toast.css` plus `chrome/toast.js` own the shared fixed-position toast stack and register `space.visual.showToast(message, options)`

Icons:

- `icons/material-symbols.txt` plus `icons/material-symbols.js` own the shipped Material Symbols ligature catalog and normalized icon-name or hex-color helpers shared by feature modules
- `icons/icon-color-selector-modal.html`, `icons/icon-color-selector.css`, and `icons/icon-color-selector.js` own the reusable icon-selection modal and register `space.visual.openIconColorSelector(options)` once that module is imported
- `space.visual.openIconColorSelector(options)` should open through the framework modal shell, await close, and resolve with either `null` for cancel or an `{ icon, color }` selection payload
- the shared selector should support search, pagination, icon color, reset-to-default values supplied by the caller, and optional `allowNone` behavior without embedding feature-specific storage rules into the visual layer; its default page size is `100` icons unless a caller overrides `pageSize`
- selector option cells should keep wrapped two-line icon labels legible without clipping descenders, use a larger direct glyph instead of a nested inner chip, keep prev/next as compact icon-only controls beside the pagination label, and leave a small visual gap above the footer action row

Actions and forms:

- `actions/buttons.css` owns shared `primary-button`, `secondary-button`, and `confirm-button` treatments plus composer-attachment chip styling
- `forms/dialog.css` plus `forms/dialog.js` own the shared native `<dialog>` presentation and open or close helpers
- `forms/dialog.css` also owns the reusable fixed-chrome dialog shell classes for long modals: `dialog-card-shell` keeps the header and footer static, `dialog-scroll-body` and `dialog-scroll-frame` own the interior scrolling region, and `dialog-actions-split` plus `dialog-actions-group` and `dialog-action-button-fixed` cover compact split footer rows without feature-local inline layout
- modal-scoped button chrome belongs in `forms/dialog.css`, not in feature-local styles: dialogs should use the tighter admin-style geometry with compact 10px radii, no oversized pill buttons, transparent secondary actions, and flatter primary or confirm actions without the large shared button shadows

Conversation and surfaces:

- `conversation/thread-view.js` exports `createAgentThreadView(config)` and is the shared renderer used by the admin agent and onscreen agent
- `conversation/thread-view.js` must patch streaming assistant rows in place when possible, including streamed execution cards, so expanded execution details stay interactive instead of losing DOM state on every delta; ordinary shared-thread rerenders must also reconcile against existing keyed rows instead of clearing and rebuilding the full history; completed execution rows must stay isolated from later assistant turns so a new streamed reply only updates the live row; thread scroll should keep following while the user remains near the bottom and should decouple only after the user has scrolled up; once an execution card is mounted, settled narration and other stable subtrees should not be recreated on each streamed token; and single-paragraph execution narration should collapse to one message block instead of keeping an extra markdown wrapper around a lone `<p>`
- `conversation/thread-view.js` supports an opt-in chat-bubble markdown mode through `config.renderMarkdownWithMarked`; that mode routes settled non-streaming assistant and user bubbles through the shared framework markdown helper, escapes raw HTML before parsing, strips unsafe markdown link or image URLs after render, wraps rendered tables in `.message-markdown-table-wrap`, removes empty generated table headers, and lets the owning feature attach a local assistant markdown class through `config.assistantMarkdownClassName`
- `conversation/thread-view.js` also supports opt-in avatar run grouping through `config.groupConsecutiveAvatars`; when enabled, only the first consecutive rendered row for the same visible speaker should mount the real avatar and later rows in that run should keep the same bubble alignment with a non-visible spacer instead of re-rendering the icon or image
- `conversation/agent-thread.css` owns the baseline bubble sizing, avatar spacer, and wrapping rules for shared threads; user bubbles must keep natural compact width for short drafts but still wrap long lines inside the bubble so chat scrollers do not widen or grow horizontal scrollbars, and execution narration should sit visually tight to its execution card instead of reading like a separate later reply; execute sections may use tighter local spacing than follow-up sections to preserve that coupling
- `surfaces/cards.css` owns shared panel or card wrappers such as `space-panel`

## Visual System Rules

- solve shared presentation problems here before cloning styles into feature modules
- keep the overall direction calm, dark, and readable rather than loud or novelty-driven
- avoid putting feature logic, API calls, or store state into this module
- when a modal needs persistent action rows, scroll the inner body or framed content area through the shared dialog shell helpers instead of putting overflow on the full dialog card
- when a primitive is only used by one feature, keep it local until reuse is real
- keep reusable selection modals generic: the visual layer may own search, pagination, preview, and return-value flow, but feature-specific metadata semantics stay in the calling module
- when changing the shared backdrop system, also review the mirrored public-shell copies in `server/pages/res/space-backdrop.css` and `server/pages/res/space-backdrop.js`

## Development Guidance

- prefer semantic tokens from `_core/framework/css/colors.css`
- prefer composing existing visual primitives over inventing near-duplicates
- keep the baseline bubble markdown layout in `_core/visual/conversation/agent-thread.css`; add only feature-specific markdown tuning in the owning surface stylesheet
- if a feature needs new shared chrome or surface behavior, add the smallest reusable primitive here and keep feature orchestration in the owning module
- if a visual change affects app-wide direction, update `/app/AGENTS.md`; if it affects pre-auth mirrored shells, update `server/pages/AGENTS.md` too
