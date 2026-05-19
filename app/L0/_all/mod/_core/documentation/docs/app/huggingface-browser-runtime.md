# Hugging Face Browser Runtime

This doc covers the first-party browser inference test surface under `_core/huggingface`.

## Primary Sources

- `app/L0/_all/mod/_core/huggingface/AGENTS.md`
- `app/L0/_all/mod/_core/huggingface/manager.js`
- `app/L0/_all/mod/_core/huggingface/view.html`
- `app/L0/_all/mod/_core/huggingface/store.js`
- `app/L0/_all/mod/_core/huggingface/huggingface-worker.js`
- `app/L0/_all/mod/_core/huggingface/helpers.js`
- `app/L0/_all/mod/_core/huggingface/transformers.js`

## Route

The route is:

```txt
#/huggingface
```

This route is also advertised to the dashboard panels index through `_core/huggingface/ext/panels/huggingface.yaml`, using the title `Local LLM` and the shorthand manifest path `huggingface`.

The router resolves that to:

```txt
/mod/_core/huggingface/view.html
```

The route is browser-only. It does not add backend API endpoints or server-owned model state.

## What The Page Does

`_core/huggingface` is a compact proof-of-concept test harness for browser inference with Hugging Face Transformers.js on WebGPU.

The page owns:

- a current-model panel with ready/loading/error state
- one freeform model loader that accepts a Hugging Face repo id or Hub URL
- a small saved-model list remembered in browser storage for quick reuse
- a collapsed advanced section for dtype and max-new-token settings
- one always-visible runtime note under that advanced section explaining that the route runs locally on WebGPU, requires Transformers.js-compatible ONNX repos, and uses browser caching after the first load
- a simple testing chat with system prompt, user messages, streamed assistant replies, stop, and clear-chat
- compact response metrics inline under each assistant reply

When admin or onscreen chat local settings have no selected model and the browser has saved Hugging Face models, the shared sidebar preselects the browser-wide last successfully loaded saved model from local storage. If that entry was discarded, it falls back to the first saved model. When the browser has no saved local Hugging Face models and no persisted auto-reload target, the routed testing-page model input prefills `onnx-community/Qwen3-0.6B-ONNX` as the empty-state suggestion; admin and onscreen chat local settings reuse that same default only when there is no preferred saved-model selection. The default generation cap is `16384` max new tokens unless the user changes it.

This is not a general agent surface. It does not expose tool execution, queueing, attachments, persisted conversations, or backend orchestration.

## Worker Split

`_core/huggingface` keeps the heavy inference runtime out of the routed page thread.

The ownership split is:

- `view.html` mounts the route shell, binds to the Alpine store, and imports the standalone config sidebar through `<x-component>`
- `config-sidebar.html` owns the standalone model-loading sidebar component used by the routed page, the admin-agent local modal, and the onscreen-agent local modal
- `manager.js` owns the singleton worker lifecycle, saved-model registry, persisted last-loaded selection, live model state, and cross-surface stream control within one browser context
- `store.js` owns the routed page's local chat UI state and mirrors the shared manager state into Alpine
- `huggingface-worker-bootstrap.js` is the tiny startup wrapper that imports the heavy runtime worker and catches import/startup failures
- `huggingface-worker.js` owns the Transformers.js import, model downloads, generation, streaming, and interruption
- `protocol.js` holds the stable message names between the page and the worker
- `transformers.js` points at the vendored local browser build so the worker references one local module path instead of embedding a live CDN URL inline

`manager.js` also distinguishes an idle unbooted runtime from an active startup. Consumers should use its explicit boot flag for `Starting` UI, not `!isWorkerReady` by itself, so idle status can stay `Idle` until this page actually boots the worker. Its snapshot payloads should stay plain-data and clone-safe so the routed page, admin adapter, and onscreen adapter can mirror state without tripping browser clone errors.

