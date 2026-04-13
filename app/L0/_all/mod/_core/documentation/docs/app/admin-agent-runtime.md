# Admin Agent Runtime

This doc covers the firmware-backed admin agent surface under `_core/admin/views/agent/`.

Primary sources:

- `app/L0/_all/mod/_core/admin/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/skills.js`
- `app/L0/_all/mod/_core/admin/views/agent/store.js`
- `app/L0/_all/mod/_core/admin/views/agent/api.js`
- `app/L0/_all/mod/_core/open_router/AGENTS.md`
- `app/L0/_all/mod/_core/admin/views/agent/huggingface.js`
- `app/L0/_all/mod/_core/admin/views/agent/panel.html`

## Scope

The admin agent is a standalone admin-only chat surface mounted inside `/admin`.

It owns:

- its own settings and history persistence under `~/conf/admin-chat.yaml` and `~/hist/admin-chat.json`
- its own prompt assembly, history compaction, execution loop, and attachment runtime
- its own LLM transport switch between remote API streaming and the browser-local Hugging Face provider

It does not depend on `_core/onscreen_agent` internals.

## Skill Discovery

The admin agent now uses the same shared browser-side skill helper as the onscreen agent:

- top-level catalog entries come from readable `mod/*/*/ext/skills/*/SKILL.md`
- the shared helper reads the current document's `<x-skill-context>` tags before deciding which skills are eligible
- the admin shell exports `admin`, so admin-owned skills may require `metadata.when.tags: [admin]`
- `metadata.just_loaded` works here too, so the admin prompt can append a `just loaded` block without hardcoding specific skill ids
- `space.admin.loadSkill("path")` loads a matching `ext/skills/.../SKILL.md` file on demand
- admin skill discovery is still firmware-clamped because `views/agent/skills.js` resolves those skill paths with explicit `maxLayer=0`

That means admin execution can still use normal app-file APIs across L0, L1, and L2 for operational work, while the prompt-facing skill catalog and skill bodies remain uninfluenced by writable customware layers.

## Provider Model

The admin settings modal now starts with a provider switch:

- `API`: the existing endpoint, model, API key, params, and max-token settings
- `Local`: a browser-local Hugging Face path that uses Transformers.js on WebGPU

When no local model is selected and saved models exist, the admin local panel preselects the browser-wide last successfully loaded saved model from `_core/huggingface/manager.js`, falling back to the first saved entry if that last-used entry was discarded. When no local model is selected, no local model is loaded, and the shared saved-model list is empty, the admin local panel prefills the Hugging Face model field with the same testing-page default: `onnx-community/gemma-4-E4B-it-ONNX`.

The stored config keeps both API settings and the selected local provider state:

- `llm_provider`
- `local_provider`
- `huggingface_model`
- `huggingface_dtype`
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
- local admin sends use a compact execution prompt profile instead of the full firmware prompt plus admin-skills catalog, which keeps the shared browser-local LLM path closer to the lightweight routed testing chat and avoids inflating the prompt budget unnecessarily
- opening the admin settings dialog should not auto-boot the Hugging Face runtime or auto-load the saved Hugging Face model; admin may refresh saved-model shortcuts, but the actual model load stays lazy until explicit load or first send
- the last-used saved-model preselection is browser-wide local storage rather than admin config, and it only fills a blank local-provider draft
- keeps a separate selected-model line in the modal so the configured repo and dtype remain visible even while no model is currently loaded
- mirrors the routed page's phase labels, so file transfer reads as `Downloading` and post-download runtime preparation reads as `Loading` instead of presenting a misleading all-purpose loading state
- treats `Starting` as an explicit shared-manager boot-in-progress state; when the manager is idle and no local load is active, the admin modal should show `Idle` rather than inferring startup from a generic non-ready snapshot
- that saved-model list is populated when a model is loaded successfully through the shared manager, including loads started from `/#/huggingface`
- discarding a cached Hugging Face repo in `/#/huggingface` also removes the corresponding shared saved-model entries, so the admin selector stops offering that repo until it is loaded again
- saving the config no longer requires the model to already exist in that saved-model list; admin now kicks off background load for the configured local model on save and on page init when local mode is already active, while the first admin send still acts as the fallback load trigger if preparation has not finished yet
- links out to `/#/huggingface` for fuller testing-chat work, not as the only load path

This means the admin agent reuses the same browser-local assets, worker state, and component contracts as the dedicated Local LLM testing route, while still keeping admin prompt assembly, history, and provider-selection persistence local to `_core/admin/views/agent/`.

## Practical Behavior

- if `llm_provider` is `api`, admin chat uses the existing fetch-based streaming path
- if `llm_provider` is `local`, admin chat shows `Loading local LLM...` until the configured Hugging Face model is ready, and then streams through the shared Hugging Face manager
- stop requests use the same admin stop flow; the Hugging Face manager translates that abort into the appropriate worker-side stop or teardown behavior
- history compaction uses the selected provider too, so local mode stays fully local once configured

## Style Isolation

The admin shell mounts the admin tabs together, including the agent tab and the Files tab.

Admin-agent CSS may tune shared visual primitives for the agent surface, but those selectors must stay scoped under `.admin-agent-root`. Unscoped rules for `.secondary-button`, `.primary-button`, `.confirm-button`, or related visual primitives will leak into other admin panels that reuse the same shared component stack.
