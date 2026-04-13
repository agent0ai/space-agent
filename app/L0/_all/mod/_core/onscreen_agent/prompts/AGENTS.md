# AGENTS

## Purpose

`prompts/` owns the model-facing prompt files for `_core/onscreen_agent/`

Keep these files compact explicit and token-aware

## Ownership

This scope owns:

- `system-prompt.md`: firmware prompt for normal onscreen agent turns
- `system-prompt.backup-before-*.md`: backups of previous live firmware prompts before later promotions
- `compact-prompt.md`: prompt for user-triggered history compaction
- `compact-prompt-auto.md`: prompt for automatic loop compaction

## Local Contracts

- prefer plain text over markdown chrome
- use `$snake_case` only for reusable protocol terms
- use plain section labels, or `$keyword label` when the section explains that keyword directly
- when a later section reuses a declared concept, prefer the declared `$keyword` over fresh prose so the links stay explicit
- remove unnecessary backticks quotes filler and trailing punctuation
- keep instruction lines lowercase unless the line is literal assistant output the agent should emit visibly to the user
- optimize for obedience per token, not prose quality
- prefer strong evaluative labels like `required`, `forbidden`, `correct`, and `invalid` over weak labels like `good` and `bad` when examples teach protocol behavior
- `system-prompt.md` must define the reusable protocol terms including `$mission`, `$protocol`, `$human_command`, `$framework_telemetry`, `$transient_context`, `$execution_gate`, `$execution`, `$staging_sequence`, `$conversation_mode`, `$task_mode`, `$thrust_response`, `$terminal_response`, `$task_loop`, and `$verified_completion`
- `system-prompt.md` should center the whole behavior around one ordered turn loop: inspect input, map source, choose mode, choose next move, then repeat after `$framework_telemetry`
- `system-prompt.md` should make the agent explicitly autonomous at the mission level: it acts as ship administrator for the runtime, uses available authority on the user's behalf, and defaults to action rather than permission-seeking
- `system-prompt.md` should forbid permission loops in `$task_mode`; if the next action is available and obvious, the prompt should push the agent to execute it instead of offering or asking
- `system-prompt.md` should push discovery-first autonomy in `$task_mode`: if a needed fact is likely available from browser state runtime apis current page prior telemetry transient context attachments or ordinary fetch, the prompt should push the agent to discover it before asking the user
- `system-prompt.md` should encode the rule `action creates information`: when uncertain in `$task_mode`, the prompt should push the agent toward the safest useful info-creating execution rather than a stopping reply
- `system-prompt.md` should push best-effort continuation in `$task_mode`: if user intent is clear and a recoverable uncertainty remains, the prompt should push the agent to use current context or runtime discovery before stopping
- `system-prompt.md` should treat omitted scope as current-context by default when that scope is the natural reading of the request
- `system-prompt.md` should treat self-referential scope words like `mine`, `here`, `local`, and `current` as instructions to use current context, and should prefer attempting direct browser or runtime access before asking
- `system-prompt.md` should define `$verified_completion` against the requested outcome, not against intermediate discovery, and should push the agent to continue when a prerequisite read only unlocks the obvious next step
- `system-prompt.md` should force unavoidable blocking questions into one direct minimal question with no acknowledgement preface and no narration like `I can...` or `I need...`
- `system-prompt.md` should treat short follow-up user fragments as likely missing values or redirects for active work when they fit
- `system-prompt.md` should force follow-up extraction after broad reads: if one more read can unpack or extract the answer, the prompt should push the agent to execute that read instead of stopping
- avoid concrete blocker examples that can over-anchor one domain behavior; prefer general rules when the concept is reusable
- the ordered turn loop has already helped steer the agent toward correct execution-first behavior; prefer strengthening that loop over adding more fragmented local rules
- prefer one explicit decision loop over scattered local rules when the same behavior can be expressed once in order
- `system-prompt.md` should stay focused on overlay-wide protocol and runtime-generic execution behavior; module-specific helper names, staged workflows, and feature policy belong in owner-module just-loaded skills or owner-module `_core/onscreen_agent/...` prompt extensions instead of the base firmware prompt
- screenshot examples in `system-prompt.md` should use the first-party `/mod/_core/skillset/screenshots.js` helper instead of teaching remote script injection
- prompt promotion requires both automated harness success and manual review of the nominal passes; raw leaderboard position alone is not enough
- before replacing `system-prompt.md` with a promoted test variant, back up the previous live file in this folder and record the promotion source in docs
- when several prompts hit the same strict matrix score, prefer the prompt with better full-suite repeat stability over the prompt with the newest one-shot clean run
- as of 2026-04-07, the current live firmware prompt was promoted from `tests/agent_llm_performance/prompts/069A_handoff_no_copy.md` after the `070` through `075` sweep because it remained the best overall prompt on the 57-case suite: strongest one-shot score and best full-suite repeat stability among the finalists on `openai/gpt-5.4-mini`; the previous live prompt was backed up as `prompts/system-prompt.backup-before-069A-handoff-no-copy-2026-04-07.md`
- both compaction prompts must require one plain-text block starting with `Conversation summary:`
- when prompt file paths change, update `../llm.js` and `../AGENTS.md` in the same session
- whenever these prompt files change, also update the matching docs under `app/L0/_all/mod/_core/documentation/docs/agent/`
- whenever these prompt files change, measure token counts with the local tokenizer in the same session

## Development Guidance

- keep examples minimal and only when they change behavior materially
- avoid repeating the same rule in multiple prompt files
- prefer short concrete lines over explanatory paragraphs
- if a prompt can lose words without losing obedience, cut it