Admin and onscreen chat may also read or refresh the shared saved-model list without booting the worker. Simply opening either settings dialog should not auto-start the Hugging Face runtime or auto-reload the persisted model just to populate saved-model shortcuts.

In admin and onscreen modes, the shared sidebar should show both the currently loaded model and the separately selected repo or dtype pair so each selector stays legible even before a load starts.

For debugging, both layers log failures aggressively:

- the worker logs caught load/chat failures, unhandled worker errors, and unhandled rejections through `console.error`
- the page store also logs inbound load/chat failure payloads and raw worker startup/message error events through `console.error`
- worker `console.error` calls are forwarded back across the worker protocol as structured payloads, so runtime logs can still be inspected from the page console even when the browser reports only an opaque worker crash
- common ONNX Runtime WebGPU out-of-memory failures are also collapsed into a shorter user-facing error message in the shared manager, while the raw console trace remains available for debugging
- the worker also emits explicit trace markers for major load phases such as runtime import and pipeline load; when the browser only reports a bare worker `error` event, the page can still report the last known phase
- prompt preparation also emits trace markers for processor-template, tokenizer-template, and fallback-template selection plus branch-failure traces, and model load also emits processor-load traces when the worker has to hydrate an `AutoProcessor` outside the text-generation pipeline, so live console debugging can confirm whether a model is using its intended chat-template path
- when a worker dies during startup, the page clears the dead worker instance and queued load state so a later retry can spawn a fresh worker instead of remaining stuck in `Queued`
- the bootstrap worker exists specifically so heavy worker import/startup failures can be surfaced as at least one explicit trace/log payload before the browser falls back to a generic worker `error` event
- the worker also accepts optional extra generation `requestOptions` so other local callers such as the admin and onscreen agents can reuse the same routed worker contract instead of forking a second Hugging Face worker implementation

The shared progress snapshot keeps long post-download runtime preparation visually below `100%` until the actual `LOAD_COMPLETE` handoff arrives. That avoids a fake-complete bar sitting at `100%` during pipeline finalization.

The worker-side text streamer should also emit deltas on each decoded token advance instead of waiting for space-delimited word finalization, because admin-agent and onscreen-agent replies often contain code or markdown where word-boundary buffering looks like broken streaming.

`manager.js` may terminate and recreate the worker to stop an in-flight model download or to unload the currently loaded model. The worker stays module-local, but the live runtime state is no longer route-local. Admin or onscreen chat may intentionally unload Hugging Face without an immediate reboot so the browser can reclaim GPU memory instead of immediately booting an idle worker again.

## Model Loading

Users load one model at a time by entering either:

- a plain Hugging Face repo id such as `org/model`
- a Hub URL such as `https://huggingface.co/org/model`

The helper layer normalizes Hub URLs back to repo ids before the worker loads them.

The worker uses Transformers.js browser APIs on `device: "webgpu"` through the high-level `pipeline("text-generation", ...)` path, matching the current Hugging Face model-card examples for browser chat models. The route now vendors a local source build instead of depending on a live CDN package import. As of April 8, 2026, that vendored runtime comes from a local build of the upstream `transformers.js` `main` branch, whose package metadata reports `4.0.1`.

The vendored runtime currently consists of:

- a locally built `transformers.web.js`
- a vendored `ort.webgpu.bundle.min.mjs`
- the matching `ort-wasm-simd-threaded.asyncify.wasm` sidecar

The vendored Transformers.js build rewrites its ONNX Runtime package imports to that local ORT bundle so the browser worker can load the unreleased runtime from `/mod/_core/huggingface/vendor/` without package-CDN resolution.

Important model constraint:

- this route is for Transformers.js-compatible text-generation repos
- in practice that means repos with the needed ONNX/browser assets available to Transformers.js
- the route does not try to discover or validate all compatible repos ahead of time
- instead, the UI points users to the ONNX Community models browser on Hugging Face

