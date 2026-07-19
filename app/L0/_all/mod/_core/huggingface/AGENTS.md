# AGENTS

## Purpose

`_core/huggingface/` owns the first-party browser inference test surface for Hugging Face Transformers.js.

It provides a routed page at `#/huggingface`, keeps the browser inference runtime isolated inside a dedicated module-local worker, and exposes a compact manual chat surface for loading one Hugging Face text-generation model at a time, sending plain chat turns, stopping inference, and reporting simple throughput metrics.

Documentation is top priority for this module. After any change under `_core/huggingface/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed test page for loading Hugging Face models and chatting with them
- `config-sidebar.html`: standalone config-sidebar component used by the routed test page, the admin local-provider modal, and the onscreen-agent local-provider modal
- `ext/panels/huggingface.yaml`: dashboard panel-manifest entry for the routed Local LLM page backed by Hugging Face
- `manager.js`: singleton runtime manager for worker lifecycle, saved-model state, load or unload flow, and shared chat streaming within one browser context
- `store.js`: routed page store that mirrors the shared manager state and owns only page-local chat UI behavior
- `huggingface-worker-bootstrap.js`: tiny bootstrap worker that catches heavy worker import/startup failures and exposes them back to the page as protocol messages before rethrowing
- `huggingface-worker.js`: dedicated runtime worker module that loads Transformers.js, downloads model assets, runs text generation, streams deltas, and handles stop requests
- `helpers.js`: shared model-normalization, persistence-shaping, conversation-shaping, and metric-formatting helpers used by the page and worker
- `protocol.js`: stable message names between the routed page and the worker
- `huggingface.css`: page-local layout and chat styling
- `transformers.js`: the module-local shim that re-exports the vendored browser runtime for this route
- `vendor/`: vendored upstream browser runtime files, currently including the locally built `transformers.web.js` file plus the minimal ONNX Runtime WebGPU bundle and wasm sidecar it needs

## Local Contracts

### Local Contracts

Current route contract:

- the test route is `#/huggingface`
- `ext/panels/huggingface.yaml` should continue to advertise this route through the shared dashboard panels index as `Local LLM`, using the shorthand manifest path `huggingface`
- the page is browser-only and should not require backend API changes
- the routed page is intentionally a compact, low-chrome manual test surface, not a general agent runtime
- `view.html` should import the config sidebar through `<x-component path="/mod/_core/huggingface/config-sidebar.html" mode="testing">` instead of inlining that sidebar markup directly
- the same `config-sidebar.html` file should also support `admin` and `onscreen` modes used inside the admin agent modal and onscreen-agent modal, where it renders a direct repo-id input, dtype selector, saved-model shortcuts, a visible selected-model summary, load or unload action, status, and testing-chat launch button against the owning chat store
- `manager.js` is the one browser-context singleton for Hugging Face runtime state; the routed page, admin agent, and onscreen agent should subscribe to it instead of booting separate Hugging Face workers in the same context
- the admin and onscreen modals may read or refresh the shared saved-model list without booting the Hugging Face worker; simply opening chat settings should not auto-start the worker or auto-reload the persisted Hugging Face model
- `manager.js` exposes startup explicitly through `isWorkerBooting`; routed, admin, and onscreen consumers should treat an unbooted idle manager as `Idle`, not as `Starting`, and should reserve `Starting` for an actual in-flight worker boot
- `manager.js` snapshots and subscription payloads must stay plain-data and clone-safe; do not leak raw browser host objects or rely on generic `structuredClone(...)` fallbacks that can fail on reactive proxies
- when the admin or onscreen local-provider draft has no selected model and saved Hugging Face models exist in browser storage, the sidebar should preselect the last successfully loaded saved model from browser-wide `localStorage`; if that stored model is no longer in the saved list, it should fall back to the first saved entry
- when the browser has no saved models, no active model, and no persisted auto-reload target, the routed testing-page model input should prefill `onnx-community/gemma-4-E4B-it-ONNX` as the empty-state suggestion; admin and onscreen chat sidebars should reuse that same empty-state default only when their selected local model is blank and there is no preferred saved-model selection
- the sidebar should surface the currently loaded model first, inside a slightly more prominent rounded panel with a larger model label, a compact right-aligned state badge, and an unload control beside the model name
- while a model is loading, that action switches to `Stop`; stopping a Hugging Face load or unload resets the shared singleton-managed worker and boots a fresh one instead of leaving stale partial state behind
- the load progress area should show a debounced aggregate download status below the bar, with total transferred bytes appended such as `Downloading model files (412 MB / 1.8 GB)` instead of rapidly alternating per-file names
- the visible progress bar should stay slightly below `100%` during final runtime preparation and only reach completion when the model is actually ready, so long pipeline-finalization phases do not look stalled after a fake finish
- when byte counts are available from the runtime callback, the progress bar fill should track the aggregate `loaded / total` bytes across all known file downloads instead of the less stable per-file `progress` field
- the page store should trust the worker's aggregate progress snapshot directly instead of pinning the bar to the highest per-file callback it has ever seen
- when the runtime is downloading multiple files in parallel, the worker should coalesce those events into one generic total-progress label and emit it on a short cadence so the status line stays readable
- saved-model rows should expose a red discard button that removes cached browser files for that Hugging Face repo and prunes the corresponding saved-model entries from local storage
- saved-model `Load` actions should remain enabled whenever the route is otherwise idle; discard-state bindings must not accidentally disable the whole list through non-boolean attribute values
- on desktop, the route should stay viewport-capped without adding extra horizontal page padding; the router stage already constrains the outer width, and the saved-model list should expand to consume the remaining sidebar height above the advanced section
- the advanced runtime section should stay collapsed by default
- the general runtime disclaimer about WebGPU, ONNX compatibility, and browser caching should stay visible below the advanced section even while that section is collapsed
- the system-prompt editor in the chat column should stay collapsed by default so the thread and composer keep most of the height

