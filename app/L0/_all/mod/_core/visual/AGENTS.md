# AGENTS

## Purpose

`_core/visual/` owns the shared Space Agent visual system.

It provides the reusable canvas, chrome, buttons, dialogs, cards, conversation rendering primitives, and shared authenticated-app visual assets that feature modules compose on top of. It should own shared presentation logic and reusable artwork, not feature-specific state or workflows.

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
- `res/`: canonical shared image assets for authenticated app surfaces

## Local Contracts

### Current Contracts

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
- selector option cells should keep wrapped two-line icon labels legible without clipping descenders, use a larger direct glyph instead of a nested inner chip, keep prev/next as compact icon-only controls beside the pagination label, leave a small visual gap above the footer action row, and keep hover, focus, and selected-state feedback hitbox-stable instead of translating the option cell

Actions and forms:

- `actions/buttons.css` owns shared `primary-button`, `secondary-button`, and `confirm-button` treatments plus composer-attachment chip styling
- `forms/dialog.css` plus `forms/dialog.js` own the shared native `<dialog>` presentation and open or close helpers
- `forms/dialog.css` also owns reusable prompt-budget field styling for dialog-based model settings, including the segmented preview bar plus the multi-slider control grid used by the first-party agent surfaces
- authenticated app feature dialogs are standardized on feature-owned native `<dialog class="chat-dialog">` markup that lives in the owning feature HTML, opens through `forms/dialog.js`, and composes `dialog-card` or `dialog-card-shell` content wrappers from `forms/dialog.css`
- `forms/dialog.css` also owns the reusable fixed-chrome dialog shell classes for long modals: `dialog-card-shell` keeps the header and footer static, `dialog-scroll-body` and `dialog-scroll-frame` own the interior scrolling region, and `dialog-actions-split` plus `dialog-actions-group` and `dialog-action-button-fixed` cover compact split footer rows without feature-local inline layout
- the framework modal shell in `_core/framework/js/modals.js` is reserved for generic separately loaded modal documents or shared utilities such as icon selectors that genuinely need that wrapper; it is not the default chrome path for first-party feature dialogs
- modal-scoped button chrome belongs in `forms/dialog.css`, not in feature-local styles: dialogs should use the tighter admin-style geometry with compact 10px radii, no oversized pill buttons, transparent secondary actions, and flatter primary or confirm actions without any painted shadow treatment

Resources:

- `res/` is the canonical home for reusable authenticated-app artwork such as the overlay chat astronaut, admin chat avatars, shared placeholder helmets, and staged engineer variants that are not yet wired into runtime UI
- repo-owned authenticated app modules should reference shared images from `/mod/_core/visual/res/...` instead of keeping image files in feature-local module folders
- public or pre-auth shells that live outside the authenticated app module tree, including `/login` and `/enter`, keep their own mirrored astronaut asset under `server/pages/res/`

Conversation and surfaces:

- `conversation/thread-view.js` exports `createAgentThreadView(config)` and is the shared renderer used by the admin agent and onscreen agent
- `conversation/thread-view.js` must patch streaming assistant rows in place when possible, including streamed execution cards, so expanded execution details stay interactive instead of losing DOM state on every delta; ordinary shared-thread rerenders must also reconcile against existing keyed rows instead of clearing and rebuilding the full history; completed execution rows must stay isolated from later assistant turns so a new streamed reply only updates the live row; thread scroll should keep following while the user remains near the bottom and should decouple only after the user has scrolled up; once an execution card is mounted, settled narration and other stable subtrees should not be recreated on each streamed token; and single-paragraph execution narration should collapse to one message block instead of keeping an extra markdown wrapper around a lone `<p>`
- `conversation/thread-view.js` also owns the shared execution-card terminal-line parsing contract; execution transcript headers may arrive in legacy inline form such as `warn: ...` or in block-label form such as `log↓`, `warn↓`, `error↓`, and `result↓`, and the shared line-modifier logic must keep those headings styled consistently for both admin and overlay cards
- `conversation/thread-view.js` supports an opt-in chat-bubble markdown mode through `config.renderMarkdownWithMarked`; that mode routes settled non-streaming assistant bubbles through the shared framework markdown helper while keeping submitted user bubbles on plain pre-wrapped text so typed blank-line spacing stays literal, escapes raw HTML before parsing, strips unsafe markdown link or image URLs after render, wraps rendered tables in `.message-markdown-table-wrap`, removes empty generated table headers, and lets the owning feature attach a local assistant markdown class through `config.assistantMarkdownClassName`
- `conversation/agent-thread.css` keeps plain-text bubbles on `white-space: pre-wrap`, resets rendered markdown bubbles back to normal white-space so parser formatting newlines between tags do not render as visible blank lines, and collapses top and bottom margins on direct list-item child blocks inside markdown bubbles so loose markdown lists do not render blank-line-sized gaps between bullets in shared agent history
- `conversation/thread-view.js` also supports opt-in avatar run grouping through `config.groupConsecutiveAvatars`; when enabled, only the first consecutive rendered row for the same visible speaker should mount the real avatar and later rows in that run should keep the same bubble alignment with a non-visible spacer instead of re-rendering the icon or image
- `conversation/agent-thread.css` owns the baseline bubble sizing, avatar spacer, and wrapping rules for shared threads; user bubbles must keep natural compact width for short drafts but still wrap long lines inside the bubble so chat scrollers do not widen or grow horizontal scrollbars, and execution narration should sit visually tight to its execution card instead of reading like a separate later reply; execute sections may use tighter local spacing than follow-up sections to preserve that coupling
- `surfaces/cards.css` owns shared panel or card wrappers such as `space-panel`

### Visual System Rules

- solve shared presentation problems here before cloning styles into feature modules
- keep the overall direction calm, dark, and readable rather than loud or novelty-driven
- keep shared interactive hover and focus emphasis hitbox-stable: prefer border, background, outline, or opacity changes over translate or position shifts that move the clickable box
- first-party glass surfaces in this module stay shadowless: do not use box-shadow, text-shadow, or drop-shadow for depth; rely on blur, borders, gradients, and contrast instead
- avoid putting feature logic, API calls, or store state into this module
- when a feature needs a dialog, default to the shared native `<dialog class="chat-dialog">` pattern documented here; only update the visual system itself when that pattern must change for everyone
- when a modal needs persistent action rows, scroll the inner body or framed content area through the shared dialog shell helpers instead of putting overflow on the full dialog card
- when a primitive is only used by one feature, keep it local until reuse is real
- keep reusable selection modals generic: the visual layer may own search, pagination, preview, and return-value flow, but feature-specific metadata semantics stay in the calling module
- when changing the shared backdrop system, also review the mirrored public-shell copies in `server/pages/res/space-backdrop.css` and `server/pages/res/space-backdrop.js`

## Work Guidance

### Local Work Rules

- prefer semantic tokens from `_core/framework/css/colors.css`
- prefer composing existing visual primitives over inventing near-duplicates
- keep the baseline bubble markdown layout in `_core/visual/conversation/agent-thread.css`; add only feature-specific markdown tuning in the owning surface stylesheet
- if a feature needs new shared chrome or surface behavior, add the smallest reusable primitive here and keep feature orchestration in the owning module
- if a visual change affects app-wide direction, update `/app/AGENTS.md`; if it affects pre-auth mirrored shells, update `server/pages/AGENTS.md` too

## Verification



## Child DOX Index

- No child DOX docs.
