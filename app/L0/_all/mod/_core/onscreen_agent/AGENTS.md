# AGENTS

## Purpose

`_core/onscreen_agent/` owns the floating routed overlay agent.

It mounts into the router overlay layer, keeps its own floating shell, prompt files, persistence, attachments, execution loop, and overlay-specific interaction model, and reuses shared visual primitives for rendering and dialogs. It is the first-party user-facing agent surface under `_core/`.

Documentation is top priority for this module. After any change under `_core/onscreen_agent/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/html/page/router/overlay/end/onscreen-agent.html`: thin adapter that mounts the overlay into the router overlay seam
- `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages/end/*.js`: prompt-example extensions that prepend live few-shot conversations ahead of thread history
- `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections/end/*.js`: transient-context extensions that append model-facing runtime context such as compact-mode response guidance
- `panel.html`: overlay UI and the module-owned `onscreen` context tag exported through `<x-context>`, while sourcing the draggable astronaut image from shared `_core/visual/res/chat/overlay/`
- `prompt-context.js`: pure prompt-context helpers for overlay-owned transient sections such as the bounded current-user `~/` file tree formatter
- `response-markdown.css`: overlay-local markdown presentation overrides for assistant responses
- `store.js`: floating-shell state, send loop, persistence, avatar drag behavior, edge-hide peeking state, history resize behavior, display mode, overlay menus, lazy prompt bootstrapping, the derived example-prompt status getters exposed on the global Alpine `onscreenAgent` store for launchers such as spaces onboarding, and the assistant-message evaluation seam `_core/onscreen_agent/store.js/evaluateOnscreenAssistantMessage`
- `view.js`: shared-thread-view wiring plus the overlay assistant avatar path sourced from shared `_core/visual/res/chat/overlay/`
- `turn-boundary.js`: pure send-loop boundary helpers that keep queued follow-up submissions from preempting pending assistant execution output
- `skills.js`: onscreen skill discovery wrappers around shared `/mod/_core/skillset/skills.js`, skill frontmatter metadata flags, `space.skills.load(...)`, and skill-related JS extension seams
- `llm.js`, `api.js`, `execution.js`, `attachments.js`, and `llm-params.js`: local runtime helpers
- `llm.js` owns LLM-facing system-prompt file loading, optional example-message construction, auto-loaded and runtime-loaded skill injection into system or transient prompt context, runtime system-prompt assembly, the surface-specific prepared-prompt builders layered on top of shared `_core/agent_prompt/prompt-runtime.js`, separate transient-message construction, final request assembly, history-compaction prompt loading, and the model-facing JS extension seams
- `api.js` owns chat transport, HTTP error handling, streaming response parsing, the shared `OnscreenAgentLlmClient` superclass plus provider subclasses for OpenAI-compatible API streaming and local Hugging Face streaming, and the API-request preparation seam `prepareOnscreenAgentApiRequest`; prompt-shaping logic lives in `llm.js`
- `llm-params.js` delegates YAML parsing to the shared framework `js/yaml-lite.js` utility but still enforces the overlay-specific top-level `key: value` params contract
- `config.js` and `storage.js`: persisted settings, owner-tagged browser UI state, and history
- `prompts/`: shipped prompt files and prompt-local documentation
- the `space.onscreenAgent` runtime namespace for overlay display control and externally triggered prompt submission
- Direct child DOX docs listed below own their narrower subtrees.

## Local Contracts

### Persistence And Prompt Contract

Current persistence paths:

- config: `~/conf/onscreen-agent.yaml`
- browser UI state: `sessionStorage["space.onscreenAgent.uiState"]` with `localStorage["space.onscreenAgent.uiState"]` as fallback
- history: `~/hist/onscreen-agent.json`

Current config fields include:

- `llm_provider`
- `local_provider`
- API provider settings and params
- `max_tokens`
- `prompt_budget_ratios`
- `huggingface_model`
- `huggingface_dtype`
- optional `custom_system_prompt`

Config encryption rules:

- the overlay `api_key` is browser-owned user config and should be stored encrypted at rest with `space.utils.userCrypto` whenever that session is unlocked
- encrypted overlay API keys are stored as `userCrypto:`-prefixed strings in `~/conf/onscreen-agent.yaml`
- when the runtime cannot currently decrypt an existing encrypted `api_key`, load should surface the field as blank plus locked metadata instead of crashing, and save should preserve the stored ciphertext until the user explicitly replaces or clears it from an unlocked session
- in `SINGLE_USER_APP=true`, legacy `userCrypto:` API-key payloads from older non-single-user builds must also load as blank locked metadata instead of being treated as plaintext, and save should keep that stored ciphertext until the user explicitly replaces or clears it

Current browser UI state fields include:

- `agent_x`
- `agent_y`
- optional `hidden_edge`
- optional `history_height`
- `display_mode`
- `owner`

Legacy compatibility:

- `display_mode` is the canonical persisted mode field for browser UI state
- browser UI state writes are owner-tagged with the current username and must stay browser-local; avatar moves, edge-hide changes, compact/full mode changes, viewport re-clamps, and history-height resizes must not rewrite `~/conf/onscreen-agent.yaml`
- browser UI state loads from `sessionStorage` first, then `localStorage`, then legacy config fields as a migration fallback when browser storage is still empty
- `storage.js` still accepts legacy `collapsed` values when older browser state or configs are loaded
- `storage.js` also normalizes numeric coordinate scalars before the overlay store applies `agent_x` and `agent_y`, and it normalizes `hidden_edge` through the shared config helper before the store trusts the peeking state
- when `~/conf/onscreen-agent.yaml` is missing, `storage.js` may restore only browser UI state whose `owner` matches the current username; otherwise it treats that load as first-run state instead of restoring browser-global overlay position data, and `store.js` places the visible compact overlay box with its full width centered while its bottom edge targets whichever is lower on screen: `7em` above the viewport bottom or `90%` of viewport height before the first UI-state write
- when config is rewritten, overlay position and display state fields must not be written back into `~/conf/onscreen-agent.yaml`

Current defaults:

- provider: `api`
- local provider: `huggingface`
- Hugging Face dtype: `q4`
- API endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `anthropic/claude-sonnet-4.6`
- params: `temperature:0.2`
- max tokens: `120000`
- prompt-budget ratios: `system 30`, `history 40`, `transient 30`, `singleMessage 10`
- default display mode: compact

Prompt rules:

