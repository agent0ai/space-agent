# AGENTS

## Purpose

`_core/admin/views/agent/` owns the admin-side agent surface.

It keeps admin-owned persistence, attachments, execution flow, settings, and transport helpers inside `_core/admin/`, while intentionally reusing the shared `_core/agent_prompt/` prompt runtime and the standard onscreen prepared-prompt builder so admin and onscreen assemble the same system, example, history, and transient prompt shape.

Documentation is top priority for this surface. After any change under `views/agent/`, update this file and any affected parent docs in the same session.

## Ownership

This surface owns:

- `panel.html`: mounted admin agent UI
- `store.js`: main state, send loop, compaction flow, dialog control, and persistence orchestration
- `api.js`, `prompt.js`, `execution.js`, `attachments.js`, `llm-params.js`, `view.js`, and `huggingface.js`: admin runtime helpers, with `prompt.js` owning the admin wrapper around the shared prompt runtime and standard prepared-prompt builder, and `api.js` owning the API-request preparation seam `prepareAdminAgentApiRequest`
- `config.js` and `storage.js`: persisted settings and history contract
- `system-prompt.md`, `compact-prompt.md`, and `compact-prompt-auto.md`: firmware prompt files
- `skills.js`: admin skill runtime aliases, exposing both `space.admin.loadSkill(...)` and `space.skills.load(...)` through shared `/mod/_core/skillset/skills.js`
- `store.js` also owns the assistant-message evaluation seam `_core/admin/views/agent/store.js/evaluateAdminAssistantMessage`

## Local Contracts

### Persistence And Prompt Contract

Current persistence paths:

- config: `~/conf/admin-chat.yaml`
- history: `~/hist/admin-chat.json`

Current stored config fields are written in YAML as:

- `llm_provider`
- `local_provider`
- `api_endpoint`
- `api_key`
- `model`
- `params`
- `max_tokens`
- `prompt_budget_ratios`
- `huggingface_model`
- `huggingface_dtype`
- optional `custom_system_prompt`

Important persistence rules:

- `api_key` is browser-owned user config and should be stored encrypted at rest with `space.utils.userCrypto` whenever that session is unlocked
- encrypted admin API keys are stored as `userCrypto:`-prefixed strings in `~/conf/admin-chat.yaml`
- when the runtime cannot currently decrypt an existing encrypted `api_key`, load should surface the field as blank plus locked metadata instead of crashing, and save should preserve the stored ciphertext until the user explicitly replaces or clears it from an unlocked session
- in `SINGLE_USER_APP=true`, legacy `userCrypto:` API-key payloads from older non-single-user builds must also load as blank locked metadata instead of being treated as plaintext, and save should keep that stored ciphertext until the user explicitly replaces or clears it

Current defaults:

- provider: `api`
- local provider: `huggingface`
- Hugging Face dtype: `q4`
- API endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `openai/gpt-5.4-mini`
- params: `temperature:0.2`
- max tokens: `120000`
- prompt-budget ratios: `system 30`, `history 40`, `transient 30`, `singleMessage 10`

Prompt rules:

- `system-prompt.md` ships the same standard firmware prompt text used by the onscreen agent
- user-authored custom instructions are stored separately and injected under `## User specific instructions` at the end of the assembled standard shared system prompt
- `compact-prompt.md` is used for user-invoked history compaction
- `compact-prompt-auto.md` is used for automatic compaction during the loop
- the runtime prompt uses the same prepared-prompt path as the onscreen agent, including examples, top-level skill catalog injection, auto-loaded skill context, prompt includes, live history shaping, and transient message shaping
- the only admin-specific prompt-shaping difference is custom instruction placement: admin appends those user-authored instructions after the standard shared system sections instead of directly after the base firmware prompt
- `_core/memory` currently uses that normal auto-loaded system-skill channel to teach prompt-include-backed `~/memory/behavior.system.include.md`, `~/memory/memories.transient.include.md`, and optional extra `~/memory/*.transient.include.md` files; do not special-case that skill in prompt-builder code
- the API-mode fetch branch must finalize its upstream request through `api.js` seam `_core/admin/views/agent/api.js/prepareAdminAgentApiRequest`; provider-specific headers or body rewrites belong in extension modules such as `_core/open_router`, not hard-coded in the admin runtime
- `api.js` may fold consecutive prepared `user` or `assistant` payload messages into alternating transport turns with `\n\n` joins immediately before the fetch call, but that transport-only fold must not mutate stored history or prompt-history state
- the firmware prompt documents `space.api.userSelfInfo()` as `{ username, fullName, groups, managedGroups, sessionId, userCryptoKeyId, userCryptoState }`, and admin checks should still derive from `groups.includes("_admin")`

