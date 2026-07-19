# Documentation System

This repo has three documentation surfaces on purpose.

## The Three Surfaces

`README.md`:

- is the public product source of truth
- explains what Space Agent is, how to start it, and where to find community, releases, and DeepWiki
- must link back to the binding implementation docs instead of replacing them

DOX `AGENTS.md` files:

- are the binding contract layer
- define ownership, stable seams, update obligations, implementation boundaries, and child-doc indexes
- are hierarchical, with deeper `AGENTS.md` files overriding broader ones inside their subtree
- use the standard DOX child-doc shape: `Purpose`, `Ownership`, `Local Contracts`, `Work Guidance`, `Verification`, and `Child DOX Index`
- list direct child docs in each parent `Child DOX Index` so agents walk the contract chain instead of relying on one root-level exhaustive list

The documentation module at `app/L0/_all/mod/_core/documentation/`:

- is the narrative orientation layer for the onscreen agent
- summarizes architecture, workflows, and helper surfaces in browsable markdown files
- is entered through the `documentation` skill and then read on demand through `/mod/_core/documentation/documentation.js`

## Source Of Truth Order

When working:

1. treat the user request as the immediate task contract
2. walk the relevant DOX chain from `/AGENTS.md` to the closest owning child `AGENTS.md`
3. use these docs to orient quickly and find the right area
4. use `README.md` for public positioning, quick starts, and external entry links
5. inspect code for exact implementation details

Apply the architecture bias while reading:

- prefer frontend ownership by default
- do not read backend reference docs as implicit permission to edit `server/`
- if the docs show that a change must cross into backend-owned security or integrity behavior and the user did not ask for backend work, ask for permission before editing server files

If `README.md`, this module, and an `AGENTS.md` file disagree about implementation behavior, the `AGENTS.md` file wins and the public or narrative docs must be updated. If they disagree about public positioning, quick starts, or community links, update `README.md` first and reflect any stable documentation-system change here.

## Helper Surface

The documentation helper lives at `/mod/_core/documentation/documentation.js`.

Stable exports:

- `read("relative/path.md")` reads a nested doc such as `server/api/files.md`
- `url("relative/path.md")` builds the resolved `/mod/...` URL for a doc file

The top-level onscreen skill is `documentation`, and that skill carries the compact docs index directly in its body.

## Update Rules

When a stable contract or workflow changes:

- update the owning `AGENTS.md` file
- update parent `AGENTS.md` files when the broader boundary or `Child DOX Index` changed
- update the relevant docs in this module
- update `ext/skills/documentation/SKILL.md` if you add, remove, rename, or repurpose docs
- update `README.md` when the public project pitch, quick-start flow, release path, community link, or DeepWiki indexing link changes

What does not belong here:

- transient scratch notes
- user-specific task plans
- hidden prompt text
- policy that is not already grounded in source docs or code

## Practical Reading Pattern

- start with the `documentation` skill's built-in index
- walk from the root `/AGENTS.md` through each `Child DOX Index` until you reach the closest owning contract
- read one focused doc
- jump to the owning `AGENTS.md`
- then inspect code

This keeps context small while still preserving accuracy.
