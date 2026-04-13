# Onscreen Agent Runtime

This doc covers the floating routed overlay agent as a frontend runtime surface.

## Primary Sources

- `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/prompts/AGENTS.md`
- `app/L0/_all/mod/_core/promptinclude/AGENTS.md`
- `app/L0/_all/mod/_core/open_router/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/store.js`
- `app/L0/_all/mod/_core/onscreen_agent/llm.js`
- `app/L0/_all/mod/_core/onscreen_agent/execution.js`
- `app/L0/_all/mod/_core/onscreen_agent/skills.js`

## What The Module Owns

`_core/onscreen_agent/` owns:

- the routed overlay adapter in the router overlay seam
- the floating shell UI and compact bubble UI
- chat history, overlay config persistence, and browser-stored overlay UI state
- prompt assembly and prompt history previews
- attachment handling
- the execution loop and streamed execution cards
- onscreen skill discovery and `space.skills.load(...)`

## Persistence

Current persisted files:

- config: `~/conf/onscreen-agent.yaml`
- browser UI state: `sessionStorage["space.onscreenAgent.uiState"]` with `localStorage["space.onscreenAgent.uiState"]` as fallback
- history: `~/hist/onscreen-agent.json`

Important config fields:

- `llm_provider`
- `local_provider`
- API endpoint, key, model, and params
- `max_tokens`
- `huggingface_model`
- `huggingface_dtype`
- optional `custom_system_prompt`

Important browser UI state fields:

- `agent_x`, `agent_y`
- optional `hidden_edge`
- optional `history_height`
- `display_mode`

Current defaults:

- provider: `api`
- local provider: `huggingface`
- Hugging Face dtype: `q4`
- endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `openai/gpt-5.4-mini`
- params: `temperature: 0.2`
- max tokens: `64000`
- display mode: `compact`
- first run with no `~/conf/onscreen-agent.yaml`: start with the compact avatar-plus-chat box horizontally centered, with its bottom edge targeting whichever is lower on screen: `7em` above the viewport bottom or `90%` of viewport height, instead of restoring browser-global position state

## Runtime Surface

The overlay publishes `space.onscreenAgent`.

That namespace is the stable external entry point for:

- showing or hiding the overlay, including revealing a browser-persisted edge-hidden peeking pose before normal use resumes
- triggering prompt submission from outside the module
- handling guarded preset-button prompt submission for spaces and similar launchers without queueing over an already busy send loop

The active chat surface also publishes the current prompt/history snapshot on `space.chat`.

## UI Ownership

Key files:

- `panel.html`: overlay DOM shell
- `onscreen-agent.css`: shell, floating window, compact bubble, and overlay-local styling
- `response-markdown.css`: markdown presentation for assistant responses
- `view.js`: thread rendering wiring
- `store.js`: display mode, drag, edge-hide peeking, resize, send loop, queued follow-ups, and scroll behavior

The routed overlay anchors in `_core/router` are the supported place for floating routed UI. The overlay should not be hardwired directly into the router shell.

The settings and prompt-history dialogs reuse the shared `_core/visual/forms/dialog.css` shell layout. Their header and footer rows stay fixed while only the settings body or prompt-history frame scrolls, so the footer actions remain reachable even when the content is long.

The settings dialog now has two provider tabs named `API` and `Local`. `API` keeps the OpenAI-compatible endpoint, model, and key fields. `Local` mounts the shared Hugging Face config sidebar in onscreen mode, so the overlay reads the same saved-model list and live WebGPU worker state as the routed Local LLM page and the admin chat. Opening the Local tab should refresh saved-model shortcuts without booting the worker; saving local settings persists the selected repo id and dtype, then starts background model preparation. When no local model is selected and saved models exist, the Local panel preselects the browser-wide last successfully loaded saved model from `_core/huggingface/manager.js`, falling back to the first saved entry if that last-used entry was discarded. When no local model is selected, no local model is loaded, and the shared saved-model list is empty, the Local panel prefills the Hugging Face model field with the same testing-page default: `onnx-community/gemma-4-E4B-it-ONNX`.

The API-key composer blocker applies only to the default API-provider configuration with no API key. Local Hugging Face mode can send without an API key and falls back to loading the selected local model on the first message if background preparation has not finished.

Preset launchers should use `space.onscreenAgent.submitExamplePrompt(...)` instead of `submitPrompt(...)` when they need strict “send now or refuse” behavior. That guarded helper opens the overlay, checks the live composer blocker state, shows `Don't forget to configure your LLM first.` through the overlay bubble when the default API-key overlay is blocking input, shows `I'm in the middle of something...` when the overlay is already sending or executing or compacting, and only then seeds the draft and submits.

For remote API mode, `_core/onscreen_agent/api.js` now finalizes the upstream fetch request through extension seam `_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest`. Provider-specific request policy such as OpenRouter headers belongs in headless helper modules like `_core/open_router`, so prompt assembly in `llm.js` no longer hardcodes those headers.

Local Hugging Face sends use the compact `LOCAL_ONSCREEN_AGENT_SYSTEM_PROMPT` profile from `llm.js` rather than the full firmware prompt plus skill catalog. The normal overlay history, transient context, execution loop, prompt inspection, and custom instructions still apply.

Dragging the astronaut past any viewport edge now first hits a dead zone at the in-screen clamp that matches the reveal-threshold distance so corner placement stays practical, then snaps the shell into a hidden peeking pose on that edge after the pointer crosses that extra distance. In that state about 55 percent of the avatar remains in view, the astronaut keeps its normal left or right facing flip while also rotating by edge direction, the chat body collapses away, the hidden panel and history surfaces stop intercepting clicks or wheel scrolling while invisible, and a click or drag back past the reveal threshold restores the previous compact or full chat body.

The onboarding hint bubble is now deliberately minimal. Its single 2-second countdown is tied only to overlay mount timing, never to page load: `store.js` starts it during `mount`. Once visible, the hint auto-dismisses after 3 seconds unless a real trusted shell `pointerdown` dismisses it first. The hint is rendered through its own dedicated `panel.html` bubble instead of the generic assistant bubble runtime, so it does not depend on markdown rendering, auto-hide behavior, or assistant-bubble suppression rules. It shows `**Drag** me, **tap** me.` if the shell still has not received any real trusted `pointerdown`, and it is allowed to render even when the overlay restored into an edge-hidden pose.

## Prompt Files

Prompt file ownership is split:

- `prompts/system-prompt.md`: firmware prompt for normal turns
- `prompts/compact-prompt.md`: user-triggered history compaction
- `prompts/compact-prompt-auto.md`: automatic history compaction

The current live firmware prompt was promoted from `tests/agent_llm_performance/prompts/069A_handoff_no_copy.md` on `2026-04-07` after the `070` through `075` sweep confirmed it was still the best overall prompt on the 57-case suite.

The base prompt file is not the only model-facing prompt source. `_core/promptinclude` adds the stable prompt-include instruction section through the prompt-section seam, appends readable `*.system.include.md` files there as additional system-prompt sections, and injects readable `*.transient.include.md` file bodies later through transient context.

Read `agent/prompt-and-execution.md` next for the actual prompt assembly and execution protocol.