Saved models in the sidebar are just browser-side quick-reuse entries. They are not a browser-cache inventory and should not be treated as authoritative cache state. `manager.js` keeps that saved-model list as shared live state for the routed page, the admin agent, and the onscreen agent within the same browser context, instead of each surface inventing a second local registry.

## Downloads And Caching

Transformers.js itself owns browser-side downloads and caching. `_core/huggingface` only forwards progress reports and load results into the route UI.

Current behavior:

- first load downloads tokenizer and model assets in the browser
- later loads may reuse whatever the browser-side Transformers.js cache already retained
- the route still does not expose authoritative cache scanning, but it now exposes a repo-scoped discard action for saved models by deleting matching Hugging Face responses from the browser Cache API
- the current-model panel shows one debounced aggregate download label under the progress bar, typically `Downloading model files (loaded / total)`, instead of rapidly alternating per-file names
- the worker tracks byte counts across all known file downloads and sends an aggregate `loaded / total` snapshot back to the page, so the bar fill and the parenthetical size detail refer to the same total progress
- the manager and bootstrap worker append a shared runtime-version token to worker module URLs so browser module caching does not keep an older prompt/runtime implementation alive after a source update once the page reloads
- the page store applies that aggregate snapshot directly instead of latching the highest individual callback value, which avoids the bar pinning at `100%` while more files are still arriving
- when multiple files are downloading in parallel, the worker coalesces those callbacks into a generic total-progress label on a short cadence so the status line stays readable
- saved-model rows now include a discard button that deletes matching Hugging Face repo responses from the browser Cache API and removes the affected saved-model entries from local storage
- saved-model row actions stay enabled while the route is idle; only real model transitions or an in-flight discard should disable them
- because the browser cache is repo-scoped while the saved-model list is keyed by model id plus dtype, discarding one entry may also prune other saved entries for the same repo id
- the last successfully loaded saved-model config is browser-wide local storage, not app-file user preference, and admin or onscreen local-provider drafts use it only as the default preselection when their draft model is blank
- the same `config-sidebar.html` file also has `admin` and `onscreen` modes used inside the chat settings modals, where it renders a direct repo-id input, dtype selector, saved-model shortcuts, current-model status, live load action or progress, and a button that opens the full Hugging Face testing chat route against the shared manager state

## Chat Flow

The chat flow is intentionally minimal:

1. the store builds a plain message list from the system prompt plus prior user/assistant turns
2. the worker prepares one final prompt string from that message list, explicitly loading an `AutoProcessor` when the text-generation pipeline does not expose one, preferring that processor chat template so Gemma-style ONNX repos keep their model-authored `system`/`user`/`assistant` formatting, falling back to the tokenizer's chat template when available, and only then serializing the chat into one API-style fallback prompt with `System instructions:`, `Conversation:`, and trailing `Assistant:` sections
3. the worker tokenizes that same prepared prompt string for metrics, instead of relying on the Gemma processor's direct `tokenize: true` chat-template path, and passes the prepared prompt string into the Transformers.js text-generation pipeline instead of passing raw chat-message arrays back into the pipeline after a fallback
4. generation streams partial text back into the current assistant message
5. stop uses a worker-owned stopping-criteria gate so generation can end cleanly with `finishReason: "abort"`
6. when generation ends, the worker sends the final text plus measured metrics

The route does not keep any worker-side chat history. Every request is rebuilt from the current message list owned by the page store.

## Metrics

Assistant turns include one compact inline metadata row under the response.

Current metrics are:

- model id
- `t/s`: derived tokens per second
- `t/min`: derived tokens per minute
- `p/c`: prompt tokens / completion tokens
- `ttft`: time to first streamed text
- `e2e`: end-to-end latency

These metrics are measured locally from the prepared prompt, generated output ids, and timing data inside the worker. There is no server-side accounting layer here.

## Related Docs

- `app/runtime-and-layers.md`
- `app/modules-and-extensions.md`
- `app/webllm-browser-runtime.md`