### Execution And UI Contract

Current behavior:

- the LLM settings modal keeps one provider switch at the top with tabs named `API` and `Local`, and shows either the API settings fields or one `Local` section
- the `Local` section only supports the Hugging Face browser runtime
- the toolbar LLM settings button summarizes the current selection with the configured model name only; it does not prepend provider labels such as `API`, `Local`, or `Hugging Face`
- the local section mounts the standalone Hugging Face config sidebar component through `<x-component>`, so the admin modal and the routed testing harness share the same component file instead of maintaining duplicated local-provider markup
- the admin HuggingFace panel should let users either enter a compatible repo id directly or pick from the shared saved-model list, then load or unload that selection directly from the modal while reusing the same progress block and current-model status area as the routed sidebar
- the admin local-provider panel should show the selected model separately from the currently loaded model, so an unloaded but configured selection is visible immediately instead of looking stuck on `None loaded`
- when no Hugging Face model is selected and the shared saved-model list has entries, the admin local-provider panel should preselect the browser-wide last successfully loaded saved model from `_core/huggingface/manager.js`, falling back to the first saved entry if that last-used entry was discarded
- when no Hugging Face model is selected, no model is loaded, and the shared saved-model list is empty, the admin local-provider panel should prefill the model field with the same default used by the routed testing page: `onnx-community/gemma-4-E4B-it-ONNX`
- admin-local provider inputs mounted through the shared sidebar components should write back through explicit `store.js` setter methods instead of depending on implicit nested `x-model` mutation across component boundaries
- discarding a HuggingFace repo from the routed testing harness removes it from the shared browser-side saved-model list too, so it disappears from the admin saved-model shortcut selector until it is loaded again
- admin should subscribe to `_core/huggingface/manager.js` directly, so the modal and send flow read the same live worker state, saved-model options, loading, and streaming behavior as the routed Hugging Face surface within the current browser context
- admin should not auto-load a local model merely because the modal was opened; it may read or refresh saved Hugging Face model shortcuts without booting the worker
- the admin HuggingFace current-model badge should mirror the routed page's load phases, including `Downloading` during file transfer and `Loading` during post-download runtime preparation, rather than collapsing every in-flight phase into one generic label
- the admin HuggingFace status badge and status copy must treat the shared manager's explicit boot flag as the only `Starting` signal; an idle manager with no active load should read as `Idle` even before the worker has been booted in this page
- when the admin agent is about to send through a local provider and the configured local model is not ready yet, the main status line should read `Loading local LLM...`; only once text deltas start arriving should it switch to `Streaming response...`
- local-provider sends should use the same prepared prompt that API mode uses, so provider switches do not fork prompt assembly, prompt history, or transient context handling
- save should persist the selected local model config even when the model is not loaded yet; saving local settings should also start background load or download for the configured model, while the first admin send still acts as the fallback load trigger if that preparation has not finished yet
- the local provider section exposes a button that opens the full Hugging Face testing chat route in a new tab for fuller inspection or experimentation, but that route is no longer the only place where local model preparation can happen
- the settings modal keeps `maxTokens`, shared prompt-budget controls, and `paramsText` below the provider-specific sections so remote API and local HuggingFace use the same context-budget and request-params surface
- those shared prompt-budget ratios feed the same trimming path as the onscreen agent: prepared entries and prompt items reuse cached token counts, single live history messages are capped first, contributor-level part trims must be at least `250` tokens each, and `system` or `transient` falls back to one combined section-body trim when smaller contributor cuts would be required
- the admin agent keeps one shared prompt assembly or compaction or execution loop and branches only at the final LLM transport call between API fetch streaming and the Hugging Face manager
- `llm-params.js` delegates YAML parsing to the shared framework `js/yaml-lite.js` utility but still enforces the admin-agent-specific top-level `key: value` params contract
- `huggingface.js` should stay limited to admin-facing snapshot shaping or helper glue around `_core/huggingface/manager.js`; do not reintroduce a second admin-side Hugging Face transport path when the shared manager already owns load or unload or stream behavior
- browser execution blocks are detected by the `_____javascript` separator
- `execution.js` runs browser-side JavaScript in an async wrapper; console logs and ordinary returned arrays or objects should both use the same YAML-first transcript serializer, with `log↓` or `info↓` or `warn↓` or `error↓` or related block labels for console output and `result↓` for returned values, falling back to JSON only when the lightweight YAML helper cannot serialize the shape
- `_core/admin/views/agent/store.js/evaluateAdminAssistantMessage` is the extension seam that evaluates a settled assistant message immediately before execution results are serialized into the admin `execution-output` follow-up turn; `_core/agent-chat` currently provides the first-party repeated-message detector there, emitting loop notices on the 2nd exact assistant-message send as `info`, on the 3rd send as `warn`, and on the 4th send onward as `error`
- when an execution follow-up turn returns no assistant content, the runtime retries the same request once automatically before sending a short protocol-correction user message
- empty-response protocol-correction messages must not re-echo the prior execution output; they should tell the agent to continue from the execution output above or provide the user-facing answer
- loaded admin skills are passed through execution as typed runtime values, not pasted blindly into the prompt
- `skills.js` should expose `space.skills.load(...)` for the shared prompt contract while keeping `space.admin.loadSkill(...)` as the admin-namespaced alias; skill eligibility and auto-load routing still come from shared `metadata.when`, `metadata.loaded`, `metadata.placement`, and live `<x-context>` tag evaluation
- the surface uses the shared visual dialog helpers and shared thread renderer from `_core/visual`
- `view.js` must source the empty-state astronaut plus the shared assistant helmet from `/mod/_core/visual/res/chat/admin/`; do not reintroduce duplicate admin-chat avatar files under `_core/admin/res/`
- `agent.css` may customize shared visual button primitives only under `.admin-agent-root`; the admin shell mounts tab components together, so unscoped `.secondary-button`, `.primary-button`, or `.confirm-button` rules leak into other admin surfaces such as the shared Files explorer
- `view.js` enables the shared marked-backed chat-bubble markdown renderer for settled admin assistant responses while keeping submitted user bubbles on plain pre-wrapped text so typed blank lines stay literal, matching the shared thread-view contract used by the onscreen agent
- `store.js` publishes the active admin thread snapshot at `space.chat`, including `messages`, live `attachments` helpers for the current surface, the current-turn `promptItems` metadata list, and `readLongMessage({ id, from, to })` for trimmed prompt contributors
- caught admin runtime errors should be logged through `console.error`; status text may still surface the user-facing message, but raw failures must not disappear into the composer placeholder alone
- assistant streaming is patched into the existing DOM at animation-frame cadence instead of full-thread rerenders
- prompt history token counts are tracked, shown in the UI, and used for compaction decisions
- the composer accepts attachments from either the file picker or direct file drag-and-drop onto the chat box
- the admin composer textarea should stay visually borderless while focused; neutralize any shared app-shell focus outline locally inside this surface instead of drawing an input ring around the chat box
- the composer is disabled while compaction is actively running
- the loop supports stop requests and queued follow-up submissions
- restored attachment metadata is revalidated against current file availability

## Work Guidance

### Local Work Rules

- keep all admin-agent-specific runtime logic local to this folder
- shared prompt-instance lifecycle belongs in `_core/agent_prompt/`; reusing the standard prepared-prompt builder from `_core/onscreen_agent/llm.js` is intentional, but new admin-only policy should still stay local here
- prefer shared visual primitives from `_core/visual` for presentation and keep surface behavior here
- if you change persistence paths, skill discovery, execution protocol, or prompt composition, update this file and the parent admin docs

## Verification



## Child DOX Index

- No child DOX docs.
