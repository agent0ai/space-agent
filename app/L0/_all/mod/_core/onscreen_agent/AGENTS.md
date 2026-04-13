# AGENTS

## Purpose

`_core/onscreen_agent/` owns the floating routed overlay agent.

It mounts into the router overlay layer, keeps its own floating shell, prompt files, persistence, attachments, execution loop, and overlay-specific interaction model, and reuses shared visual primitives for rendering and dialogs. It is the first-party user-facing agent surface under `_core/`.

Documentation is top priority for this module. After any change under `_core/onscreen_agent/`, update this file and any affected parent docs in the same session.

## Documentation Hierarchy

`_core/onscreen_agent/AGENTS.md` owns the overlay runtime and the shared onscreen skill-loading contract.

Current deeper docs:

- `app/L0/_all/mod/_core/onscreen_agent/prompts/AGENTS.md`

Parent vs child split:

- this file owns overlay-wide runtime behavior, persistence, execution flow, skill loading, and cross-surface prompt contracts
- `prompts/AGENTS.md` owns the shipped prompt files, token-budget rules, and prompt-text editing guidance

Child doc section pattern:

- `Purpose`
- `Ownership`
- `Local Contracts`
- `Development Guidance`

Update rules:

- update this file when overlay-wide runtime behavior, skill loading, or ownership boundaries change
- update the deeper prompt doc when shipped prompt file behavior, wording strategy, or token-budget rules change
- when framework, router, API, path, permission, or auth contracts change in ways that affect the shared development skill tree, update `app/L0/_all/mod/_core/skillset/ext/skills/development/AGENTS.md` in the same session

## Ownership

This module owns:

- `ext/html/page/router/overlay/end/onscreen-agent.html`: thin adapter that mounts the overlay into the router overlay seam
- `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages/end/*.js`: prompt-example extensions that prepend live few-shot conversations ahead of thread history
- `panel.html`: overlay UI and the module-owned `onscreen` skill-context tag exported through `<x-skill-context>`
- `response-markdown.css`: overlay-local markdown presentation overrides for assistant responses
- `store.js`: floating-shell state, send loop, persistence, avatar drag behavior, edge-hide peeking state, history resize behavior, display mode, and overlay menus
- `view.js`: shared-thread-view wiring
- `skills.js`: onscreen skill discovery wrappers around shared `/mod/_core/skillset/skills.js`, skill frontmatter metadata flags, `space.skills.load(...)`, and skill-related JS extension seams
- `llm.js`, `api.js`, `execution.js`, `attachments.js`, and `llm-params.js`: local runtime helpers
- `llm.js` owns LLM-facing system-prompt file loading, optional example-message construction, just-loaded skill injection into the system prompt, runtime system-prompt assembly, prompt-instance caching, separate transient-message construction, final request assembly, history-compaction prompt loading, and the model-facing JS extension seams
- `api.js` owns chat transport, HTTP error handling, streaming response parsing, the shared `OnscreenAgentLlmClient` superclass plus provider subclasses for OpenAI-compatible API streaming and local Hugging Face streaming, and the API-request preparation seam `prepareOnscreenAgentApiRequest`; prompt-shaping logic lives in `llm.js`
- `llm-params.js` delegates YAML parsing to the shared framework `js/yaml-lite.js` utility but still enforces the overlay-specific top-level `key: value` params contract
- `config.js` and `storage.js`: persisted settings, browser-stored overlay UI state, and history
- `prompts/`: shipped prompt files and prompt-local documentation
- `res/`: overlay-local assets
- the `space.onscreenAgent` runtime namespace for overlay display control and externally triggered prompt submission

## Persistence And Prompt Contract

Current persistence paths:

- config: `~/conf/onscreen-agent.yaml`
- browser UI state: `sessionStorage["space.onscreenAgent.uiState"]` with `localStorage["space.onscreenAgent.uiState"]` as fallback
- history: `~/hist/onscreen-agent.json`

Current config fields include:

- `llm_provider`
- `local_provider`
- API provider settings and params
- `max_tokens`
- `huggingface_model`
- `huggingface_dtype`
- optional `custom_system_prompt`

Current browser UI state fields include:

- `agent_x`
- `agent_y`
- optional `hidden_edge`
- optional `history_height`
- `display_mode`

Legacy compatibility:

- `display_mode` is the canonical persisted mode field for browser UI state
- browser UI state loads from `sessionStorage` first, then `localStorage`, then legacy config fields as a migration fallback when browser storage is still empty
- `storage.js` still accepts legacy `collapsed` values when older browser state or configs are loaded
- `storage.js` also normalizes numeric coordinate scalars before the overlay store applies `agent_x` and `agent_y`, and it normalizes `hidden_edge` through the shared config helper before the store trusts the peeking state
- when `~/conf/onscreen-agent.yaml` is missing, `storage.js` treats that load as first-run state instead of restoring browser-global overlay position data, and `store.js` places the visible compact overlay box with its full width centered while its bottom edge targets whichever is lower on screen: `7em` above the viewport bottom or `90%` of viewport height before the first persistence write
- when config is rewritten, overlay position and display state fields must not be written back into `~/conf/onscreen-agent.yaml`

