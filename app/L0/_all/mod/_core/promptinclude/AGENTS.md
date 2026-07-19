# AGENTS

## Purpose

`_core/promptinclude/` owns prompt-include discovery for the onscreen agent.

It is a headless core module. It does not own a route or UI. Its job is to discover readable `*.system.include.md` and `*.transient.include.md` app files, add the stable prompt-include instructions to the runtime system prompt, append readable system-include files after that instructions block, and inject readable transient-include file contents into the prepared transient message.

Documentation is top priority for this module. After any change under `_core/promptinclude/`, update this file, the affected onscreen-agent docs, and the matching supplemental docs in the same session.

## Ownership

This scope owns:

- `promptinclude.js`: prompt-include constants, readable-file discovery through `file_paths`, batch file reads, alphabetical full-path sorting, keyed system or transient prompt-item builders, and legacy section-formatting helpers
- `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentSystemPromptSections/end/promptinclude.js`: system-prompt item injection for prompt-include instructions plus readable system-include file items
- `ext/js/_core/onscreen_agent/llm.js/buildOnscreenAgentTransientSections/end/promptinclude.js`: transient-item injection for discovered prompt-include file contents

## Local Contracts

### Local Contracts

- readable prompt-include discovery uses the indexed `file_paths` endpoint with `**/*.system.include.md` and `**/*.transient.include.md`; do not add ad hoc filesystem walks here
- discovery follows the existing app-file permission model automatically, so only readable `L0`, `L1`, and the current user's `L2` include files are eligible
- runtime prompt injection should prefer keyed prompt-item maps over legacy flat section arrays so include files can carry stable keys, optional `order`, and trim metadata through the shared prompt-budget path
- system-include files must be appended after the stable prompt-include instructions block and must stay sorted alphabetically by full logical path
- transient rendering must sort includes alphabetically by full logical path and render each file path with a leading `/`
- the system-prompt section text is a stable runtime instruction block and should stay separate from the base firmware prompt file
- system-include sections should preserve file provenance with a compact `source: /logical/path` prefix so prompt inspection stays traceable
- transient prompt-include content should render one fenced block per file and must preserve the file body text exactly
- keyed prompt-include item builders should preserve explicit caller-supplied `key`, `order`, `trimAllowed`, `trimPriority`, and transient `heading` metadata when present, while still defaulting to deterministic path-derived keys and alphabetical order
- this module should fail soft during system or transient injection: discovery or read errors may log locally, but they should not break the whole chat surface

## Work Guidance

### Local Work Rules

- keep this module headless and prompt-focused
- prefer small pure formatting helpers in `promptinclude.js` so prompt rendering can be tested without booting the full browser runtime
- if prompt-include discovery, ordering, or formatting changes, also update `_core/onscreen_agent/AGENTS.md` and the matching docs under `_core/documentation/docs/agent/`

## Verification



## Child DOX Index

- No child DOX docs.