Current worker and runtime contract:

- the main thread does not import `@huggingface/transformers` directly; only `huggingface-worker.js` dynamically imports the local `transformers.js` shim
- the main thread should spawn `huggingface-worker-bootstrap.js`, not the heavy runtime worker directly
- the worker stays inside `_core/huggingface/`, but `manager.js` owns it as a shared singleton within the current browser context so the routed page, admin agent, and onscreen agent read one live model state
- the shared manager may terminate and recreate that worker to stop an in-flight model load or to unload a model cleanly
- worker startup failures should also clear the dead worker reference and reset queued load state so the next user action can create a fresh worker instead of getting stuck in a permanent queued state
- worker messages are centralized in `protocol.js`; keep the page and worker aligned there instead of inventing ad hoc `postMessage` strings
- model loading progress comes from Transformers.js `progress_callback` events and is forwarded to the page through the worker envelope
- worker-side caught failures plus uncaught worker errors and rejections should always be logged through `console.error`, and the page store should also `console.error` inbound load/chat failure payloads plus raw browser worker error events so browser debugging always has a raw trail even when the UI message is terse or opaque
- common WebGPU memory failures from ONNX Runtime should be rewritten into a concise user-facing out-of-memory message while still preserving the raw console error trail
- the worker should also forward its own `console.error` calls back to the page over the worker protocol so runtime logs from inside the worker survive even when the browser surfaces only an opaque worker crash event
- the worker should emit explicit load-stage trace markers over the worker protocol around runtime import and pipeline load so opaque browser-level worker crashes can still be narrowed down to the last completed phase
- the worker should also emit processor-load trace markers when it rehydrates an explicit `AutoProcessor` outside the text-generation pipeline, plus prompt-strategy trace markers for processor-template, tokenizer-template, and fallback-template selection and branch failures, so live console debugging can distinguish stale code delivery from a real runtime prompt-branch fallback
- startup import failures in the heavy worker module should be caught in the bootstrap worker so the page can receive at least one explicit trace/log payload before the browser reports a generic worker crash
- `manager.js` and `huggingface-worker-bootstrap.js` should append the shared worker-runtime version token to their module URLs so browser module caching does not pin stale prompt/runtime code after a source update
- the manager persists the last successfully loaded model config in browser-wide local storage, should auto-reload it when the first subscriber boots in the same browser profile, and should expose it as the preferred saved-model selection for admin and onscreen local-provider drafts without treating it as user-specific app-file preference
- admin or onscreen chat may intentionally unload the shared Hugging Face model with `reboot: false` so the page can free GPU memory instead of tearing down and immediately re-booting an idle worker
- the helper layer still owns the browser-storage shaping for saved-model entries, while `manager.js` owns the live shared saved-model state that the routed page, admin selector, and onscreen selector subscribe to

Current model-loading contract:

