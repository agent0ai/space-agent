# Onscreen Agent Runtime

This doc covers the floating routed overlay agent as a frontend runtime surface.

## Primary Sources

- `app/L0/_all/mod/_core/agent-chat/AGENTS.md`
- `app/L0/_all/mod/_core/agent_prompt/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/prompts/AGENTS.md`
- `app/L0/_all/mod/_core/promptinclude/AGENTS.md`
- `app/L0/_all/mod/_core/open_router/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/store.js`
- `app/L0/_all/mod/_core/agent_prompt/prompt-runtime.js`
- `app/L0/_all/mod/_core/onscreen_agent/llm.js`
- `app/L0/_all/mod/_core/onscreen_agent/execution.js`
- `app/L0/_all/mod/_core/onscreen_agent/skills.js`

## What The Module Owns

`_core/onscreen_agent/` owns:

- the routed overlay adapter in the router overlay seam
- the floating shell UI and compact bubble UI
- chat history, overlay config persistence, and owner-tagged browser UI state
- prompt assembly and prompt history previews
- the overlay-specific prompt builders layered on top of the shared `_core/agent_prompt/prompt-runtime.js` lifecycle
- attachment handling
- the execution loop and streamed execution cards
- onscreen skill discovery and `space.skills.load(...)`

## Persistence

Current persisted files:

- config: `~/conf/onscreen-agent.yaml`
- browser UI state: `sessionStorage["space.onscreenAgent.uiState"]` with `localStorage["space.onscreenAgent.uiState"]` as fallback
- history: `~/hist/onscreen-agent.json`

The stored overlay config keeps `api_key` encrypted at rest when `space.utils.userCrypto` is unlocked for the current browser session. Encrypted values are stored as `userCrypto:`-prefixed strings in `~/conf/onscreen-agent.yaml`, decrypted automatically on load, and fail soft to a blank locked field when the current session cannot decrypt them. In `SINGLE_USER_APP=true`, `space.utils.userCrypto` bypasses encryption entirely, so new `api_key` values stay plaintext and no `userCrypto:` wrapper is added, but any legacy wrapped value from an older non-single-user build still loads as a blank locked field until the user replaces or clears it.

Important config fields:

- `llm_provider`
- `local_provider`
- API endpoint, key, model, and params
- `max_tokens`
- `prompt_budget_ratios`
- `huggingface_model`
- `huggingface_dtype`
- optional `custom_system_prompt`

`prompt_budget_ratios` drives the shared prompt-budget builder: `system`, `history`, and `transient` split the configured `max_tokens`, while `singleMessage` caps any one live history message as a percentage of the history budget before part-level trimming runs. Prepared prompt entries and prompt items now carry cached token metadata so rebuilds can reuse counts for the same bodies. Part-level trimming then uses one shared planner pass: contributor trims must each be at least `250` tokens, and when that is not possible for `system` or `transient`, the runtime trims one combined section body instead of applying tiny contributor cuts.

Important browser UI state fields:

- `agent_x`, `agent_y`
- optional `hidden_edge`
- optional `history_height`
- `display_mode`
- `owner`

Avatar movement, edge-hide changes, compact/full mode changes, viewport re-clamps, and history-height resize persist only to that browser UI state payload. They must not rewrite `~/conf/onscreen-agent.yaml`; the config file is rewritten only when persisted LLM settings or custom instructions change.

Current defaults:

- provider: `api`
- local provider: `huggingface`
- Hugging Face dtype: `q4`
- endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `anthropic/claude-sonnet-4.6`
- params: `temperature: 0.2`
- max tokens: `120000`
- display mode: `compact`
- first run with no `~/conf/onscreen-agent.yaml` and no matching owner-tagged browser UI state: start with the compact avatar-plus-chat box horizontally centered, with its bottom edge targeting whichever is lower on screen: `7em` above the viewport bottom or `90%` of viewport height, instead of restoring browser-global position state

## Runtime Surface

The overlay publishes `space.onscreenAgent`.

That namespace is the stable external entry point for:

- showing or hiding the overlay, including revealing a browser-persisted edge-hidden peeking pose before normal use resumes
- triggering prompt submission from outside the module
- handling guarded preset-button prompt submission for spaces and similar launchers without queueing over an already busy send loop

The active chat surface also publishes the current prompt/history snapshot on `space.chat`. That runtime surface now includes the live `promptItems` metadata list for the current prepared turn plus `readLongMessage({ id, from, to })`, which returns slices from the untrimmed text behind any placeholder-expanded prompt contributor for the current turn only.

Boot timing is intentionally lazy now. Overlay init restores config, browser UI state, and saved history first, but it does not eagerly fetch the default firmware prompt, install onscreen skills, or assemble prompt input on plain page reload. Those prompt dependencies are loaded only on the first prompt-dependent action such as send, prompt-history open, or another explicit prompt rebuild.

## UI Ownership

Key files:

- `panel.html`: overlay DOM shell
- `onscreen-agent.css`: shell, floating window, compact bubble, and overlay-local styling
- `response-markdown.css`: markdown presentation for assistant responses
- `view.js`: thread rendering wiring
- `store.js`: display mode, drag, edge-hide peeking, resize, send loop, queued follow-ups, and scroll behavior

The draggable astronaut button and the shared thread assistant helmet now resolve through `/mod/_core/visual/res/chat/overlay/` so authenticated app imagery stays centralized under `_core/visual/res/`. The public `/login` and `/enter` shells remain the exception and keep their own mirrored astronaut asset under `/pages/res/`.

The routed overlay anchors in `_core/router` are the supported place for floating routed UI. The overlay should not be hardwired directly into the router shell.

The shared thread view keeps settled assistant replies markdown-rendered, but submitted user bubbles stay plain pre-wrapped text so typed blank lines and trailing spacing display literally instead of expanding into markdown paragraph gaps.
That shared history styling resets rendered markdown bubbles back to normal white-space so parser formatting newlines between tags do not show up as visible blank lines, and it also collapses direct block margins inside list items so loose markdown bullets do not render blank-line-sized gaps between entries.

The settings and prompt-history dialogs reuse the shared `_core/visual/forms/dialog.css` shell layout. Their header and footer rows stay fixed while only the settings body or prompt-history frame scrolls, so the footer actions remain reachable even when the content is long.

Caught overlay runtime errors are logged through `console.error` and shown through the shared toast stack from `_core/visual/chrome/toast.js`. The composer placeholder still belongs to ready-state and lightweight status guidance, so raw exception text should not be pushed into the textarea placeholder.
Overlay execution transcripts now use the shared YAML-first formatter for both console logs and returned values, emitting block headers such as `log↓`, `warn↓`, `error↓`, and `result↓` so structured telemetry stays complete across the thread and execution cards. Queued follow-up submissions wait behind any just-finished assistant reply that contains `_____javascript`; the runtime must execute the block and append the `execution-output` turn before sending the queued draft, so the next model request sees the execution result in history. Immediately before those execution results are serialized back into the `execution-output` follow-up turn, the overlay also runs the shared assistant-message evaluation seam; the current first-party hook from `_core/agent-chat` prepends synthetic loop warnings when the exact same assistant message reappears, using `info` on the 2nd send, `warn` on the 3rd send, and `error` on the 4th send onward.

The settings dialog now has two provider tabs named `API` and `Local`. `API` keeps the OpenAI-compatible endpoint, model, and key fields. `Local` mounts the shared Hugging Face config sidebar in onscreen mode, so the overlay reads the same saved-model list and live WebGPU worker state as the routed Local LLM page and the admin chat. Opening the Local tab should refresh saved-model shortcuts without booting the worker; saving local settings persists the selected repo id and dtype, then starts background model preparation. When no local model is selected and saved models exist, the Local panel preselects the browser-wide last successfully loaded saved model from `_core/huggingface/manager.js`, falling back to the first saved entry if that last-used entry was discarded. When no local model is selected, no local model is loaded, and the shared saved-model list is empty, the Local panel prefills the Hugging Face model field with the same testing-page default: `onnx-community/gemma-4-E4B-it-ONNX`.

The API-key composer blocker applies only to the default API-provider configuration with no API key, where the composer shows a centered `Set LLM API key` action over the disabled textarea. Local Hugging Face mode can send without an API key and falls back to loading the selected local model on the first message if background preparation has not finished.

The composer textarea itself stays borderless in both compact and full modes. Overlay-local CSS should neutralize native textarea appearance instead of introducing a second inner input frame inside the panel.

Prompt assembly also reads the live overlay display mode through a module-local transient-section extension. In compact mode it appends a short lowercase `chat display mode` transient note: `chat is in compact mode` and `keep replies short unless more detail is needed for correctness or the user asks for it`. Full mode currently adds no display-mode transient note.

The same module now adds a bounded `user home files` transient section built from a recursive `space.api.fileList("~/", true)` pass. That section omits `.git/` directories entirely, then renders the remaining current-user home paths as a simple indented tree with folders first, trailing `/` markers for folders, and explicit `# ... more folders` or `# ... more files` lines when the current defaults `maxDepth: 5`, `maxFoldersPerFolder: 20`, `maxFilesPerFolder: 20`, or `maxLines: 250` hide part of the tree.

Preset launchers should use `space.onscreenAgent.submitExamplePrompt(...)` instead of `submitPrompt(...)` when they need strict “send now or refuse” behavior. That guarded helper opens the overlay, checks the live composer blocker state, shows `Don't forget to configure your LLM first.` through the overlay bubble when the default API-key overlay is blocking input, shows `I'm working on something...` when the overlay is already sending or executing or compacting, keeps that notice from being immediately replaced by compact streaming reply bubbles, and only then seeds the draft and submits. When a caller already knows the prompt is blocked and only wants the bubble, it can call `space.onscreenAgent.showExamplePromptInactiveBubble(...)` instead.