- `prompts/system-prompt.md` is the firmware prompt
- the current live firmware prompt was promoted from `tests/agent_llm_performance/prompts/089A_086A_browser_skill_exact_id.md` on 2026-04-18 after the browser-skill loop sweep because it improved the expanded 72-case suite on `openai/gpt-5.4-mini` from `65/72` to `69/72` one-shot while clearing the new four-case skill-loading family at `12/12` on its focused repeat-3 check; full-suite repeat validation drifted between `65/72` and `67/72` strict with `206/216` to `208/216` passing attempts, and the previous live prompt was backed up as `prompts/system-prompt.backup-before-089A-086A-browser-skill-exact-id-2026-04-18.md`
- the live firmware prompt now states near the top that visiting another website means using `browser-control` and a stand-alone browser window, and that leaving the current runtime page via `window.location`, `location.href`, `location.assign(...)`, or `location.replace(...)` is forbidden
- custom instructions are appended under `## User specific instructions`
- `store.js` init restores config, persisted browser UI state, and history first; it must not eagerly fetch the default system prompt, install the onscreen skill runtime, or assemble prompt input just to mount the overlay
- prompt dependencies such as the default firmware prompt, the skill runtime, the skill catalog, and prompt-section extensions load lazily on the first prompt-dependent action such as sending a message, rebuilding prompt input, or opening the prompt-history dialog
- the prepared prompt order is `system -> examples -> compacted history summary when present -> live history -> transient`
- examples are optional, empty by default, and are inserted as ordinary alternating user or assistant messages ahead of live history rather than being folded into the system prompt
- example messages count toward prompt-history token totals and appear in the prompt-history modal, but automatic or manual history compaction may replace only live history turns, never the examples or transient section
- the runtime system prompt also injects a stable `## prompt includes` section from `_core/promptinclude`; that section must explain that readable `*.system.include.md` files are appended below into the system prompt and readable `*.transient.include.md` files are emitted later into transient context, and the wrapper text should stay outside `prompts/system-prompt.md` so owner-module prompt extensions can evolve without editing the base firmware prompt
- skill frontmatter may include a `metadata` object for runtime-owned flags; `metadata.when` may be either `true` or a `{ tags: [...] }` condition that requires live `<x-context>` tags before a skill becomes catalog-loadable, `metadata.loaded` may be either `true` or another `{ tags: [...] }` condition for automatic prompt inclusion, auto-loaded prompt discovery scans only top-level `ext/skills/*/SKILL.md` files, nested skills remain explicit-load-only, and `metadata.placement` chooses whether that skill content lands in system, transient, or history context, except that auto-loaded skills may land only in system or transient and therefore fall back to `system` unless they explicitly set `transient`
- the runtime prompt appends the top-level onscreen skill catalog built from readable `mod/*/*/ext/skills/*/SKILL.md` files that are currently eligible under the live document context tags
- the catalog prompt block should stay compact and plain-text: `skills`, one short loader hint, then `skills id|name|description↓` rows
- after that catalog, the runtime appends a compact `auto loaded` block containing repeated `id: <skill-id>` markers plus the skill body text for readable top-level `mod/*/*/ext/skills/*/SKILL.md` entries whose `metadata.loaded` condition currently passes and whose effective placement resolves to `system`; explicitly transient auto-loaded skills are routed into transient context instead; do not inject frontmatter there because the catalog already carries name and description
- `_core/memory` currently uses that normal auto-loaded system-skill channel to teach prompt-include-backed `~/memory/behavior.system.include.md`, `~/memory/memories.transient.include.md`, and optional extra `~/memory/*.transient.include.md` files; do not special-case that skill in prompt-builder code
- readable `*.system.include.md` app files should be appended after the prompt-include instructions block as separate system-prompt sections, sorted alphabetically by full logical path and prefixed with `source: /logical/path` for prompt inspection
- the trailing transient message may also include a `prompt includes` section from `_core/promptinclude`; it should batch-read readable `**/*.transient.include.md` app files through `file_paths` plus `file_read`, sort them alphabetically by full logical path, and render each file as `/logical/path` followed by one fenced block containing the exact file body
- the module-local `user home files` transient section should be built from a recursive `space.api.fileList("~/", true)` pass, omit `.git/` directories and their descendants entirely, render the remaining paths as a simple indented `~/` tree with folders first and trailing `/`, and cap output through prompt-owned defaults `maxDepth: 5`, `maxFoldersPerFolder: 20`, `maxFilesPerFolder: 20`, and `maxLines: 250`; omitted children should stay explicit through `# <n> more folders`, `# <n> more files`, or the corresponding `(max depth)` or `(line limit)` suffixes instead of silently disappearing
- prompt construction exposes JS seams at `_core/onscreen_agent/llm.js/fetchDefaultOnscreenAgentSystemPrompt`, `_core/onscreen_agent/llm.js/fetchOnscreenAgentHistoryCompactPrompt`, `_core/onscreen_agent/llm.js/buildOnscreenAgentSystemPromptSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages`, `_core/onscreen_agent/llm.js/buildOnscreenAgentHistoryMessages`, `_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentPromptInput`, and `_core/onscreen_agent/llm.js/buildRuntimeOnscreenAgentSystemPrompt`
- prompt extensions should prefer the sections seam when they need to append or replace whole prompt sections; the final builder seam is for last-mile rewrites of the assembled string
- request preparation should run through the shared prompt-input builder in `llm.js`, which wraps each prepared user-role message in either a `_____user` block for real human submissions or a `_____framework` block for framework-generated follow-up turns such as execution output, preserves the system or examples or history or transient section boundaries in the outbound payload, and emits transient runtime context as its own trailing `_____transient` message when any transient sections exist
- prompt-budget enforcement should cache token counts on prepared entries and prompt items, trim history messages against the single-message history cap first, then apply each part budget through one shared planner pass: contributor-level trims must be at least `250` tokens each, and when that is not possible for `system` or `transient`, the runtime should trim one combined section body instead of sprinkling tiny cuts across multiple contributors
- prompt-instance lifecycle itself is shared with other first-party agent surfaces through `_core/agent_prompt/prompt-runtime.js`; overlay-specific prompt section seams and prepared-message shaping still belong here
- when a real human turn includes attachments, the `_____user` block should contain the literal user text plus the `Attachments↓` list, while the `space.chat` runtime access instructions for those attachments should move into a following `_____framework` block so prompt inspection keeps user intent separate from framework guidance
- the API-mode fetch branch must finalize its upstream request through `api.js` seam `_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest`; provider-specific headers or body rewrites belong in extension modules such as `_core/open_router`, not in `llm.js`
- `api.js` may fold consecutive prepared `user` or `assistant` payload messages into alternating transport turns with `\n\n` joins immediately before the fetch call, but that transport-only fold must not mutate prepared prompt entries, prompt-history state, or stored live history
- whenever example messages exist, `llm.js` should append one final example-sourced `_____framework` boundary that says `start of new conversation - don't refer to previous contents` before live history begins so the next real user turn is not treated as a continuation of the example transcript
- the built-in example extension under `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages/end/user-self-info.js` should prepend a framework prompt asking the agent to check user detail, an assistant execution reply that calls `space.api.userSelfInfo()`, and a framework execution-result message populated with the live API result so the model sees both the expected execution format and the current user snapshot
- the top-level skill catalog and auto-loaded skill channels are model-facing prompt context and therefore belong to `llm.js` orchestration even though `skills.js` still owns low-level skill discovery helpers and `space.skills.load(...)`
- `_core/spaces` currently uses the sections seam only to inject a space-local `## Current Space Agent Instructions` section when the current space defines agent instructions; generic space-management guidance belongs in the always-loaded `spaces` skill, widget-authoring guidance belongs in `space-widgets`, and live widget catalogs or current-space details should be loaded on demand instead of being pre-injected into the prompt
- `_core/promptinclude` uses the system-prompt sections seam plus the transient sections seam to inject persistent prompt-include instructions, readable `*.system.include.md` system-prompt sections, and readable `*.transient.include.md` transient blocks without adding promptinclude-specific branching to `llm.js`
- `_core/web_browsing` currently uses the prompt seams in three narrow ways: one onscreen-only top-level `browser-manager` skill auto-loads for stand-alone browser-window management, `browser-control` auto-loads once the page exports `browser:open`, one hook injects a brief `currently open web browsers` status block when registered browser surfaces are open, listing the public numeric browser ids plus their latest url and title, and a second hook injects `last interacted web browser` only when a remembered interacted browser surface is still open at prompt-build time, loading fresh simplified page content then rather than caching it at interaction time; those skills and prompt examples should rely on the top-level numeric-id `space.browser` helpers only, with no per-window handles or explicit `sync(...)` step, because open or state or navigation or inspection or interaction helpers already settle internally and mutations return fresh state snapshots; when those conditions are not met the owner-module hooks should add nothing
- the module-local transient extension under `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections/end/display-mode.js` should inject one short lowercase `chat display mode` transient section only while the overlay is in compact mode, telling the model `chat is in compact mode` and `keep replies short unless more detail is needed for correctness or the user asks for it`; full mode should add no display-mode section
- the module-local transient extension under `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections/end/user-home-tree.js` should inject one bounded `user home files` section showing the current user's `~/` tree through `prompt-context.js`; it should fail soft, keep folders before files, and keep omitted children visible through the explicit `# ... more ...` summary lines instead of silently truncating branches
- module-specific prompt workflow rules and helper-specific execution guidance should live in owner-module auto-loaded skills or owner-module `_core/onscreen_agent/...` prompt extensions, not in the base firmware prompt unless the rule is overlay-generic
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
- the firmware prompt should tell the agent that `space.api.userSelfInfo()` returns `{ username, fullName, groups, managedGroups, sessionId, userCryptoKeyId, userCryptoState }` while `~/user.yaml` still stores `full_name`, and that writable app roots are derived from `username`, `managedGroups`, and `_admin` membership in `groups`
- the firmware prompt should also remind the agent to `return await ...` for browser mutations that need confirmation, should refer to the active thread as `space.chat`, should use `space.utils.yaml.parse(...)` plus `space.utils.yaml.stringify(...)`, should explain writable-scope discovery from `space.api.userSelfInfo()` plus the standard layer rules, and should leave domain-specific widget workflow guidance to the current-space auto-loaded `space-widgets` skill instead of duplicating it in the base firmware prompt
- the firmware prompt should use first-party helpers such as `/mod/_core/skillset/ext/skills/screenshots/screenshots.js` for reusable browser tasks instead of teaching remote script injection
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
- prompt-facing text here is token-budgeted; when editing `prompts/system-prompt.md`, prompt wrapper strings in `skills.js`, or any auto-loaded skill, measure the prompt surface with the local tokenizer in the same session and prefer plain text, short labels, minimal markdown, minimal filler, and no unnecessary trailing punctuation
- `prompts/compact-prompt.md` is used for user-triggered history compaction
- `prompts/compact-prompt-auto.md` is used for automatic compaction during the loop