- users load models by entering a Hugging Face model id or Hub URL; the module normalizes full Hub URLs back to repo ids such as `org/model`
- the route targets browser-side text generation on `device: "webgpu"`; if WebGPU is unavailable, the module should surface that state instead of silently switching to a backend-wide server path
- the worker should prefer the high-level `pipeline("text-generation", ...)` path for chat models so the runtime matches the official model-card browser examples instead of stitching together lower-level model classes by hand, but it must not assume the resulting pipeline instance includes a chat-template-capable processor for text tasks
- the shared manager may accept extra `requestOptions` for generation from other local callers such as the admin and onscreen agents, but that must stay an extension of the same routed-worker contract rather than a forked second worker implementation
- streamed text should be emitted on each decoded token advance rather than only on word-finalized chunks, so code-heavy or markdown-heavy admin-agent and onscreen-agent replies do not appear to stall until completion
- the route should not pretend it has a WebLLM-style prebuilt catalog or reliable cache scan; Transformers.js loads arbitrary compatible Hub repos and does not expose the same built-in inventory surface
- the browser should keep a small saved-model list in storage for quick reuse, but that list is shared manager state rather than route-owned UI memory and is still not authoritative browser-cache state
- the discard action may need to prune all saved entries for the same repo id rather than one dtype entry, because browser cache ownership is repo-scoped while the UI list is keyed by model id plus dtype
- the default Hugging Face generation cap is `16384` max new tokens unless the user overrides it
- only Transformers.js-compatible repos with ONNX assets are expected to work; the UI should point users toward the ONNX Community model browser instead of inventing custom discovery logic here
- the module-local `transformers.js` shim should point at the vendored local build under `vendor/`, not a live CDN import, when the route is being used to test unreleased upstream support
- the vendored `transformers.web.js` build may rewrite its ONNX Runtime package imports such as `onnxruntime-web/webgpu` and `onnxruntime-common` to the local vendored `ort.webgpu.bundle.min.mjs` file so browser workers can resolve the runtime without package-CDN semantics
- the vendored ORT bundle should stay alongside its required wasm sidecar inside `vendor/` so the local browser runtime remains self-contained
- model downloads and cache ownership belong to the browser-side Transformers.js runtime; this module should not add server proxying or backend model state unless a later request explicitly asks for it

Current chat and metrics contract:

- the page supports only plain system prompt text plus plain user and assistant chat turns
- the worker must prepare one prompt string before generation and pass that prepared prompt into the Transformers.js text-generation pipeline; after a chat-template fallback, it must not pass raw chat-message arrays back into the pipeline or template-less tokenizers will throw again inside the pipeline's own chat formatting path
- when a loaded model exposes a processor chat template, the worker should use that processor template first so Gemma-style ONNX repos keep their model-authored `system`/`user`/`assistant` formatting and thinking-history stripping instead of falling back to handwritten transcript shaping
- because the vendored Transformers.js text-generation pipeline does not currently attach processors for text tasks, the worker should explicitly try `AutoProcessor.from_pretrained(modelId, ...)` during model load when the pipeline does not supply one, then keep using the pipeline tokenizer for prompt metrics, streaming decode, and generation
- processor-template prompt metrics should come from tokenizing the rendered prompt string with the tokenizer; do not rely on `processor.apply_chat_template(... tokenize: true)` for Gemma-style repos because that path can throw and silently force the bad handwritten fallback
- only when neither the processor nor the tokenizer has a usable chat template should `_core/huggingface/helpers.js` serialize the conversation into one API-style fallback prompt with explicit `System instructions:`, `Conversation:`, and trailing `Assistant:` sections instead of a lossy `role: text` fallback or a transcript format that encourages the model to echo structural markers
- the chat column should present a `Testing chat` heading with the clear-chat action inline beside it
- there is no tool execution, skill routing, attachments, queueing, or persisted history in this module
- the stop action must interrupt generation in the worker through a stopping-criteria gate instead of faking cancellation in the UI
- assistant metrics are attached after a response finishes, using locally measured prompt tokens, completion tokens, time to first streamed text, end-to-end latency, and derived token rates
- assistant replies should render their model id and performance metrics as one compact inline row below the response body instead of large stat cards
- sparse chat threads should stay top-aligned and keep compact message heights; do not stretch message rows to fill the thread column
- the chat column should keep the thread and composer visually dense; avoid oversized message padding, oversized saved-model rows, or expanded prompt editors by default

## Work Guidance

### Local Work Rules

- keep this surface self-contained under `_core/huggingface/` unless a later request explicitly promotes shared helpers into `_core/framework` or `_core/visual`
- prefer worker-side inference changes over main-thread imports so the test page remains responsive during model load and generation
- keep cross-surface Hugging Face state in `manager.js`; do not reintroduce per-surface worker copies in routed stores, admin adapters, or onscreen adapters
- keep the routed page simple, dense, and legible; it is a test harness, not a polished chat product
- if the route path, worker protocol, pinned Transformers.js shim, model-selection contract, or persistence contract changes, update this file, `/app/AGENTS.md`, and the matching docs under `_core/documentation/docs/`

## Verification



## Child DOX Index

- No child DOX docs.
