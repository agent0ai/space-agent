# AGENTS

## Purpose

`_core/agent_prompt/` owns the shared prepared-prompt runtime used by first-party agent surfaces.

It is a headless helper module. It does not own any prompt text, skill policy, transport code, or UI. It only owns prompt-instance lifecycle and the generic build or rebuild flow that surface modules plug into with their own prompt builders.

Documentation is top priority for this module. After any change under `_core/agent_prompt/`, update this file and any affected parent or consumer docs in the same session.

## Ownership

This module owns:

- `prompt-items.js`: shared prompt-budget ratio parsing, keyed prompt-item normalization and merge helpers, long-message trimming placeholders, and the `space.chat` prompt-item access installer used by onscreen and admin chat stores
- `prompt-runtime.js`: shared `AgentPromptInstance` lifecycle, prompt-input cloning, prompt-history rebuild fallback, and the stable `createAgentPromptInstance(...)` / `hasPreparedPromptInput(...)` helpers used by agent surfaces

## Local Contracts

### Local Contracts

Current shared runtime contract:

- prompt builders may assemble system and transient context as keyed prompt-item maps instead of only plain strings; shared helpers in `prompt-items.js` own normalization, ordering, merging, and delete or replace semantics for those maps
- prompt-item `value` fields may also be arrays of sections; the shared value normalizer should concatenate non-empty entries with one blank line between them instead of JSON-stringifying those arrays
- normalized prompt items should cache `valueTokenCount` alongside the normalized string value so repeated prompt builds can reuse tokenizer results for the same item body
- prompt-budget ratios are stored as percentages of the configured model `maxTokens`, with `system`, `history`, and `transient` required to total 100 while `singleMessage` is a separate percentage of the history budget
- long prompt contributors may be trimmed through the shared middle-replacement placeholder emitted by `trimPromptLongMessage(...)`; the placeholder must keep a stable `space.chat.readLongMessage({ id, from, to })` instruction so the active chat runtime can expose the removed text on demand during that turn
- part-level prompt-budget trimming should build a one-shot thresholded multi-contributor plan that trims only contributors whose planned cut is at least `250` tokens; system and transient consumers may then fall back to one combined section-body trim when contributor-level trims would all be smaller than that threshold
- `installPromptItemAccess(...)` must keep full prompt-item text in runtime-only memory while publishing only redacted `space.chat.promptItems` metadata plus `readLongMessage(...)` on the live chat namespace
- this module is prompt-builder-agnostic; callers must provide `buildPromptInput(context)` and may optionally provide `updatePromptHistory({ context, historyMessages, options, prompt, promptInput })`
- `build(...)` stores normalized prompt context, calls the supplied builder, and returns a cloned prompt-input snapshot
- `updateHistory(...)` reuses the caller-supplied history updater when one exists and a prompt input was already built; otherwise it falls back to a full `build(...)`
- `getPromptInput()` returns a cloned snapshot so callers cannot mutate the runtime-owned cached prompt input directly
- prompt inputs are treated as plain structured data; builders must not leave live runtime objects, functions, DOM nodes, or other non-cloneable values inside the cached prompt input
- the runtime clones prompt context and prompt-input snapshots defensively; when `structuredClone(...)` rejects a non-cloneable value, the fallback clone keeps plain JSON-like data and drops runtime-only values instead of crashing prompt-history or retry flows
- this module must not depend on surface-specific prompt-entry shapes beyond cloning and caching them

## Work Guidance

### Local Work Rules

- keep surface-specific prompt seams, skill discovery, examples, and transient-section policy in the owning agent modules
- keep this module headless and reusable; do not add UI, transport, or skill-loading behavior here
- if the shared prompt-instance lifecycle changes, update both consumer docs and the supplemental agent-runtime docs

## Verification



## Child DOX Index

- No child DOX docs.
