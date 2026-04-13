# AGENTS

## Purpose

`_core/admin/views/agent/` owns the admin-side agent surface.

It is a standalone admin module inside `_core/admin/`, with its own prompt files, persistence, attachments, execution loop, settings, and rendering helpers. It should not depend on `_core/onscreen_agent` internals.

Documentation is top priority for this surface. After any change under `views/agent/`, update this file and any affected parent docs in the same session.

## Ownership

This surface owns:

- `panel.html`: mounted admin agent UI
- `store.js`: main state, send loop, compaction flow, dialog control, and persistence orchestration
- `api.js`, `prompt.js`, `execution.js`, `attachments.js`, `llm-params.js`, `view.js`, and `huggingface.js`: admin runtime helpers, with `api.js` owning the API-request preparation seam `prepareAdminAgentApiRequest`
- `config.js` and `storage.js`: persisted settings and history contract
- `system-prompt.md`, `compact-prompt.md`, and `compact-prompt-auto.md`: firmware prompt files
- `skills.js`: admin skill catalog building, `just loaded` skill-body prompt sections, and `space.admin.loadSkill(...)`, all delegated through shared `/mod/_core/skillset/skills.js` with an explicit L0 clamp

## Persistence And Prompt Contract

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
- `huggingface_model`
- `huggingface_dtype`
- optional `custom_system_prompt`

Current defaults:

- provider: `api`
- local provider: `huggingface`
- Hugging Face dtype: `q4`
- API endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `openai/gpt-5.4-mini`
- params: `temperature:0.2`
- compaction threshold: `64000` tokens

Prompt rules:

- `system-prompt.md` is the fixed firmware prompt
- user-authored custom instructions are stored separately and injected under `## User specific instructions`
- `compact-prompt.md` is used for user-invoked history compaction
- `compact-prompt-auto.md` is used for automatic compaction during the loop
- the runtime prompt also appends the current admin skill catalog built from top-level readable `mod/*/*/ext/skills/*/SKILL.md` files discovered with `maxLayer=0`, filtered by the current document's `<x-skill-context>` tags
- after that catalog, the runtime appends a `just loaded` block for any readable admin-eligible skill whose `metadata.just_loaded` condition currently passes
- the API-mode fetch branch must finalize its upstream request through `api.js` seam `_core/admin/views/agent/api.js/prepareAdminAgentApiRequest`; provider-specific headers or body rewrites belong in extension modules such as `_core/open_router`, not hard-coded in the admin runtime
- `api.js` may fold consecutive prepared `user` or `assistant` payload messages into alternating transport turns with `\n\n` joins immediately before the fetch call, but that transport-only fold must not mutate stored history or prompt-history state
- the firmware prompt documents `space.api.userSelfInfo()` as `{ username, fullName, groups, managedGroups }`, and admin checks should derive from `groups.includes("_admin")`

## Execution And UI Contract

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
- local-provider sends should use a compact admin execution prompt profile instead of the full firmware prompt plus admin-skills catalog, because browser-local models should share the routed worker/runtime path without carrying the much heavier API-mode prompt budget
- save should persist the selected local model config even when the model is not loaded yet; saving local settings should also start background load or download for the configured model, while the first admin send still acts as the fallback load trigger if that preparation has not finished yet
- the local provider section exposes a button that opens the full Hugging Face testing chat route in a new tab for fuller inspection or experimentation, but that route is no longer the only place where local model preparation can happen
- the settings modal keeps `maxTokens` and `paramsText` as shared controls below the provider-specific sections so remote API and local HuggingFace use the same compaction threshold and request-params surface
- the admin agent keeps one shared prompt assembly or compaction or execution loop and branches only at the final LLM transport call between API fetch streaming and the Hugging Face manager
- `llm-params.js` delegates YAML parsing to the shared framework `js/yaml-lite.js` utility but still enforces the admin-agent-specific top-level `key: value` params contract
- `huggingface.js` should stay limited to admin-facing snapshot shaping or helper glue around `_core/huggingface/manager.js`; do not reintroduce a second admin-side Hugging Face transport path when the shared manager already owns load or unload or stream behavior
- browser execution blocks are detected by the `_____javascript` separator
- `execution.js` runs browser-side JavaScript in an async wrapper and formats console output and result values for the thread
- when an execution follow-up turn returns no assistant content, the runtime retries the same request once automatically before sending a short protocol-correction user message
- empty-response protocol-correction messages must not re-echo the prior execution output; they should tell the agent to continue from the execution output above or provide the user-facing answer
- loaded admin skills are passed through execution as typed runtime values, not pasted blindly into the prompt
- `skills.js` must keep admin skill discovery L0-clamped even though admin execution still uses normal cross-layer app-file APIs for operational tasks such as moving or editing files, and it must evaluate `metadata.when.tags` plus `metadata.just_loaded` against the admin page's live `<x-skill-context>` tags
- the surface uses the shared visual dialog helpers and shared thread renderer from `_core/visual`
- `agent.css` may customize shared visual button primitives only under `.admin-agent-root`; the admin shell mounts tab components together, so unscoped `.secondary-button`, `.primary-button`, or `.confirm-button` rules leak into other admin surfaces such as the shared Files explorer
- `view.js` enables the shared marked-backed chat-bubble markdown renderer so settled admin chat bubbles render markdown consistently with the onscreen agent
- `store.js` publishes the active admin thread snapshot at `space.chat`, including `messages` and live `attachments` helpers for the current surface
- assistant streaming is patched into the existing DOM at animation-frame cadence instead of full-thread rerenders
- prompt history token counts are tracked, shown in the UI, and used for compaction decisions
- the composer accepts attachments from either the file picker or direct file drag-and-drop onto the chat box
- the composer is disabled while compaction is actively running
- the loop supports stop requests and queued follow-up submissions
- restored attachment metadata is revalidated against current file availability

## Development Guidance

- keep all admin-agent-specific runtime logic local to this folder
- do not import `_core/onscreen_agent` internals for convenience
- prefer shared visual primitives from `_core/visual` for presentation and keep surface behavior here
- if you change persistence paths, skill discovery, execution protocol, or prompt composition, update this file and the parent admin docs
