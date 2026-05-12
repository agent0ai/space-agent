# Admin Agent Runtime

This doc covers the firmware-backed admin agent surface under `_core/admin/views/agent/`.

Primary sources:

- `app/L0/_all/mod/_core/agent-chat/AGENTS.md`
- `app/L0/_all/mod/_core/agent_prompt/AGENTS.md`
- `app/L0/_all/mod/_core/agent_prompt/prompt-runtime.js`
- `app/L0/_all/mod/_core/admin/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/skills.js`
- `app/L0/_all/mod/_core/admin/views/agent/store.js`
- `app/L0/_all/mod/_core/admin/views/agent/api.js`
- `app/L0/_all/mod/_core/admin/views/agent/prompt.js`
- `app/L0/_all/mod/_core/onscreen_agent/llm.js`
- `app/L0/_all/mod/_core/open_router/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/huggingface.js`
- `app/L0/_all/mod/_core/admin/views/agent/panel.html`

## Scope

The admin agent is a standalone admin-only chat surface mounted inside `/admin`.

It owns:

- its own settings and history persistence under `~/conf/admin-chat.yaml` and `~/hist/admin-chat.json`
- its own history compaction, execution loop, provider settings, and attachment runtime
- its own LLM transport switch between remote API streaming and the browser-local Hugging Face provider

It now reuses the same standard prepared prompt builder as the onscreen agent, through shared `_core/agent_prompt/prompt-runtime.js` plus the standard builder callbacks in `_core/onscreen_agent/llm.js`. The only admin-specific prompt-shaping difference is that admin appends custom user instructions at the end of the assembled standard system prompt.
That shared prompt runtime caches only plain structured prompt-input data. Runtime-only objects such as prompt instances must be stripped before caching so prompt-history previews, retry preparation, and other clone-heavy paths stay safe.

The stored admin config keeps `api_key` encrypted at rest when `space.utils.userCrypto` is unlocked for the current browser session. Encrypted values are stored as `userCrypto:`-prefixed strings in `~/conf/admin-chat.yaml`, decrypted automatically on load, and fail soft to a blank locked field when the current session cannot decrypt them. In `SINGLE_USER_APP=true`, `space.utils.userCrypto` bypasses encryption entirely, so new `api_key` values stay plaintext and no `userCrypto:` wrapper is added, but any legacy wrapped value from an older non-single-user build still loads as a blank locked field until the user replaces or clears it.

The shared thread view keeps settled admin assistant replies markdown-rendered, but submitted user bubbles stay plain pre-wrapped text so typed blank lines display literally instead of expanding into markdown paragraph gaps.
That shared history styling resets rendered markdown bubbles back to normal white-space so parser formatting newlines between tags do not show up as visible blank lines, and it also collapses direct block margins inside list items so loose markdown bullets do not render blank-line-sized gaps between entries.
The admin agent's empty-state astronaut, thread avatar helmet, and admin-shell launcher avatar now all resolve through the shared authenticated-app artwork folder at `/mod/_core/visual/res/chat/admin/`. Repo-owned app image assets should stay under `_core/visual/res/`, not under `_core/admin/`.
Caught admin runtime failures are logged through `console.error` in addition to any status-line copy shown in the surface, so debugging no longer depends on the composer or placeholder text alone.
Admin execution transcripts now match the overlay contract for both console logs and returned values: structured payloads use the same YAML-first serializer, console output is emitted through block headers such as `log↓` or `warn↓`, and returned values use `result↓`, with JSON only as the fallback when the lightweight YAML helper cannot serialize the shape. Immediately before those execution results are serialized into the admin `execution-output` follow-up turn, the admin store also runs the shared assistant-message evaluation seam; the current first-party hook from `_core/agent-chat` prepends synthetic loop warnings when the exact same assistant message reappears, using `info` on the 2nd send, `warn` on the 3rd send, and `error` on the 4th send onward.

## Skill Discovery

The admin agent now uses the same shared browser-side skill helper as the onscreen agent:

- top-level catalog entries come from readable `mod/*/*/ext/skills/*/SKILL.md`
- the shared helper reads the current document's `<x-context>` tags before deciding which skills are eligible
- framework bootstrap also contributes exactly one runtime context before that read: `data-runtime="browser"` for normal web sessions or `data-runtime="app"` in the packaged desktop runtime, plus the derived tag `runtime-browser` or `runtime-app`
- the admin shell exports `admin`, so admin-owned skills may require `metadata.when.tags: [admin]`, while onscreen-only skills gated by tags such as `onscreen` or `browser:open` stay unavailable here
- `metadata.when` and `metadata.loaded` both accept either `true` or a `{ tags: [...] }` condition, so admin skills use the same live page-tag matcher for catalog visibility and automatic prompt inclusion
- `metadata.loaded` works here too, so the admin prompt can append the matching auto-loaded skill context without hardcoding specific skill ids; those auto-loaded skills may resolve only to `system` or `transient`, with `system` as the fallback
- the first-party `memory` skill is one of those auto-loaded system skills and teaches prompt-include-backed user memory under `~/memory/`
- `space.admin.loadSkill("path")` loads a matching `ext/skills/.../SKILL.md` file on demand
- `space.skills.load("path")` is mirrored to that same loader so the shared standard prompt contract can keep the same load hint text on both surfaces

Manual loads follow the same placement rule as the onscreen agent: `history` placement enters normal execution-output history, while `system` and `transient` placement register the skill in runtime prompt context and report the short load result text instead of pasting the full body into history.

## Provider Model

The admin settings modal now starts with a provider switch:

- `API`: the existing endpoint, model, API key, params, and max-token settings
- `Codex`: an OAuth-authenticated path that uses an existing OpenAI ChatGPT Plus subscription instead of an API key. See `app/L0/_all/mod/_core/openai_codex/AGENTS.md` for the request rewrite, token storage, and proxy-routing contract
- `Local`: a browser-local Hugging Face path that uses Transformers.js on WebGPU