Current defaults:

- provider: `api`
- local provider: `huggingface`
- Hugging Face dtype: `q4`
- API endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `openai/gpt-5.4-mini`
- params: `temperature:0.2`
- max tokens: `64000`
- default display mode: compact

Prompt rules:

- `prompts/system-prompt.md` is the firmware prompt
- the current live firmware prompt was promoted from `tests/agent_llm_performance/prompts/069A_handoff_no_copy.md` on 2026-04-07 after the `070` through `075` prompt sweep because it remained the best overall prompt on the 57-case suite, combining the best one-shot score with the strongest full-suite repeat stability among the finalists on `openai/gpt-5.4-mini`; the previous live prompt was backed up as `prompts/system-prompt.backup-before-069A-handoff-no-copy-2026-04-07.md`
- custom instructions are appended under `## User specific instructions`
- the prepared prompt order is `system -> examples -> compacted history summary when present -> live history -> transient`
- examples are optional, empty by default, and are inserted as ordinary alternating user or assistant messages ahead of live history rather than being folded into the system prompt
- example messages count toward prompt-history token totals and appear in the prompt-history modal, but automatic or manual history compaction may replace only live history turns, never the examples or transient section
- the runtime system prompt also injects a stable `## prompt includes` section from `_core/promptinclude`; that section must explain that readable `*.system.include.md` files are appended below into the system prompt and readable `*.transient.include.md` files are emitted later into transient context, and the wrapper text should stay outside `prompts/system-prompt.md` so owner-module prompt extensions can evolve without editing the base firmware prompt
- skill frontmatter may include a `metadata` object for runtime-owned flags; `metadata.when.tags` requires live `<x-skill-context>` tags before a skill becomes catalog-loadable, and `metadata.just_loaded` may be either `true` or another `{ tags: [...] }` condition for automatic prompt inclusion after the catalog
- the runtime prompt appends the top-level onscreen skill catalog built from readable `mod/*/*/ext/skills/*/SKILL.md` files that are currently eligible under the live document skill-context tags
- the catalog prompt block should stay compact and plain-text: `skills`, one short loader hint, then `skills id|name|description↓` rows
- after that catalog, the runtime appends a compact `just loaded` block containing repeated `id: <skill-id>` markers plus the skill body text for readable `mod/*/*/ext/skills/**/SKILL.md` entries whose `metadata.just_loaded` condition currently passes; do not inject frontmatter there because the catalog already carries name and description
- readable `*.system.include.md` app files should be appended after the prompt-include instructions block as separate system-prompt sections, sorted alphabetically by full logical path and prefixed with `source: /logical/path` for prompt inspection
- the trailing transient message may also include a `prompt includes` section from `_core/promptinclude`; it should batch-read readable `**/*.transient.include.md` app files through `file_paths` plus `file_read`, sort them alphabetically by full logical path, and render each file as `/logical/path` followed by one fenced block containing the exact file body
- prompt construction exposes JS seams at `_core/onscreen_agent/llm.js/fetchDefaultOnscreenAgentSystemPrompt`, `_core/onscreen_agent/llm.js/fetchOnscreenAgentHistoryCompactPrompt`, `_core/onscreen_agent/llm.js/buildOnscreenAgentSystemPromptSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages`, `_core/onscreen_agent/llm.js/buildOnscreenAgentHistoryMessages`, `_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentPromptInput`, and `_core/onscreen_agent/llm.js/buildRuntimeOnscreenAgentSystemPrompt`
- prompt extensions should prefer the sections seam when they need to append or replace whole prompt sections; the final builder seam is for last-mile rewrites of the assembled string
- request preparation should run through the shared prompt-input builder in `llm.js`, which wraps each prepared user-role message in either a `_____user` block for real human submissions or a `_____framework` block for framework-generated follow-up turns such as execution output, preserves the system or examples or history or transient section boundaries in the outbound payload, and emits transient runtime context as its own trailing `_____transient` message when any transient sections exist
- the API-mode fetch branch must finalize its upstream request through `api.js` seam `_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest`; provider-specific headers or body rewrites belong in extension modules such as `_core/open_router`, not in `llm.js`
- `api.js` may fold consecutive prepared `user` or `assistant` payload messages into alternating transport turns with `\n\n` joins immediately before the fetch call, but that transport-only fold must not mutate prepared prompt entries, prompt-history state, or stored live history
- the built-in example extension under `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages/end/user-self-info.js` should prepend a framework prompt asking the agent to check user detail, an assistant execution reply that calls `space.api.userSelfInfo()`, and a framework execution-result message populated with the live API result so the model sees both the expected execution format and the current user snapshot
- the top-level skill catalog and `just loaded` block are model-facing prompt context and therefore belong to `llm.js` orchestration even though `skills.js` still owns low-level skill discovery helpers and `space.skills.load(...)`
- `_core/spaces` currently uses the sections seam only to inject a space-local `## Current Space Agent Instructions` section when the current space defines agent instructions; generic spaces workflow guidance belongs in the route-scoped `just loaded` `spaces` skill, and live widget catalogs or current-space details should be loaded on demand instead of being pre-injected into the prompt
- `_core/promptinclude` uses the system-prompt sections seam plus the transient sections seam to inject persistent prompt-include instructions, readable `*.system.include.md` system-prompt sections, and readable `*.transient.include.md` transient blocks without adding promptinclude-specific branching to `llm.js`
- module-specific prompt workflow rules and helper-specific execution guidance should live in owner-module just-loaded skills or owner-module `_core/onscreen_agent/...` prompt extensions, not in the base firmware prompt unless the rule is overlay-generic
- the firmware prompt should start with an environment block that explains the agent is a JavaScript-based browser assistant living inside the live page and acting through browser state plus Space Agent runtime APIs
- the firmware prompt should define a `$mission` block above `$protocol`; that `$mission` should tell the agent to be useful, follow the latest `$human_command`, and drive the user toward `$verified_completion` with minimal correct steps
- the firmware prompt should also make the mission-level authority explicit: the agent acts as ship administrator for the runtime, uses available system authority on the user's behalf, and should do the work directly instead of asking for ordinary permission or assistance
- the firmware prompt should define a strict mission `$protocol` under that `$mission` as the top-level operating contract and should make the agent classify every turn into `$conversation_mode` or `$task_mode` before doing anything else
- the firmware prompt should define the overlay's reusable protocol terms explicitly: `$thrust_response` for assistant messages that continue the task by executing code, `$terminal_response` for assistant messages with no execution that end the turn, `$staging_sequence` for the pre-execution sentence, `$execution_gate` for `_____javascript`, `$execution` for the browser-side javascript run triggered by that gate, `$human_command` for `_____user`, `$framework_telemetry` for `_____framework`, and `$transient_context` for `_____transient`
- the firmware prompt should center the control flow on one ordered turn loop: inspect latest non-transient input, map source, choose `$conversation_mode` or `$task_mode`, choose exactly one next move, then repeat after every `$framework_telemetry` turn
- that ordered turn loop has already improved steering toward correct execution-first behavior and should be preferred over layering more fragmented prompt rules
- the firmware prompt should forbid permission-seeking loops in `$task_mode`; if the next corrective or discovery or mutation `$thrust_response` is available and obvious, the prompt should instruct the agent to send it instead of offering or asking whether to proceed
- the firmware prompt should also enforce discovery-first autonomy in `$task_mode`: if a needed fact is likely available from browser state runtime apis current page prior telemetry transient context attachments or ordinary fetch, the prompt should steer the agent to discover it before asking the user
- the firmware prompt should also encode `action creates information`: when uncertain in `$task_mode`, it should steer the agent toward the safest useful info-creating execution rather than a stopping reply
- the firmware prompt should also push best-effort continuation in `$task_mode`: if user intent is clear and only recoverable uncertainty remains, the prompt should steer the agent to use current context or runtime discovery before stopping
- the firmware prompt should treat omitted scope as current-context by default when that scope is the natural reading of the request
- the firmware prompt should treat self-referential scope words like `mine`, `here`, `local`, and `current` as instructions to use current context, and should prefer attempting direct browser or runtime access before asking
- the firmware prompt should define `$verified_completion` against the requested outcome rather than intermediate discovery and should push the agent to continue when prerequisite data only unlocks the obvious next step
- the firmware prompt should also force truly unavoidable blocking questions into one short direct question with no acknowledgement preface and no narration that a step is needed
- the firmware prompt should treat short follow-up user fragments as likely missing values or redirects for the active task when they fit, instead of re-asking the old blocker
- the firmware prompt should also force follow-up extraction after broad reads: if one more read can unpack or extract the answer, the agent should send another `$thrust_response` instead of stopping on partial telemetry
- the firmware prompt should avoid concrete blocker examples that over-anchor one domain and should prefer general reusable rules when the behavior is cross-domain
- the firmware prompt should make clear that in `$task_mode` a `$terminal_response` is the final non-executing shot for that turn, so it is forbidden before `$verified_completion` except for one truly unavoidable blocking question, and prompt wording should phrase violations as `$mission failed`
- the firmware prompt should tell the agent that a `$thrust_response` is the only assistant output that keeps the task loop alive because it causes execution and yields the next `$framework_telemetry` turn
- the firmware prompt should tell the agent that `space.api.userSelfInfo()` returns `{ username, fullName, groups, managedGroups }` and that writable app roots are derived from `username`, `managedGroups`, and `_admin` membership in `groups`
- the firmware prompt should also remind the agent to `return await ...` for browser mutations that need confirmation, should refer to the active thread as `space.chat`, should use `space.utils.yaml.parse(...)` plus `space.utils.yaml.stringify(...)`, should explain writable-scope discovery from `space.api.userSelfInfo()` plus the standard layer rules, and should leave domain-specific widget workflow guidance to the route-scoped `just loaded` `spaces` skill instead of duplicating it in the base firmware prompt
- the firmware prompt should use first-party helpers such as `/mod/_core/skillset/screenshots.js` for reusable browser tasks instead of teaching remote script injection
- the firmware prompt should enforce telemetry truth: the `$staging_sequence` must describe the code in the same message, read-only execution may not be narrated as mutation, success claims require matching success telemetry for that exact action, and an `execution error` telemetry turn forbids any success claim
- the firmware prompt should also tell the agent that after a read stage, if the next mutation is clear, it must continue immediately with another `$thrust_response` rather than spending a `$terminal_response` on progress narration such as `I have it loaded and can patch next`
- the firmware prompt should also tell the agent to keep large reads in normal top-level JavaScript variables and return only the narrow slice or summary needed for the next step unless the full text must stay in-model immediately, for example exact numbered patch lines
- the firmware prompt examples must stay plain text and must not wrap execution snippets or execution-output examples in triple-backtick fences, because fenced examples train the overlay agent to emit fences after `_____javascript`
- the firmware prompt should also enforce staged execution: if a helper result determines the next action, the agent should stop after that helper call and wait for the next turn instead of chaining discovery and dependent mutation in one JavaScript block
- the firmware prompt should require one short `$staging_sequence` sentence before execution blocks so the thread stays readable, but this should stay prompt pressure rather than a runtime validation error
- the firmware prompt should also make clear that all execution narration belongs before `_____javascript`; there must be no explanatory prose after the separator because everything after it is executed as code
- the firmware prompt should also make clear that silent execution is wrong and that a bare `$staging_sequence` such as `Checking the current widget source` is not acceptable progress when browser work is needed; if the sentence announces a browser step, that same message must continue with `_____javascript`
- the firmware prompt should also tell the agent not to ask redundant clarification questions when the user already named an obvious runtime target such as a widget by name
- the firmware prompt should also tell the agent to trust the exact runtime shape it just saw in `_____framework` or `_____transient` instead of hallucinating richer object shapes; if the runtime showed a plain-text catalog, the agent should read that text literally
- the firmware prompt should tell the agent to stop after a successful mutation that appears to satisfy the user instead of making speculative extra edits
- the firmware prompt should also tell the agent that after a successful mutation it must either execute again because more browser work is truly needed or answer the user normally; promise-only follow-up lines such as `Updating...` or `Applying...` are not acceptable
- the firmware prompt should tell the agent never to emit raw JavaScript or fenced code as a normal reply; browser work must use the execution protocol, otherwise the reply must be ordinary prose
- shipped firmware prompt changes should be compared in `tests/agent_llm_performance/` first, and live prompt promotion should require both automated harness success and manual review of the nominal passes
- `execution.js` should fail fast when `_____javascript` is inline instead of occupying its own line, and should surface a direct protocol error telling the agent to put the explanatory sentence on the previous line and the separator alone on the next line
- the firmware prompt should explain the prepared-message block markers explicitly: `_____user` means the real human user, `_____framework` means a runtime-generated follow-up turn, and `_____transient` is auto-injected mutable context
- prompt-facing text here is token-budgeted; when editing `prompts/system-prompt.md`, prompt wrapper strings in `skills.js`, or any just-loaded skill, measure the prompt surface with the local tokenizer in the same session and prefer plain text, short labels, minimal markdown, minimal filler, and no unnecessary trailing punctuation
- `prompts/compact-prompt.md` is used for user-triggered history compaction
- `prompts/compact-prompt-auto.md` is used for automatic compaction during the loop

