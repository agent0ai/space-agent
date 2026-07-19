# AGENTS

## Purpose

`_core/webllm/` owns the first-party browser inference test surface for WebLLM.

It provides a direct routed page at `#/webllm`, keeps the WebLLM runtime isolated inside a dedicated module-local worker, and exposes a minimal test chat for loading browser-side models, sending plain chat turns, stopping inference, and reporting simple throughput metrics. It is intentionally not advertised through a dashboard panel.

Documentation is top priority for this module. After any change under `_core/webllm/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed test page for WebLLM model loading and chat
- `config-sidebar.html`: standalone config-sidebar component used by the routed test page
- `store.js`: page store, worker lifecycle, UI state, and routed surface behavior
- `webllm-worker.js`: dedicated worker that imports the vendored WebLLM runtime, loads models, streams deltas, and handles stop/reset actions
- `helpers.js`: shared model-selection, conversation-shaping, and metric-formatting helpers used by the page and worker
- `protocol.js`: stable message names between the routed page and the worker
- `webllm.css`: page-local layout and chat styling
- `web-llm.js`: vendored browser build of `@mlc-ai/web-llm`, kept local to this module so the route works without backend or global framework changes

## Local Contracts

### Local Contracts

Current route contract:

- the test route is `#/webllm`
- this module must not publish an `ext/panels/*.yaml` dashboard panel manifest; the Hugging Face-backed Local LLM page is the only local-LLM page advertised on the dashboard
- the page is browser-only and should not require backend API changes
- the routed page is intentionally a compact, low-chrome manual test surface, not a general agent runtime
- `view.html` should import the config sidebar through `<x-component path="/mod/_core/webllm/config-sidebar.html" mode="testing">` instead of inlining that sidebar markup directly
- the sidebar should surface the currently loaded model first, inside a slightly more prominent rounded panel with a larger model label, a compact right-aligned state badge, and an unload control beside the model name; while loading, that action should switch to `Stop` and cancel the in-flight load/download, and the progress bar should keep a small visible fill immediately so startup does not look stalled before precise progress arrives
- on desktop, the route should stay viewport-capped without adding extra horizontal page padding; the router stage already constrains the outer width, and the models block should expand to consume the remaining sidebar height above the advanced section
- on desktop, the routed page itself should stay viewport-capped and let only the model list and chat thread own the long-scroll behavior; the route shell should not grow tall enough to push the composer below the fold
- keep that desktop viewport clamp route-local inside `webllm.css`, mirroring the Hugging Face page contract instead of adding a router-shell-specific height override
- the advanced custom-model form should stay collapsed by default
- the system-prompt editor in the chat column should stay collapsed by default so the thread and composer keep most of the height

Current worker and runtime contract:

- the main thread does not import the vendored WebLLM runtime directly; only `webllm-worker.js` imports `web-llm.js`
- the worker lazily creates one `MLCEngine`, reuses it across reloads inside the route session, and terminates when the routed page unmounts
- worker messages are centralized in `protocol.js`; keep the page and worker aligned there instead of inventing ad hoc postMessage strings
- model loading progress comes from WebLLM's `initProgressCallback` and is forwarded to the page unchanged except for the surrounding worker envelope
- the page persists the last successfully loaded model config in browser storage and should auto-reload it when the route mounts again in the same browser profile

Current model-loading contract:

- users may either load a prebuilt WebLLM `model_id` or provide a custom model URL plus model library URL
- custom model loads must stay local to this route; do not add repo-wide runtime params or backend storage just to support them
- when a custom model id is blank, the module derives one from the model URL
- the page should expose the full vendored `prebuiltAppConfig.model_list` through a searchable compact list with direct per-model load actions
- the prebuilt list should distinguish cached and uncached models, use `Download <size estimate>` for uncached entries, `Enable` for cached entries, and `Unload` for the currently active prebuilt entry, and expose a `Downloaded` filter that only shows cached prebuilt models
- cached prebuilt entries should read slightly brighter than uncached rows, while the active prebuilt entry should be outlined in green so it is easy to spot in the compact list
- cached prebuilt entries should also expose a red discard control that removes the model's cached browser files to free space; discarding the active prebuilt model must unload it first and then clear its persisted auto-restore selection
- keep cached-action buttons compact; `Enable` and `Unload` should size to their label, while uncached `Download` buttons may use a slightly wider fixed width so the list stays aligned
- the filtered prebuilt list should keep compact row heights even when only a few results are visible; do not stretch sparse result sets to fill the available column height
- prebuilt model loads should come from the visible compact list; do not hide a separate freeform prebuilt-id field
- the advanced custom-model load button should only use explicit custom fields, never an implicit hidden prebuilt selection
- do not present arbitrary Hugging Face repo discovery as a normal load path; official WebLLM custom loading still requires MLC/WebLLM-compiled artifacts plus a compatible `model_lib` wasm
- model downloads, caching, and wasm fetches are owned by the browser-side WebLLM runtime; this module should not add server proxying or backend model state unless a later request explicitly asks for it

Current chat and metrics contract:

- the page supports only plain system prompt text plus plain user and assistant chat turns
- the chat column should present a `Testing chat` heading with the clear-chat action inline beside it
- there is no tool execution, skill routing, attachments, queueing, or persisted history in this module
- the stop action must call WebLLM interruption in the worker so the request can terminate with `finish_reason: "abort"` when the runtime supports it
- assistant metrics are attached after a response finishes, using WebLLM usage extras when available and a simple elapsed-time fallback only when needed
- assistant replies should render their model id and performance metrics as one compact inline row below the response body instead of large stat cards
- sparse chat threads should stay top-aligned and keep compact message heights; do not stretch message rows to fill the thread column
- the chat column should keep the thread and composer visually dense; avoid oversized message padding, oversized model rows, or expanded prompt editors by default

## Work Guidance

### Local Work Rules

- keep this surface self-contained under `_core/webllm/` unless a later request explicitly promotes shared helpers into `_core/framework` or `_core/visual`
- prefer worker-side WebLLM changes over main-thread imports so the test page remains responsive during model load and generation
- keep the routed page simple, dense, and legible; it is a test harness, not a polished chat product
- if the route path, worker protocol, vendored runtime version, or model-selection contract changes, update this file, `/app/AGENTS.md`, and the matching docs under `_core/documentation/docs/`

## Verification



## Child DOX Index

- No child DOX docs.