### JS Extension Seams

Overlay chat behavior is intentionally extensible through `ext/js/` hooks rather than private store patching.

Current stable seams:

- `skills.js` exposes `_core/onscreen_agent/skills.js/listDiscoveredSkillFiles`, `_core/onscreen_agent/skills.js/loadOnscreenSkillIndex`, `_core/onscreen_agent/skills.js/loadOnscreenSkillCatalog`, `_core/onscreen_agent/skills.js/buildOnscreenSkillsPromptSection`, `_core/onscreen_agent/skills.js/buildOnscreenAutoLoadedSkillsPromptSection`, `_core/onscreen_agent/skills.js/loadOnscreenSkill`, and `_core/onscreen_agent/skills.js/installOnscreenSkillRuntime`; use these for skill discovery, virtual skills, skill-catalog source data, overriding auto-loaded skill source generation, overriding skill loads, or augmenting `space.skills`
- `llm.js` exposes `_core/onscreen_agent/llm.js/fetchDefaultOnscreenAgentSystemPrompt`, `_core/onscreen_agent/llm.js/fetchOnscreenAgentHistoryCompactPrompt`, `_core/onscreen_agent/llm.js/buildOnscreenAgentSystemPromptSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentExampleMessages`, `_core/onscreen_agent/llm.js/buildOnscreenAgentHistoryMessages`, `_core/onscreen_agent/llm.js/buildRuntimeOnscreenAgentSystemPrompt`, `_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections`, `_core/onscreen_agent/llm.js/buildOnscreenAgentPromptInput`, `_core/onscreen_agent/llm.js/buildOnscreenAgentPromptMessageContext`, `_core/onscreen_agent/llm.js/createOnscreenAgentPromptInstance`, and `_core/onscreen_agent/llm.js/prepareOnscreenAgentCompletionRequest`; use these when the extension changes model-facing context, including system-prompt sections, example conversations, transient blocks, prompt-instance lifecycle, or final outbound message shaping
- `execution.js` exposes `_core/onscreen_agent/execution.js/validateOnscreenAgentExecutionBlockPlan`; this seam owns block-level execution-plan validation, should stay generic to the overlay execution protocol, and feature modules should attach their own task-specific validators from `ext/js/` instead of adding those checks directly to `execution.js`
- `api.js` exposes `_core/onscreen_agent/api.js/streamOnscreenAgentCompletion` as the transport seam and `_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest` as the prepared-request mutation seam for API-mode fetches
- `store.js` exposes `_core/onscreen_agent/store.js/processOnscreenAgentMessage`; it runs before overlay messages are committed or reused after key lifecycle steps and receives a context object with `phase`, `message`, `history`, and `store`

Current runtime namespace:

- `store.js` also registers `space.onscreenAgent`
- `store.js` also publishes the active overlay thread snapshot at `space.chat`, including `messages`, live `attachments` helpers for the current surface, the current-turn `promptItems` metadata list, `readLongMessage({ id, from, to })` for trimmed prompt contributors, and a non-persisted `transient` registry for mutable prompt context blocks that should be emitted as a separate trailing prepared `_____transient` message
- prepared user messages with attachments should append one compact helper block that uses `Chat runtime access↓` for the runtime-access notes and `Attachments↓` before the attachment rows, so multiline helper data is visibly framed as continuing below each label
- `space.onscreenAgent.show(options?)` opens the overlay, first reveals any persisted edge-hidden peeking pose back to the in-screen threshold position, and preserves the current display mode unless `options.mode` explicitly requests compact or full
- `space.onscreenAgent.submitPrompt(promptText, options?)` opens the overlay, first reveals any persisted edge-hidden peeking pose back to the in-screen threshold position, seeds the composer, and submits or queues the prompt through the owned send loop while preserving the current display mode unless `options.mode` explicitly requests compact or full
- `space.onscreenAgent.submitExamplePrompt(promptText, options?)` is the guarded preset-button variant for spaces and similar launchers: it opens the overlay, refuses to queue into an already busy send loop, shows `Don't forget to configure your LLM first.` through the overlay bubble when the composer is blocked by the default API-key warning, shows `I'm working on something...` when the overlay is already sending or executing or compacting, keeps that preset notice from being immediately overwritten by compact streaming reply bubbles, and only then seeds the composer and submits the prompt while preserving the current display mode unless `options.mode` explicitly requests compact or full
- `space.onscreenAgent.showExamplePromptInactiveBubble(options?)` opens the overlay if needed and shows the current blocker bubble without attempting to seed or submit a prompt; callers can use it directly when they already know the example prompt is inactive
- the same blocker rules also live on the global Alpine `onscreenAgent` store as derived getters: `isExamplePromptInactive`, `canSubmitExamplePrompt`, `examplePromptInactiveReason`, and `examplePromptNoticeText`; other modules should read those getters through the existing global store instead of duplicating blocker logic
- the global Alpine `onscreenAgent` store also exposes `showExamplePromptInactiveBubble(options?)`, mirroring the namespace helper for code that is already working against `$store.onscreenAgent`

Current `processOnscreenAgentMessage` phases:

- `submit`: a user draft was converted into the first outbound message
- `assistant-response`: a streamed assistant reply finished, or a stopped reply produced partial content, before metrics and persistence run
- `execution-output`: browser execution results were converted into the follow-up user message; even successful no-return executions stay in this phase instead of triggering a missing-result correction turn
- `protocol-retry`: the overlay is generating a generic empty-assistant protocol-correction retry message
- `history-compact`: history compaction produced the replacement summary message

Phase-specific context fields may include `draftSubmission`, `responseMeta`, `executionResults`, `executionOutputMessage`, or compaction `mode`.

### Overlay Contract

Current overlay behavior:

- the module mounts only through the router overlay seam at `page/router/overlay/end`
- the shell supports compact and full display modes
- avatar drag positioning, edge-hide peeking, action menus, history-edge resizing, and visibility recovery are owned by `store.js`
- `panel.html` passes `shell`, the `avatar` button, the full-size `avatarVisual` bounds wrapper, panel, thread, and dialog refs into `store.js`; hidden-edge math, visibility recovery, and viewport clamping must follow the rendered `avatarVisual` bounds, and on fine-pointer desktops the visible astronaut and its drag hitbox should stay the same size so the image cannot drift away from the interactive box
- dragging the avatar past the left, right, or bottom viewport edge should first hit a dead zone at the in-screen clamp that matches the reveal-threshold distance so corner placement stays possible, then snap the shell into a browser-persisted `hidden_edge` pose after the pointer crosses that dead zone; top-edge hiding is disabled, the astronaut rotates clockwise on the left edge, counterclockwise on the right edge, and upright on the bottom edge while preserving the normal right-side flip, and the shell should keep one uniform hidden-edge inset percentage with roughly 60 percent of the astronaut still visible; the astronaut image should stay shadowless in every state so edge hides match the in-screen silhouette
- while hidden on an edge, dragging should keep the astronaut attached to that edge until the pointer crosses back past the in-screen reveal threshold; a click on the hidden astronaut should slide it back to that threshold position and restore the previously active compact or full chat body
- the full-mode history subtree mounts only in full mode; compact mode does not keep a history container mounted
- the full-mode history uses a non-scrolling outer shell for placement, chrome, and the resize grip, with an inner scroller that owns thread overflow
- in full mode, the history panel can be resized vertically from a full-width invisible handle that straddles the outer top or bottom border based on orientation, while a centered grip marks the draggable edge and the chosen height persists in browser UI state
- when that full-mode history is rendered above the avatar, its fitted or resized height must reserve the active fixed top-shell chrome instead of shrinking only against the raw viewport top; `store.js` should prefer the rendered onscreen-menu bar bottom and keep the usual top breathing room so the history starts compressing before it collides with the fixed menu bar
- compact-to-full and full-to-compact switches should animate at the shell chrome layer: `store.js` owns a short display-mode transition phase, while `onscreen-agent.css` animates body width, panel chrome, and full-mode history entry so the overlay expands or settles instead of snapping; the collapse animation should keep the compact composer anchored and at its final scale instead of introducing a late positional or size snap when the phase clears
- when full mode mounts or the viewport changes, the store keeps the raw persisted history height instead of rewriting it to the current viewport fit; the rendered height is clamped against the currently available space on that side so reloads preserve the chosen size while smaller screens still fit
- the compact and full composer panels accept attachments from either the file picker or direct file drag-and-drop onto the chat box
- keyboard submit from the composer textarea and the form submit path may send a new message or queue a follow-up draft, but they must never trigger `requestStop()`; stopping the active loop stays an explicit primary-button click only
- saved browser UI state for `agent_x`, `agent_y`, optional `hidden_edge`, `history_height`, and `display_mode` is loaded during init before the overlay finishes mounting, and the floating shell stays unmounted until that startup load has resolved so refreshes never flash the default bottom-left position before the stored coordinates and peeking state are applied
- the first shell paint should ease in with a short reveal once startup positioning is ready, but avoid ancestor opacity fades on the shell itself because they break the backdrop blur used by the history and composer surfaces
- internal startup statuses such as prompt bootstrapping may gate controls, but they should not replace the composer placeholder because they are not user-relevant; caught runtime errors must be logged through `console.error` and surfaced through the shared toast runtime instead of raw composer-placeholder text, while action results may still surface through `status`
- when the persisted LLM settings still match the shipped defaults and the API key is blank, the composer blocks the full textarea area with a blurred overlay and centered `Set LLM API key` action until credentials are configured
- the composer textarea itself should stay visually borderless in both compact and full modes; neutralize native textarea chrome and any shared focus outline locally instead of adding a nested input frame inside the overlay panel
- in compact mode, the floating UI bubble should stream the assistant reply live during the response without waiting for completion, but UI updates may be coalesced to animation frames and must render only the text before the execution separator
- compact-mode bubble streaming must suppress a trailing partial execution marker such as `_____` while the separator is still arriving, and once `_____javascript` appears it must ignore that marker and everything after it
- when the shell is restored into an edge-hidden pose, the collapsed chat body may stay mounted for layout continuity but its hidden panel and history surfaces must not remain hit-testable or capture page scrolling while invisible; only the visible avatar and any allowed hint bubble may keep interaction
- the avatar button remains the only persistent hit target when the shell body is absent or hidden, but wheel or trackpad scroll that lands on the astronaut hitbox must proxy through to the underlying page or widget surface instead of trapping viewport scrolling on the overlay's transparent avatar box, and its drag-specific `touch-action` lock must stay limited to coarse-pointer touch devices so fine-pointer desktops keep native scroll gestures
- after mount and after browser UI state load, the store re-clamps the saved position to the current viewport and persists any correction back to both browser storage tiers
- while mounted, the store also re-checks visibility on resize, `visibilitychange`, `focus`, `pageshow`, and on a periodic timer so monitor changes or desktop switches cannot leave the astronaut permanently off-screen
- the onboarding hint `**Drag** me, **tap** me.` now starts only from overlay mount timing, never from page load; `store.js` starts the 2-second countdown during `mount`, then auto-hides the hint 3 seconds after it becomes visible
- that startup hint is a dedicated `panel.html` bubble controlled by `isStartupHintVisible`, not a generic `showUiBubble(...)` message; keep it isolated from assistant-bubble lifecycle, markdown rendering, auto-hide timing, and hidden-edge suppression
- that startup hint may render even when the overlay restored into a persisted edge-hidden pose
- only real trusted shell `pointerdown` events may dismiss that startup hint early for the current page session; otherwise it resolves through its own 3-second visible timeout, and hint-specific interaction bookkeeping should stay out of unrelated controls or mode helpers
- browser execution blocks use the `_____javascript` separator and are executed locally through `execution.js`
- the surface uses the shared `createAgentThreadView(...)` renderer from `_core/visual/conversation/thread-view.js`
- overlay history relies on the shared thread bubble sizing rules; user messages must wrap long lines inside their own bubble so the history scroller stays width-stable and does not gain a horizontal scrollbar from chat text alone
- `view.js` enables the shared marked-backed chat-bubble markdown renderer for settled assistant responses in the overlay, keeps submitted user bubbles on plain pre-wrapped text so typed blank lines stay literal, assigns the `onscreen-agent-response-markdown` class so assistant-response-specific heading and table tuning stays local to this module, and opts the overlay thread into consecutive-avatar grouping so only the first rendered row in a same-speaker run shows the user or agent avatar
- `panel.html` loads `response-markdown.css` after the base overlay stylesheet; keep assistant-response markdown element overrides there instead of patching `_core/visual` for overlay-only presentation, and style markdown tables through the shared `.message-markdown-table-wrap` wrapper rather than changing the table element into a scroll container
- the full-mode `data-chat-thread` subtree is renderer-owned DOM, not Alpine-owned UI; `panel.html` should keep Alpine click wiring on the surrounding scroller, mark the chat-thread node with `x-ignore`, and keep mode-switch animation on the surrounding shell or panel chrome instead of remounting, fading, or transforming the thread subtree during live updates
- the compact floating UI bubble is a separate overlay surface owned by `panel.html`, `store.js`, and `onscreen-agent.css`; it should render through the shared markdown helper into a local content ref instead of using plain `x-text`
- in compact mode, that floating assistant or notice bubble doubles as the expand control; activating it should switch the overlay into full mode with the same focus and bubble-dismiss behavior as clicking the astronaut, while the separate startup hint bubble stays non-interactive
- `store.js` owns the compact bubble singleton lifecycle; `showUiBubble(...)` returns a bubble instance whose `update(...)` method only mutates the currently active bubble, recalculates auto-hide from the updated text length, and can reopen that same bubble after auto-hide until a newer bubble instance replaces it
- UI bubble lifecycle checks must match bubbles by a stable bubble-owned id rather than strict object identity because Alpine reactivity may proxy the stored active-bubble handle before later `update(...)` or `dismiss(...)` calls arrive from external helpers such as `showExamplePromptInactiveBubble(...)`
- native dialogs use the shared dialog helpers from `_core/visual/forms/dialog.js`
- lightweight action menus use the shared popover positioning helper from `_core/visual/chrome/popover.js`
- the floating root and its compact action menu reserve effectively topmost z-index bands so routed content and dynamically rendered surfaces do not obstruct the overlay controls
- the compact composer action menu stays hidden through its initial positioning passes, closes when avatar dragging starts, and chooses up or down placement from the trigger button midpoint against the 50% viewport line rather than reusing the UI bubble breakpoint
- history-destructive controls must stay disabled when the thread is empty: full-mode footer `Clear chat`, full-mode footer `Compact context`, and compact-mode action-menu entries for those same actions should all be unavailable until history exists
- the loop supports queued follow-up submissions, stop requests, attachment revalidation, and animation-frame streaming patches; a queued follow-up must not preempt a just-finished assistant response that contains `_____javascript`, because the runtime must execute that block and serialize the resulting `execution-output` turn before the queued draft is sent; streamed execution cards must update their existing DOM in place so expanded details panes remain usable while tokens continue arriving, stable narration or other settled execution-card subtrees must not be recreated on each delta, completed execution rows must remain separate from later assistant turns so a new streamed reply only touches the live row, ordinary history renders must reuse unchanged keyed rows instead of rebuilding the whole thread, thread scroll should keep following while the user remains near the bottom and should decouple only after the user has scrolled up, and only when that direct patch cannot apply should the full-mode thread fall back to a frame-batched local rerender of the affected suffix
- full-mode streaming should not churn Alpine-owned composer placeholder or status bindings on each delta; live token updates belong in the renderer-owned thread only
- `store.js` should hold one prompt-instance object per chat surface, rebuild full prompt input when the overlay boots or the thread is reset or a new LLM turn is about to start, and reuse the cached system or examples or transient sections without recomputing the full prepared payload or token counts on every streamed delta
- prompt-history previews and token counts are derived from the prepared outbound request payload so request-prep extensions stay visible in the context window instead of only affecting the final fetch call, but exact recomputation should happen only at stable boundaries such as request preparation, stop handling, or settled assistant completion, never on every streamed delta
- the settings modal and prompt-history modal must both use the shared fixed-chrome dialog shell from `_core/visual/forms/dialog.css` so their header and footer rows stay static while only the settings form body or prompt-history frame scrolls
- the settings modal keeps a provider switch with exactly two tabs named `API` and `Local`; API settings show endpoint, model, and API key fields, while local settings mount the shared `_core/huggingface/config-sidebar.html` component in `onscreen` mode
- local provider settings are limited to the shared Hugging Face browser runtime for now; the overlay subscribes to `_core/huggingface/manager.js`, reads the same saved-model list and live worker state as the routed Local LLM page, and should not boot the worker just because the modal opened
- when no Hugging Face model is selected and the shared saved-model list has entries, the overlay local-provider panel should preselect the browser-wide last successfully loaded saved model from `_core/huggingface/manager.js`, falling back to the first saved entry if that last-used entry was discarded
- when no Hugging Face model is selected, no model is loaded, and the shared saved-model list is empty, the overlay local-provider panel should prefill the model field with the same default used by the routed testing page: `onnx-community/gemma-4-E4B-it-ONNX`
- saving local settings must persist the selected Hugging Face repo id and dtype, then start background model preparation; the first local send remains the fallback load trigger if that preparation has not finished
- local-provider sends should use the same prompt assembly path as API sends, including the full firmware prompt, prompt-include sections, skill catalog, auto-loaded skill context, custom instructions, history, and transient context; the routed `_core/huggingface` testing page remains the first-party plain system-prompt-only local-LLM surface
- local-provider sends should reuse the same final transport message payload that the API path sends upstream; `requestBody.messages` is the local runtime input, while the richer prepared prompt entries remain the prompt-history inspection surface
- when the overlay is about to send through the local provider and the configured local model is not ready, the status should read `Loading local LLM...`; once text deltas arrive, normal streaming status and compact-bubble updates take over
- the default API-key overlay should only block the composer for the API provider when the shipped API defaults are still selected and no API key is configured; local Hugging Face mode does not require the API-key blocker
- the prompt-history modal must show the exact prepared message payload before the final transport-only consecutive-role fold, including example messages, any prepared `_____user` or `_____framework` blocks, and any separate trailing `_____transient` message
- the prompt-history modal footer owns prepared-payload navigation and copy helpers: it should be implemented as one outer footer row with exactly two inner groups, one left and one right, so the three navigation buttons stay on the left edge and the four copy or close buttons stay on the right edge; it should reuse the shared compact modal button treatment from `_core/visual/forms/dialog.css` instead of reintroducing large pill-style modal controls locally, keep all footer controls on the same fixed compact button width so icon-bearing buttons do not outgrow `Close`, jump across prepared real-user `_____user` blocks rather than every user-role message, pin the targeted prepared message to the top of the history scroller on every jump, label example turns as `EXAMPLE USER` or `EXAMPLE ASSISTANT` in text mode, and copy system-only, history-only, or full prepared-payload slices using the currently selected text or JSON mode, with the history-only slice limited to actual live or compacted history entries and excluding example or transient prompt context
- text mode may render per-message sections for scanning, but JSON mode must stay a single raw prepared-payload block that remains mouse-selectable and copyable; real-user jump controls should still land on the same prepared message indexes in both modes, using line-based scrolling for the raw JSON view
- model-facing helper outputs should prefer compact flat text over JSON when the agent only needs a lightweight catalog or status list, because token stability matters more than shape richness in overlay history
- `execution.js` owns the execution transcript contract: successful no-return runs must emit `execution returned no result and no console logs were printed`; console-log blocks should use `log↓`, `info↓`, `warn↓`, `error↓`, `debug↓`, `dir↓`, `table↓`, or `assert↓`; result blocks must print `result↓` on its own line before the raw returned text; structured console-log payloads and structured result payloads should prefer `space.utils.yaml.stringify(...)` over JSON when the lightweight YAML helper can serialize them so history stays smaller; the live thread UI should retain full execution snapshots for the freshest execution result; and persisted execution-output turns should stay text-stable instead of being rewritten later with truncation markers or omission summaries
- `_core/onscreen_agent/store.js/evaluateOnscreenAssistantMessage` is the extension seam that evaluates a settled assistant message immediately before execution results are serialized back into the `execution-output` follow-up turn; `_core/agent-chat` currently provides the first-party repeated-message detector there, emitting loop notices on the 2nd exact assistant-message send as `info`, on the 3rd send as `warn`, and on the 4th send onward as `error`
- no-result execution output is informational only; the loop must forward it as a normal `execution-output` turn and must not synthesize a missing-result protocol-correction message
- when any turn returns no assistant content, the runtime retries the same request once automatically before sending a generic protocol-correction user message
- empty-response protocol-correction messages must stay short and should tell the agent to continue from the conversation above instead of depending on a specific prior turn type such as execution output
- `space.skills.load("<path>")` loads onscreen skills on demand using skill ids relative to `ext/skills/` and excluding the trailing `/SKILL.md`
- only top-level skills are injected into the prompt catalog by default; routing skills can direct the agent to deeper skill ids
- auto-loaded skill discovery is top-level only: only `ext/skills/*/SKILL.md` entries are eligible for prompt-time auto-injection, while nested skills stay explicit-load-only routing targets
- loaded onscreen skills are captured as execution-side effects even when the JavaScript block uses plain `await space.skills.load(...)` without a final `return`; `history` placement emits the full skill body into the execution-output turn, while `system` and `transient` placements emit only `skill loaded to system message` or `skill loaded to transient area` and register the skill in the non-persisted runtime prompt context instead
- on-demand loaded skill content reaches model context through `skills.js`, `execution.js`, and the runtime prompt registry: `history` placement enters ordinary history, while `system` and `transient` placements are injected by `llm.js` into later requests
- successful history-placed skill loads are still read-stage control signal: when the task that asked for the skill remains open, the next move should use the loaded skill or the workflow it taught instead of loading the same skill again, and user pushes that say load it again after a successful load should normally be interpreted as use-the-skill-now pressure unless the user explicitly asks only for a reload
- when the user names a skill loosely, the prompt should resolve that request to the exact catalog or loaded-skill id rather than inventing a shorter alias
- skill discovery uses the app-file permission model plus layered owner-scope ordering, and same-module layered overrides replace lower-ranked skill files before the catalog is built
- readable group-scoped modules such as `L0/_admin/mod/...` may contribute additional onscreen skills; those skills are visible only to users who can read that group root
- skill ids must be unique across readable modules; conflicting ids are omitted from the prompt catalog and load attempts fail with an ambiguity error