## JS Extension Seams

Overlay chat behavior is intentionally extensible through `ext/js/` hooks rather than private store patching.

Current stable seams:

- `skills.js` exposes `_core/onscreen_agent/skills.js/listDiscoveredSkillFiles`, `_core/onscreen_agent/skills.js/loadOnscreenSkillIndex`, `_core/onscreen_agent/skills.js/loadOnscreenSkillCatalog`, `_core/onscreen_agent/skills.js/buildOnscreenSkillsPromptSection`, `_core/onscreen_agent/skills.js/buildOnscreenJustLoadedSkillsPromptSection`, `_core/onscreen_agent/skills.js/loadOnscreenSkill`, and `_core/onscreen_agent/skills.js/installOnscreenSkillRuntime`; use these for skill discovery, virtual skills, skill-catalog source data, overriding just-loaded skill source generation, overriding skill loads, or augmenting `space.skills`
- `llm.js` exposes `_core/onscreen_agent/llm.js/fetchDefaultOnscreenAgentSystemPrompt`, `_core/onscreen_agent/llm.js/fetchOnscreenAgentHistoryCompactPrompt`, `_core/onscreen_agent/llm.js/buildOnscreenAgentSystemPromptSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages`, `_core/onscreen_agent/llm.js/buildOnscreenAgentHistoryMessages`, `_core/onscreen_agent/llm.js/buildRuntimeOnscreenAgentSystemPrompt`, `_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentPromptInput`, `_core/onscreen_agent/llm.js/buildOnscreenAgentPromptMessageContext`, `_core/onscreen_agent/llm.js/createOnscreenAgentPromptInstance`, and `_core/onscreen_agent/llm.js/prepareOnscreenAgentCompletionRequest`; use these when the extension changes model-facing context, including system-prompt sections, example conversations, transient blocks, prompt-instance lifecycle, or final outbound message shaping
- `execution.js` exposes `_core/onscreen_agent/execution.js/validateOnscreenAgentExecutionBlockPlan`; this seam owns block-level execution-plan validation, should stay generic to the overlay execution protocol, and feature modules should attach their own task-specific validators from `ext/js/` instead of adding those checks directly to `execution.js`
- `api.js` exposes `_core/onscreen_agent/api.js/streamOnscreenAgentCompletion` as the transport seam and `_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest` as the prepared-request mutation seam for API-mode fetches
- `store.js` exposes `_core/onscreen_agent/store.js/processOnscreenAgentMessage`; it runs before overlay messages are committed or reused after key lifecycle steps and receives a context object with `phase`, `message`, `history`, and `store`

