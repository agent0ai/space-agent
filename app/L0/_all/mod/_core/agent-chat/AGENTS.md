# AGENTS

## Purpose

`_core/agent-chat/` owns shared feature-level chat helpers reused by first-party agent surfaces.

It is a headless helper module. It does not own framework bootstrap, prompt assembly, transport, or UI. It owns chat-specific helper logic and hook implementations that belong to agent features rather than `_core/framework/`.

Documentation is top priority for this module. After any change under `_core/agent-chat/`, update this file and any affected parent or consumer docs in the same session.

## Ownership

This module owns:

- `assistant-message-evaluation.js`: shared assistant-message normalization, exact-repeat detection, severity-based loop warning construction, and safe prepending of synthetic transcript logs ahead of real execution console output
- `visual-data.js`: shared image visual-data normalization, serialization, token estimation, and transport shaping for first-party agent surfaces; its framework dependency stays relative so pure consumers remain directly importable in browser and Node verification runtimes
- `ext/js/_core/onscreen_agent/store.js/evaluateOnscreenAssistantMessage/end/*.js`: hook implementations for overlay assistant-message evaluation
- `ext/js/_core/admin/views/agent/store.js/evaluateAdminAssistantMessage/end/*.js`: hook implementations for admin assistant-message evaluation

## Local Contracts

### Local Contracts

Current shared helper contract:

- assistant-message repeat matching should normalize line endings, trim trailing per-line whitespace, and trim outer whitespace before comparing exact assistant-message bodies
- synthetic transcript warnings should be emitted only when the same normalized assistant message has already appeared earlier in the settled assistant history for that same surface
- vision transport shaping must convert user visual data into provider-facing image content parts and must remove internal `visualData` and `tokenCount` metadata from outbound messages
- severity must escalate as `info` on the 2nd exact send, `warn` on the 3rd exact send, and `error` on the 4th exact send onward
- the warning text should stay short, direct, and framed as loop pressure visible through the normal execution transcript channel
- prepending synthetic transcript logs must not rewrite or trim the real execution console entries that already exist on the execution result
- this module owns the first-party repeated-message loop policy for both overlay and admin chat; the consuming stores own only the evaluation seams and transcript insertion point

## Work Guidance

### Local Work Rules

- keep framework-generic runtime helpers in `_core/framework/`; keep chat-feature policy here
- keep surface-specific store behavior in the owning chat modules and reuse this module only for logic that is intentionally shared across agent surfaces
- keep shared pure helper imports browser- and Node-resolvable; use relative module specifiers when the helper is covered by direct Node imports
- when repeat-detection thresholds, wording, or transcript insertion semantics change, update this file, the consuming chat docs, and the supplemental agent-runtime docs in the same session

## Verification



## Child DOX Index

- No child DOX docs.