Launcher surfaces that need the same blocker state without reimplementing overlay rules should read the existing global Alpine `onscreenAgent` store getters instead of inventing their own status cache. The overlay exposes `isExamplePromptInactive`, `canSubmitExamplePrompt`, `examplePromptInactiveReason`, and `examplePromptNoticeText` on that store using the same blocker rules that `submitExamplePrompt(...)` uses, so surfaces such as spaces onboarding can fade chat-style example buttons while keeping them clickable enough to trigger the overlay bubble.

Those same launchers may also call `showExamplePromptInactiveBubble()` on the global store when they already know the prompt is blocked. That helper mirrors the namespace method, opens the overlay if needed, then shows the current blocker bubble using the same derived inactive state as `submitExamplePrompt(...)`, which lets spaces onboarding surface the bubble directly before a blocked chat example's YAML body runs.

For remote API mode, `_core/onscreen_agent/api.js` now finalizes the upstream fetch request through extension seam `_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest`. Provider-specific request policy such as OpenRouter headers belongs in headless helper modules like `_core/open_router`, so prompt assembly in `llm.js` no longer hardcodes those headers.

Local Hugging Face sends now use the same onscreen-agent prompt assembly path as remote API sends, so the firmware prompt, prompt includes, skill catalog, auto-loaded skill context, custom instructions, history, and transient context stay aligned across providers. The actual local-runtime request should still reuse the same folded transport messages that the API path would send upstream, while prompt inspection keeps showing the richer pre-fold prepared payload. The routed `/huggingface` testing page remains separate and uses only its local plain system-prompt-plus-chat surface.

Dragging the astronaut past the left, right, or bottom viewport edge now first hits a dead zone at the in-screen clamp that matches the reveal-threshold distance so corner placement stays practical, then snaps the shell into a hidden peeking pose on that edge after the pointer crosses that extra distance. Top-edge hiding is disabled entirely. In the enabled hidden states the shell hide math follows the full rendered astronaut bounds and now keeps roughly 60 percent of the astronaut visible with one uniform inset. On fine-pointer desktops the drag hitbox stays the same size as the visible astronaut so the image cannot drift away from the interactive box. The normal right-side flip still applies while hidden, the astronaut image itself now stays shadowless in every state so the visible silhouette matches across edges and in-screen placement, and the chat body collapses away while the hidden panel and history surfaces stop intercepting clicks or wheel scrolling until a click or drag back past the reveal threshold restores the previous compact or full chat body.

The astronaut itself stays draggable and clickable, but its hitbox must not swallow page navigation. Wheel or trackpad scroll over the avatar now proxies to the underlying page or widget surface first, then falls back to native scroll chaining for the nearest scrollable ancestor, so the overlay can still be dragged without trapping viewport scrolling. The avatar keeps `touch-action: none` only for coarse-pointer touch devices; fine-pointer desktops leave native scroll gestures enabled over the astronaut.

In compact mode, the live assistant or notice bubble is also the expand affordance. Clicking it, or keyboard-activating it, should switch the overlay into full mode with the same focus and bubble-dismiss behavior as clicking the astronaut. The separate startup hint bubble remains a plain status hint rather than becoming part of that expand control.

When full mode places the history above the avatar, the fitted height now reserves the live fixed top-shell chrome instead of shrinking only against the raw viewport top. The overlay prefers the rendered onscreen menu bar bottom and keeps the usual top breathing room, so the history compresses before it collides with the fixed menu bar.

The onboarding hint bubble is now deliberately minimal. Its single 2-second countdown is tied only to overlay mount timing, never to page load: `store.js` starts it during `mount`. Once visible, the hint auto-dismisses after 3 seconds unless a real trusted shell `pointerdown` dismisses it first. The hint is rendered through its own dedicated `panel.html` bubble instead of the generic assistant bubble runtime, so it does not depend on markdown rendering, auto-hide behavior, or assistant-bubble suppression rules. It shows `**Drag** me, **tap** me.` if the shell still has not received any real trusted `pointerdown`, and it is allowed to render even when the overlay restored into an edge-hidden pose.

## Prompt Files

Prompt file ownership is split:

- `prompts/system-prompt.md`: firmware prompt for normal turns
- `prompts/compact-prompt.md`: user-triggered history compaction
- `prompts/compact-prompt-auto.md`: automatic history compaction

The current live firmware prompt was promoted from `tests/agent_llm_performance/prompts/069A_handoff_no_copy.md` on `2026-04-07` after the `070` through `075` sweep confirmed it was still the best overall prompt on the 57-case suite.

The base prompt file is not the only model-facing prompt source. `_core/promptinclude` adds the stable prompt-include instruction section through the prompt-section seam, appends readable `*.system.include.md` files there as additional system-prompt sections, and injects readable `*.transient.include.md` file bodies later through transient context. `_core/memory` adds an always-on `memory` skill through the existing auto-loaded system-skill channel and uses those prompt-include files as its persistence layer.

Read `agent/prompt-and-execution.md` next for the actual prompt assembly and execution protocol.