## Work Guidance

### Local Work Rules

- keep overlay-specific behavior local to this module
- do not import admin-agent internals for convenience
- use the router overlay seam rather than reaching around the router shell
- do not preserve compatibility shims inside this module just to keep old local helper paths alive; when ownership moves, update callsites and extension docs to the new canonical seam instead of maintaining mirrored prompt or request paths
- when another module needs to change overlay prompt, skill, request, or message behavior, add or consume the local JS seams here instead of reaching into private store state from outside the module
- keep `_core/onscreen_agent` generic: do not add task-specific execution validators, helper workflows, or module-owned prompt rules here when the owning module can supply them through `ext/js/` or skills
- keep onscreen skill discovery and runtime behavior separate from the admin agent even when copying skill content for starter coverage
- keep overlay-local Hugging Face glue limited to snapshot shaping, settings state, and calls into the shared `_core/huggingface/manager.js`; do not fork a second Hugging Face worker or import admin-agent local-provider helpers
- keep `ext/skills/development/` aligned with the current frontend and read-only backend contracts so the onscreen agent's development guidance does not drift
- keep prompt-surface strings lean: prefer `id|name|description` rows, short block labels, and body-only auto-loaded skill text over verbose wrappers
- if behavior becomes meaningfully shared with the admin agent, promote it into `_core/framework` or `_core/visual` instead of creating cross-surface dependencies
- if overlay runtime, prompt construction, execution protocol, or skill loading changes, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/agent/`
- if you change the router overlay contract, persistence paths, skill discovery, or prompt execution behavior, update this file and the relevant parent docs in the same session

## Verification



## Child DOX Index

- `/app/L0/_all/mod/_core/onscreen_agent/prompts/AGENTS.md` - prompts/ owns the model-facing prompt files for _core/onscreen_agent/