Current runtime namespace:

- `store.js` also registers `space.onscreenAgent`
- `store.js` also publishes the active overlay thread snapshot at `space.chat`, including `messages`, live `attachments` helpers for the current surface, and a non-persisted `transient` registry for mutable prompt context blocks that should be emitted as a separate trailing prepared `_____transient` message
- prepared user messages with attachments should append one compact helper block that uses `Chat runtime access↓` for the runtime-access notes and `Attachments↓` before the attachment rows, so multiline helper data is visibly framed as continuing below each label
- `space.onscreenAgent.show(options?)` opens the overlay, first reveals any persisted edge-hidden peeking pose back to the in-screen threshold position, and preserves the current display mode unless `options.mode` explicitly requests compact or full
- `space.onscreenAgent.submitPrompt(promptText, options?)` opens the overlay, first reveals any persisted edge-hidden peeking pose back to the in-screen threshold position, seeds the composer, and submits or queues the prompt through the owned send loop while preserving the current display mode unless `options.mode` explicitly requests compact or full
- `space.onscreenAgent.submitExamplePrompt(promptText, options?)` is the guarded preset-button variant for spaces and similar launchers: it opens the overlay, refuses to queue into an already busy send loop, shows `Don't forget to configure your LLM first.` through the overlay bubble when the composer is blocked by the default API-key warning, shows `I'm in the middle of something...` when the overlay is already sending or executing or compacting, and only then seeds the composer and submits the prompt while preserving the current display mode unless `options.mode` explicitly requests compact or full

