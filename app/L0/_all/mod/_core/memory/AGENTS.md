# AGENTS

## Purpose

`_core/memory/` owns the first-party persistent-memory workflow for agent surfaces.

It is a headless core module. It does not own a route or UI. Its job is to define the agent-facing memory policy through one auto-loaded top-level skill that teaches prompt-include-backed memory files under the current user's `~/memory/` folder.

Documentation is top priority for this module. After any change under `_core/memory/`, update this file, the affected agent docs, and the matching supplemental docs in the same session.

## Ownership

This scope owns:

- `ext/skills/memory/SKILL.md`: the top-level auto-loaded memory skill for onscreen and admin agent surfaces

## Local Contracts

### Local Contracts

- the memory skill must stay auto-loaded into system prompt context through `metadata.loaded: true` plus `metadata.placement: system`
- the memory workflow must reuse `_core/promptinclude` rather than inventing a second persistence or prompt-injection system
- `~/memory/behavior.system.include.md` is the canonical home for stable behavior changes, user preferences, and standing instructions that should keep applying across conversations
- `~/memory/memories.transient.include.md` is the default rolling note file for facts, context, and other memory worth keeping but likely to change more often
- extra focused note files may be created under `~/memory/*.transient.include.md` when one topic deserves its own evolving memory file
- the skill must tell the agent to create or update memory files when something meaningful should persist, not to only acknowledge that memory verbally
- when a memory update is a small additive note, the skill should prefer incremental `fileWrite(...)` append, prepend, or insert mutations over rewriting the full memory file; whole-file rewrites should be reserved for cleanup, dedupe, or structural edits
- when the user asks the agent to change its behavior, the skill must direct that change into `~/memory/behavior.system.include.md`
- memory files are plain markdown include bodies whose contents are injected as prompt context by `_core/promptinclude`; keep the skill concise so the prompt budget stays focused on the files themselves

## Work Guidance

### Local Work Rules

- keep this module headless and prompt-focused
- prefer small edits to the skill text over adding JS unless the prompt runtime truly needs new behavior
- if the memory file conventions, auto-loaded behavior, or cross-provider prompt guarantees change, also update `app/AGENTS.md`, `_core/onscreen_agent/AGENTS.md`, `_core/admin/views/agent/AGENTS.md`, and the matching docs under `_core/documentation/docs/`

## Verification



## Child DOX Index

- No child DOX docs.
