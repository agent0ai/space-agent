# AGENTS

## Purpose

`_core/documentation/` owns the supplemental agent-facing documentation module.

This module is the narrative documentation layer for the repo. It does not replace `AGENTS.md` contracts or the public-facing `README.md`. Instead, it gives the onscreen agent a browsable map of the system, grouped into stable markdown documents that are easy to load on demand through the module resolver.

Documentation is top priority for this module. After any change under `_core/documentation/`, or any stable contract change that affects one of its docs, update this file, the relevant source `AGENTS.md` files, and the matching docs under `docs/` in the same session.

## Documentation Hierarchy

This module owns one documentation tree plus one skill/helper surface.

Current structure:

- `ext/skills/documentation/SKILL.md`: the required entry skill that lists every documentation page by relative path, name, and short description and tells the agent how to read focused docs
- `docs/architecture/`: repo-wide runtime, desktop-host packaging, and documentation-system orientation
- `docs/app/`: frontend runtime, admin-agent, browser-side WebLLM and Hugging Face runtime docs, extension, and spaces documentation
- `docs/agent/`: onscreen-agent runtime, prompt, execution, and skill-system documentation
- `docs/server/`: router, page, API, auth, layered-filesystem, and writable-layer history documentation, including auth-preserving rollback rules
- `docs/cli/`: CLI command and runtime-parameter documentation
- `documentation.js`: fetch-based focused-doc helper imported through `/mod/_core/documentation/documentation.js`

Parent vs child split:

- this file owns the module shape, helper API, skill-owned index rules, and maintenance contract
- `ext/skills/documentation/SKILL.md` owns the browsable map of the docs tree
- the other markdown files own one logical chunk of architecture or workflow guidance each

## Ownership

This module owns:

- `documentation.js`: the stable browser helper for reading focused docs through `/mod/...`
- `docs/`: the supplemental agent-facing documentation corpus
- `ext/skills/documentation/SKILL.md`: the routing skill that teaches the agent how to read the docs and carries the compact documentation index

## Documentation File Contract

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

## Development Guidance

- keep the helper API minimal and explicit
- prefer adding a new markdown doc over bloating the documentation skill index or an unrelated doc once a topic stops fitting cleanly
- update `ext/skills/documentation/SKILL.md` whenever you add, remove, rename, or substantially repurpose a doc file
- when a stable contract changes elsewhere in the repo, update the relevant source `AGENTS.md` first or alongside it, then reflect that change into this module's docs
- when `_core/spaces` changes widget-authoring defaults, keep `docs/app/spaces-and-widgets.md` aligned with `ext/skills/spaces/SKILL.md`, including shell-level expectations such as built-in padding, default surface color, and the default light-on-dark foreground treatment
- when extension-loading behavior changes, keep the matching `docs/app/` and `docs/server/` pages aligned in the same session, and update `docs/cli/` only when the change really affects CLI-managed runtime params
- when skill discovery, skill-context tags, or skill frontmatter rules change, keep `docs/app/modules-and-extensions.md`, `docs/app/admin-agent-runtime.md`, `docs/app/spaces-and-widgets.md`, `docs/agent/skills-and-documentation.md`, and `docs/agent/prompt-and-execution.md` aligned in the same session
- when a new first-party routed page also advertises itself through `ext/pages/*.yaml` or persists user-local promptinclude or settings files, reflect that in `docs/app/modules-and-extensions.md` and `docs/app/runtime-and-layers.md` in the same session
- when framework-managed head seams or page-bootstrap extension seams change, keep `docs/app/modules-and-extensions.md` and `docs/server/request-flow-and-pages.md` aligned in the same session
- do not let this module drift into a second hidden prompt system; it is browsable repo documentation