Current `processOnscreenAgentMessage` phases:

- `submit`: a user draft was converted into the first outbound message
- `assistant-response`: a streamed assistant reply finished, or a stopped reply produced partial content, before metrics and persistence run
- `execution-output`: browser execution results were converted into the follow-up user message; even successful no-return executions stay in this phase instead of triggering a missing-result correction turn
- `protocol-retry`: the overlay is generating a generic empty-assistant protocol-correction retry message
- `history-compact`: history compaction produced the replacement summary message

Phase-specific context fields may include `draftSubmission`, `responseMeta`, `executionResults`, `executionOutputMessage`, or compaction `mode`.

## Overlay Contract

Current overlay behavior:

- the module mounts only through the router overlay seam at `page/router/overlay/end`
- the shell supports compact and full display modes
- avatar drag positioning, edge-hide peeking, action menus, history-edge resizing, and visibility recovery are owned by `store.js`
- `panel.html` passes `shell`, `avatar`, panel, thread, and dialog refs into `store.js`; the store uses those refs to clamp the saved position against the current viewport, to keep edge-hidden poses snapped with roughly 55 percent of the astronaut still visible, and to detect when the astronaut has drifted too far to recover cleanly
- dragging the avatar past the left, right, top, or bottom viewport edge should first hit a dead zone at the in-screen clamp that matches the reveal-threshold distance so corner placement stays possible, then snap the shell into a browser-persisted `hidden_edge` pose after the pointer crosses that dead zone; the astronaut rotates clockwise on the left edge, counterclockwise on the right edge, upside down on the top edge, and upright on the bottom edge, and the chat body collapses until the avatar is revealed again
- while hidden on an edge, dragging should keep the astronaut attached to that edge until the pointer crosses back past the in-screen reveal threshold; a click on the hidden astronaut should slide it back to that threshold position and restore the previously active compact or full chat body
- the full-mode history subtree mounts only in full mode; compact mode does not keep a history container mounted
- the full-mode history uses a non-scrolling outer shell for placement, chrome, and the resize grip, with an inner scroller that owns thread overflow
- in full mode, the history panel can be resized vertically from a full-width invisible handle that straddles the outer top or bottom border based on orientation, while a centered grip marks the draggable edge and the chosen height persists in config
- compact-to-full and full-to-compact switches should animate at the shell chrome layer: `store.js` owns a short display-mode transition phase, while `onscreen-agent.css` animates body width, panel chrome, and full-mode history entry so the overlay expands or settles instead of snapping; the collapse animation should keep the compact composer anchored and at its final scale instead of introducing a late positional or size snap when the phase clears
- when full mode mounts or the viewport changes, the store keeps the raw persisted history height instead of rewriting it to the current viewport fit; the rendered height is clamped against the currently available space on that side so reloads preserve the chosen size while smaller screens still fit
- the compact and full composer panels accept attachments from either the file picker or direct file drag-and-drop onto the chat box
- keyboard submit from the composer textarea and the form submit path may send a new message or queue a follow-up draft, but they must never trigger `requestStop()`; stopping the active loop stays an explicit primary-button click only
- saved browser UI state for `agent_x`, `agent_y`, optional `hidden_edge`, `history_height`, and `display_mode` is loaded during init before prompt startup continues, and the floating shell stays unmounted until that startup load has resolved so refreshes never flash the default bottom-left position before the stored coordinates and peeking state are applied
- the first shell paint should ease in with a short reveal once startup positioning is ready, but avoid ancestor opacity fades on the shell itself because they break the backdrop blur used by the history and composer surfaces
- internal startup statuses such as prompt bootstrapping may gate controls, but they should not replace the composer placeholder because they are not user-relevant; user-visible errors and action results should still surface through `status`
- when the persisted LLM settings still match the shipped defaults and the API key is blank, the composer blocks the full textarea area with a blurred overlay and centered `Set API key` action until credentials are configured
- in compact mode, the floating UI bubble should stream the assistant reply live during the response without waiting for completion, but UI updates may be coalesced to animation frames and must render only the text before the execution separator
- compact-mode bubble streaming must suppress a trailing partial execution marker such as `_____` while the separator is still arriving, and once `_____javascript` appears it must ignore that marker and everything after it
- when the shell is restored into an edge-hidden pose, the collapsed chat body may stay mounted for layout continuity but its hidden panel and history surfaces must not remain hit-testable or capture page scrolling while invisible; only the visible avatar and any allowed hint bubble may keep interaction
- after mount and after browser UI state load, the store re-clamps the saved position to the current viewport and persists any correction back to both browser storage tiers
- while mounted, the store also re-checks visibility on resize, `visibilitychange`, `focus`, `pageshow`, and on a periodic timer so monitor changes or desktop switches cannot leave the astronaut permanently off-screen
- the onboarding hint `**Drag** me, **tap** me.` now starts only from overlay mount timing, never from page load; `store.js` starts the 2-second countdown during `mount`, then auto-hides the hint 3 seconds after it becomes visible
- that startup hint is a dedicated `panel.html` bubble controlled by `isStartupHintVisible`, not a generic `showUiBubble(...)` message; keep it isolated from assistant-bubble lifecycle, markdown rendering, auto-hide timing, and hidden-edge suppression
- that startup hint may render even when the overlay restored into a persisted edge-hidden pose
- only real trusted shell `pointerdown` events may dismiss that startup hint early for the current page session; otherwise it resolves through its own 3-second visible timeout, and hint-specific interaction bookkeeping should stay out of unrelated controls or mode helpers
- browser execution blocks use the `_____javascript` separator and are executed locally through `execution.js`
- the surface uses the shared `createAgentThreadView(...)` renderer from `_core/visual/conversation/thread-view.js`
- overlay history relies on the shared thread bubble sizing rules; user messages must wrap long lines inside their own bubble so the history scroller stays width-stable and does not gain a horizontal scrollbar from chat text alone
- `view.js` enables the shared marked-backed chat-bubble markdown renderer for the overlay, assigns the `onscreen-agent-response-markdown` class so assistant-response-specific heading and table tuning stays local to this module, and opts the overlay thread into consecutive-avatar grouping so only the first rendered row in a same-speaker run shows the user or agent avatar
- `panel.html` loads `response-markdown.css` after the base overlay stylesheet; keep assistant-response markdown element overrides there instead of patching `_core/visual` for overlay-only presentation, and style markdown tables through the shared `.message-markdown-table-wrap` wrapper rather than changing the table element into a scroll container
- the full-mode `data-chat-thread` subtree is renderer-owned DOM, not Alpine-owned UI; `panel.html` should keep Alpine click wiring on the surrounding scroller, mark the chat-thread node with `x-ignore`, and keep mode-switch animation on the surrounding shell or panel chrome instead of remounting, fading, or transforming the thread subtree during live updates
- the compact floating UI bubble is a separate overlay surface owned by `panel.html`, `store.js`, and `onscreen-agent.css`; it should render through the shared markdown helper into a local content ref instead of using plain `x-text`
- `store.js` owns the compact bubble singleton lifecycle; `showUiBubble(...)` returns a bubble instance whose `update(...)` method only mutates the currently active bubble, recalculates auto-hide from the updated text length, and can reopen that same bubble after auto-hide until a newer bubble instance replaces it
- native dialogs use the shared dialog helpers from `_core/visual/forms/dialog.js`
- lightweight action menus use the shared popover positioning helper from `_core/visual/chrome/popover.js`
- the floating root and its compact action menu reserve effectively topmost z-index bands so routed content and dynamically rendered surfaces do not obstruct the overlay controls
- the compact composer action menu stays hidden through its initial positioning passes, closes when avatar dragging starts, and chooses up or down placement from the trigger button midpoint against the 50% viewport line rather than reusing the UI bubble breakpoint
- history-destructive controls must stay disabled when the thread is empty: full-mode footer `Clear chat`, full-mode footer `Compact context`, and compact-mode action-menu entries for those same actions should all be unavailable until history exists
- the loop supports queued follow-up submissions, stop requests, attachment revalidation, and animation-frame streaming patches; streamed execution cards must update their existing DOM in place so expanded details panes remain usable while tokens continue arriving, stable narration or other settled execution-card subtrees must not be recreated on each delta, completed execution rows must remain separate from later assistant turns so a new streamed reply only touches the live row, ordinary history renders must reuse unchanged keyed rows instead of rebuilding the whole thread, thread scroll should keep following while the user remains near the bottom and should decouple only after the user has scrolled up, and only when that direct patch cannot apply should the full-mode thread fall back to a frame-batched local rerender of the affected suffix
- full-mode streaming should not churn Alpine-owned composer placeholder or status bindings on each delta; live token updates belong in the renderer-owned thread only
- `store.js` should hold one prompt-instance object per chat surface, rebuild full prompt input when the overlay boots or the thread is reset or a new LLM turn is about to start, and reuse the cached system or examples or transient sections without recomputing the full prepared payload or token counts on every streamed delta
- prompt-history previews and token counts are derived from the prepared outbound request payload so request-prep extensions stay visible in the context window instead of only affecting the final fetch call, but exact recomputation should happen only at stable boundaries such as request preparation, stop handling, or settled assistant completion, never on every streamed delta
- the settings modal and prompt-history modal must both use the shared fixed-chrome dialog shell from `_core/visual/forms/dialog.css` so their header and footer rows stay static while only the settings form body or prompt-history frame scrolls
- the settings modal keeps a provider switch with exactly two tabs named `API` and `Local`; API settings show endpoint, model, and API key fields, while local settings mount the shared `_core/huggingface/config-sidebar.html` component in `onscreen` mode
- local provider settings are limited to the shared Hugging Face browser runtime for now; the overlay subscribes to `_core/huggingface/manager.js`, reads the same saved-model list and live worker state as the routed Local LLM page, and should not boot the worker just because the modal opened
- when no Hugging Face model is selected and the shared saved-model list has entries, the overlay local-provider panel should preselect the browser-wide last successfully loaded saved model from `_core/huggingface/manager.js`, falling back to the first saved entry if that last-used entry was discarded
- when no Hugging Face model is selected, no model is loaded, and the shared saved-model list is empty, the overlay local-provider panel should prefill the model field with the same default used by the routed testing page: `onnx-community/gemma-4-E4B-it-ONNX`
- saving local settings must persist the selected Hugging Face repo id and dtype, then start background model preparation; the first local send remains the fallback load trigger if that preparation has not finished
- local-provider sends use the compact `LOCAL_ONSCREEN_AGENT_SYSTEM_PROMPT` profile in `llm.js` instead of the full firmware prompt plus skill catalog, while preserving custom instructions, history, transient context, execution-loop behavior, and prompt-inspection data
- when the overlay is about to send through the local provider and the configured local model is not ready, the status should read `Loading local LLM...`; once text deltas arrive, normal streaming status and compact-bubble updates take over
- the default API-key overlay should only block the composer for the API provider when the shipped API defaults are still selected and no API key is configured; local Hugging Face mode does not require the API-key blocker
- the prompt-history modal must show the exact prepared message payload before the final transport-only consecutive-role fold, including example messages, any prepared `_____user` or `_____framework` blocks, and any separate trailing `_____transient` message
- the prompt-history modal footer owns prepared-payload navigation and copy helpers: it should be implemented as one outer footer row with exactly two inner groups, one left and one right, so the three navigation buttons stay on the left edge and the four copy or close buttons stay on the right edge; it should reuse the shared compact modal button treatment from `_core/visual/forms/dialog.css` instead of reintroducing large pill-style modal controls locally, keep all footer controls on the same fixed compact button width so icon-bearing buttons do not outgrow `Close`, jump across prepared real-user `_____user` blocks rather than every user-role message, pin the targeted prepared message to the top of the history scroller on every jump, label example turns as `EXAMPLE USER` or `EXAMPLE ASSISTANT` in text mode, and copy system-only, history-only, or full prepared-payload slices using the currently selected text or JSON mode, with the history-only slice limited to actual live or compacted history entries and excluding example or transient prompt context
- text mode may render per-message sections for scanning, but JSON mode must stay a single raw prepared-payload block that remains mouse-selectable and copyable; real-user jump controls should still land on the same prepared message indexes in both modes, using line-based scrolling for the raw JSON view
- model-facing helper outputs should prefer compact flat text over JSON when the agent only needs a lightweight catalog or status list, because token stability matters more than shape richness in overlay history
- `execution.js` owns the execution transcript contract: successful no-return runs must emit `execution returned no result and no console logs were printed`, result blocks must print `result↓` on its own line before the raw returned text so multiline payloads visibly continue below the label, structured result payloads should prefer `space.utils.yaml.stringify(...)` over JSON when the lightweight YAML helper can serialize them so history stays smaller, the live thread UI should retain full execution snapshots for the freshest execution result, and persisted execution-output turns should stay text-stable instead of being rewritten later with truncation markers or omission summaries
- no-result execution output is informational only; the loop must forward it as a normal `execution-output` turn and must not synthesize a missing-result protocol-correction message
- when any turn returns no assistant content, the runtime retries the same request once automatically before sending a generic protocol-correction user message
- empty-response protocol-correction messages must stay short and should tell the agent to continue from the conversation above instead of depending on a specific prior turn type such as execution output
- `space.skills.load("<path>")` loads onscreen skills on demand using skill ids relative to `ext/skills/` and excluding the trailing `/SKILL.md`
- only top-level skills are injected into the prompt catalog by default; routing skills can direct the agent to deeper skill ids
- any readable skill at any depth may also be auto-injected into the prompt when its frontmatter sets `metadata.just_loaded` and that condition passes against the live document skill-context tags
- loaded onscreen skills are captured as execution-side effects and inserted into the immediate execution-output turn with the full skill file content, even when the JavaScript block uses plain `await space.skills.load(...)` without a final `return`; once that turn is stale, history compaction may replace it with a shorter loaded-skill summary
- on-demand loaded skill content enters history through `skills.js` plus `execution.js`, not through `llm.js`; `llm.js` is responsible for how that already-loaded history is normalized and sent to the model
- skill discovery uses the app-file permission model plus layered owner-scope ordering, and same-module layered overrides replace lower-ranked skill files before the catalog is built
- readable group-scoped modules such as `L0/_admin/mod/...` may contribute additional onscreen skills; those skills are visible only to users who can read that group root
- skill ids must be unique across readable modules; conflicting ids are omitted from the prompt catalog and load attempts fail with an ambiguity error