Below those provider-specific sections, the shared settings area also exposes `max_tokens`, prompt-budget ratios for `system`, `history`, and `transient`, plus the separate single-history-message ratio used by the shared trimming path. Those values are persisted in `prompt_budget_ratios` and feed the same prompt-budget builder used by the onscreen agent: prepared entries and prompt items reuse cached token counts, single live history messages are capped first, contributor-level trims must each be at least `250` tokens, and `system` or `transient` falls back to one combined section-body trim when smaller contributor cuts would otherwise be required.

When no local model is selected and saved models exist, the admin local panel preselects the browser-wide last successfully loaded saved model from `_core/huggingface/manager.js`, falling back to the first saved entry if that last-used entry was discarded. When no local model is selected, no local model is loaded, and the shared saved-model list is empty, the admin local panel prefills the Hugging Face model field with the same testing-page default: `onnx-community/gemma-4-E4B-it-ONNX`.

The stored config keeps both API settings and the selected local provider state:

- `llm_provider`
- `local_provider`
- `huggingface_model`
- `huggingface_dtype`
- `prompt_budget_ratios`
- the existing API fields and optional custom system prompt

Switching providers does not fork the rest of the admin agent loop. The admin surface still keeps one shared flow for:

- runtime prompt building
- history compaction
- retry-on-empty handling after execution follow-ups
- browser execution blocks
- streaming into the thread view

Only the final LLM transport call branches.

For remote API mode, `views/agent/api.js` now finalizes the upstream request through extension seam `_core/admin/views/agent/api.js/prepareAdminAgentApiRequest`. Provider-specific request policy such as OpenRouter headers belongs in headless helper modules like `_core/open_router`, so the admin runtime keeps only the generic fetch path plus the prepared request object.

## Local Runtime Layer

The admin agent does not fork a second Hugging Face worker.

Instead:

- `_core/huggingface/manager.js` owns worker boot, model load or unload, saved-model state, generation streaming, and stop behavior
- `views/agent/huggingface.js` shapes the manager snapshot for admin UI bindings
- `views/agent/api.js` calls the shared manager directly for local-mode chat and compaction
- `panel.html` mounts `/mod/_core/huggingface/config-sidebar.html` in `admin` mode so the admin modal and the routed Local LLM page share one sidebar component contract

## Local Provider Behavior

- accepts a direct Hugging Face repo id plus dtype in the admin modal and can load that selection through the shared manager without forcing the user through the routed test page first
- also shows shortcut entries from the shared browser-side saved-model list exposed by `_core/huggingface/manager.js`
- reads the same live load state, current model, and progress data as the routed `/#/huggingface` surface instead of booting a second in-page Hugging Face worker
- admin load or unload or send actions should call `_core/huggingface/manager.js` directly, so the model-selector actions and admin chat transport use the exact same shared manager path as the routed testing page
- local admin sends use the same full prepared prompt that API mode uses, so provider switches do not fork examples, skills, prompt includes, history shaping, or transient context
- opening the admin settings dialog should not auto-boot the Hugging Face runtime or auto-load the saved Hugging Face model; admin may refresh saved-model shortcuts, but the actual model load stays lazy until explicit load or first send
- the last-used saved-model preselection is browser-wide local storage rather than admin config, and it only fills a blank local-provider draft
- keeps a separate selected-model line in the modal so the configured repo and dtype remain visible even while no model is currently loaded
- mirrors the routed page's phase labels, so file transfer reads as `Downloading` and post-download runtime preparation reads as `Loading` instead of presenting a misleading all-purpose loading state
- treats `Starting` as an explicit shared-manager boot-in-progress state; when the manager is idle and no local load is active, the admin modal should show `Idle` rather than inferring startup from a generic non-ready snapshot
- that saved-model list is populated when a model is loaded successfully through the shared manager, including loads started from `/#/huggingface`
- discarding a cached Hugging Face repo in `/#/huggingface` also removes the corresponding shared saved-model entries, so the admin selector stops offering that repo until it is loaded again
- saving the config no longer requires the model to already exist in that saved-model list; admin now kicks off background load for the configured local model on save and on page init when local mode is already active, while the first admin send still acts as the fallback load trigger if preparation has not finished yet
- links out to `/#/huggingface` for fuller testing-chat work, not as the only load path

This means the admin agent reuses the same shared visual assets, browser-local worker state, component contracts, and standard prepared prompt builder used by the onscreen agent, while still keeping admin persistence, transport, and shell behavior local to `_core/admin/views/agent/`.

## Practical Behavior

- if `llm_provider` is `api`, admin chat uses the existing fetch-based streaming path
- if `llm_provider` is `local`, admin chat shows `Loading local LLM...` until the configured Hugging Face model is ready, and then streams through the shared Hugging Face manager
- stop requests use the same admin stop flow; the Hugging Face manager translates that abort into the appropriate worker-side stop or teardown behavior
- history compaction uses the selected provider too, so local mode stays fully local once configured

## Style Isolation

The admin shell mounts the admin tabs together, including the agent, Files, Time Travel, and Modules tabs.

When the mirrored admin topbar inject host above the tab content is unused, it should collapse completely instead of reserving a phantom layout row. The admin agent depends on that shell behavior so its composer stays pinned to the bottom edge of the admin pane and only the thread history scrolls.

Admin-agent CSS may tune shared visual primitives for the agent surface, but those selectors must stay scoped under `.admin-agent-root`. Unscoped rules for `.secondary-button`, `.primary-button`, `.confirm-button`, or related visual primitives will leak into other admin panels that reuse the same shared component stack.
