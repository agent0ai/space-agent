# AGENTS

## Purpose

`_core/documentation/` owns the supplemental agent-facing documentation module.

This module is the narrative documentation layer for the repo. It does not replace `AGENTS.md` contracts or the public-facing `README.md`. Instead, it gives the onscreen agent a browsable map of the system, grouped into stable markdown documents that are easy to load on demand through the module resolver.

Documentation is top priority for this module. After any change under `_core/documentation/`, or any stable contract change that affects one of its docs, update this file, the relevant source DOX `AGENTS.md` files, and the matching docs under `docs/` in the same session.

## Ownership

This module owns:

- `documentation.js`: the stable browser helper for reading focused docs through `/mod/...`
- `docs/`: the supplemental agent-facing documentation corpus
- `ext/skills/documentation/SKILL.md`: the routing skill that teaches the agent how to read the docs and carries the compact documentation index

## Local Contracts

### Documentation File Contract

- `ext/skills/documentation/SKILL.md` must include a compact documentation index that lists every documentation file in the tree
- each skill-index entry must include the relative path, a short human name, and a one-line description
- `documentation.js.read(path)` must accept nested markdown paths such as `server/api/files.md`
- `documentation.js` should stay focused on explicit doc reads and URL resolution; broad orientation belongs in the documentation skill body, not in a second helper round-trip
- markdown docs in this tree should stay standalone enough that the agent can load one file without needing large hidden context
- docs in this tree should summarize stable architecture, helper surfaces, workflows, and navigation paths; binding contracts still live in `AGENTS.md`
- `README.md` owns public project positioning, quick starts, release links, community links, and the DeepWiki badge; this module may summarize that relationship but should not duplicate the README's marketing copy
- when a doc describes a routed runtime surface with multiple internal panes, capture the stable scroll and viewport-capping ownership there so layout behavior does not drift between modules
- when a doc summarizes a runtime surface, it should name the primary source files and the owning `AGENTS.md` file so drift is easy to correct
- keep docs grouped by logical area instead of one giant file
- avoid transient notes, ad hoc scratch docs, or duplicating the full text of `AGENTS.md`; summarize and connect the source contracts instead

## Work Guidance

### Local Work Rules

- keep the helper API minimal and explicit
- prefer adding a new markdown doc over bloating the documentation skill index or an unrelated doc once a topic stops fitting cleanly
- update `ext/skills/documentation/SKILL.md` whenever you add, remove, rename, or substantially repurpose a doc file
- when a stable contract changes elsewhere in the repo, update the relevant source DOX `AGENTS.md` first or alongside it, then reflect that change into this module's docs
- when `_core/spaces` changes widget-authoring defaults, keep `docs/app/spaces-and-widgets.md` aligned with `ext/skills/spaces/SKILL.md`, including shell-level expectations such as built-in padding, default surface color, and the default light-on-dark foreground treatment
- when bundled onboarding or welcome demo widgets change stable data-cleanup behavior, keep `docs/app/spaces-and-widgets.md` aligned with the owning `_core/spaces` and `_core/dashboard_welcome` contracts in the same session
- when extension-loading behavior changes, keep the matching `docs/app/` and `docs/server/` pages aligned in the same session, and update `docs/cli/` only when the change really affects CLI-managed runtime params
- when skill discovery, context tags, or skill frontmatter rules change, keep `docs/app/modules-and-extensions.md`, `docs/app/admin-agent-runtime.md`, `docs/app/spaces-and-widgets.md`, `docs/agent/skills-and-documentation.md`, and `docs/agent/prompt-and-execution.md` aligned in the same session
- when the shared `development` router skill changes its visibility model or nested-skill index structure, keep `docs/agent/skills-and-documentation.md` aligned in the same session
- when the `space.browser` runtime surface or the top-level `browser-control` skill changes, keep `docs/app/runtime-and-layers.md` and `docs/agent/skills-and-documentation.md` aligned in the same session
- when a new first-party routed page also advertises itself through `ext/panels/*.yaml` or persists user-local promptinclude or settings files, reflect that in `docs/app/modules-and-extensions.md` and `docs/app/runtime-and-layers.md` in the same session
- when dashboard panel creation or panel-navigation helper workflows change, keep `docs/app/modules-and-extensions.md`, `docs/agent/skills-and-documentation.md`, and `ext/skills/documentation/SKILL.md` aligned in the same session
- when a new first-party shell extension or router-overlay module lands, keep `docs/app/modules-and-extensions.md` aligned with the owning module doc in the same session
- when framework-managed head seams or page-bootstrap extension seams change, keep `docs/app/modules-and-extensions.md` and `docs/server/request-flow-and-pages.md` aligned in the same session
- when framework-owned Alpine helper directives change route-to-shell injection behavior, keep `docs/app/modules-and-extensions.md` and any affected feature docs such as `docs/app/spaces-and-widgets.md` aligned in the same session
- when routed shell-clearance ownership changes between `_core/router` and a feature route such as `_core/dashboard`, keep `docs/app/runtime-and-layers.md` and `docs/app/modules-and-extensions.md` aligned with the owning `AGENTS.md` files in the same session
- when the live prompt changes how off-runtime website visits are handled, keep `docs/agent/prompt-and-execution.md` and `docs/agent/skills-and-documentation.md` aligned with the prompt and `browser-control` contract in the same session
- when onscreen-agent send-loop, execution transcript, or queued follow-up behavior changes, keep `docs/agent/onscreen-agent-runtime.md` aligned with `_core/onscreen_agent/AGENTS.md` in the same session
- when clustered write-path diagnostics or their repeatable harness change, keep `docs/server/api/files.md` aligned with `tests/server_cluster_write_stress_test.mjs` and the owning `tests/AGENTS.md` contract in the same session
- do not let this module drift into a second hidden prompt system; it is browsable repo documentation

## Verification



## Child DOX Index

- No child DOX docs.