## Development Guidance

- keep overlay-specific behavior local to this module
- do not import admin-agent internals for convenience
- use the router overlay seam rather than reaching around the router shell
- do not preserve compatibility shims inside this module just to keep old local helper paths alive; when ownership moves, update callsites and extension docs to the new canonical seam instead of maintaining mirrored prompt or request paths
- when another module needs to change overlay prompt, skill, request, or message behavior, add or consume the local JS seams here instead of reaching into private store state from outside the module
- keep `_core/onscreen_agent` generic: do not add task-specific execution validators, helper workflows, or module-owned prompt rules here when the owning module can supply them through `ext/js/` or skills
- keep onscreen skill discovery and runtime behavior separate from the admin agent even when copying skill content for starter coverage
- keep overlay-local Hugging Face glue limited to snapshot shaping, settings state, and calls into the shared `_core/huggingface/manager.js`; do not fork a second Hugging Face worker or import admin-agent local-provider helpers
- keep `ext/skills/development/` aligned with the current frontend and read-only backend contracts so the onscreen agent's development guidance does not drift
- keep prompt-surface strings lean: prefer `id|name|description` rows, short block labels, and body-only just-loaded skill text over verbose wrappers
- if behavior becomes meaningfully shared with the admin agent, promote it into `_core/framework` or `_core/visual` instead of creating cross-surface dependencies
- if overlay runtime, prompt construction, execution protocol, or skill loading changes, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/agent/`
- if you change the router overlay contract, persistence paths, skill discovery, or prompt execution behavior, update this file and the relevant parent docs in the same session
