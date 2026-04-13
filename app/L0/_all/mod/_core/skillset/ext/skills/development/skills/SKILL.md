---
name: Skill Authoring
description: Author or update onscreen agent skills under ext/skills
---

Use this skill when creating or updating skills for the onscreen chat agent.

## Skill File Layout

- Onscreen chat-agent skills live inside browser modules under `mod/<author>/<repo>/ext/skills/...`.
- Repo-owned first-party shared onscreen skills should normally live under `app/L0/_all/mod/_core/skillset/ext/skills/...`.
- Module-specific skills that describe one module's private contracts may live under that owning module's `ext/skills/...` tree.
- Group-scoped or admin-only onscreen skills may live under readable customware roots such as `app/L0/_admin/mod/_core/<module>/ext/skills/...`.
- A skill file is always named `SKILL.md`.
- The skill id is the path relative to `ext/skills/` with the trailing `/SKILL.md` removed.

Examples:

- `mod/_core/skillset/ext/skills/development/SKILL.md` -> `development`
- `mod/_core/skillset/ext/skills/development/modules-routing/SKILL.md` -> `development/modules-routing`

## Catalog Rules

- The onscreen prompt catalog lists only top-level skills from `ext/skills/*/SKILL.md`.
- Nested skills are not listed by default.
- Both the catalog and explicit `space.skills.load(...)` calls evaluate the current document's `<x-skill-context>` tags before a skill is eligible.
- `metadata.when.tags` requires all listed tags before the skill becomes catalog-loadable.
- Any readable skill at any depth can still be injected into the system prompt when its frontmatter sets `metadata.just_loaded: true` or another `metadata.just_loaded.tags` condition that currently passes.
- Just-loaded skills appear after the catalog in the `just loaded` prompt block as repeated `id: <skill-id>` markers followed by the skill body text.
- Routing skills should tell the agent which deeper skill ids to load next.
- `space.skills.load("<path>")` loads the full skill file on demand and inserts its content into history through execution output.
- A plain top-level `await space.skills.load("<path>")` is enough to inject the skill content; use `return` only if you also want the execution result value explicitly.

## Conflict Rules

- Skill ids must be unique across readable mods.
- If a skill is visible only to a narrower audience, still give it a top-level id that will not collide with shared `_all` skills that those users can also read.
- Conflicting ids are omitted from the catalog.
- Loading a conflicting id fails with an ambiguity error.

## Skill Content Rules

- Start with frontmatter containing `name`, `description`, and optional runtime-owned `metadata`.
- Use `<x-skill-context>` tags in mounted DOM when a module needs to expose live skill-filter state such as `onscreen`, `admin`, `route:spaces`, or `space:open`.
- Use `metadata.when.tags` when the skill should exist only in those live contexts.
- Use `metadata.just_loaded` only when the skill should be auto-injected after the catalog without an explicit `space.skills.load(...)` call.
- Prompt-facing skill text is token-budgeted. Keep wording terse, avoid unnecessary markdown or filler, and measure before or after changes with the local tokenizer when you edit just-loaded or catalog-facing skill text.
- When a skill needs reusable browser logic, prefer a small module-local JS helper imported from a stable `/mod/<author>/<repo>/...` path instead of pasting a long inline script into `SKILL.md`.
- Keep the top-level router skill directive and concise.
- Keep nested skills focused on one stable area.
- Prefer exact file paths, runtime names, and examples over vague guidance.
- If a skill subtree becomes complex, add an `AGENTS.md` file inside that subtree and keep it current.

## Maintenance Rules

- When a mirrored source contract changes, update the affected skill files in the same session.
- When a stable feature or workflow changes, update the relevant docs under `/mod/_core/documentation/docs/` and the documentation skill at `/mod/_core/documentation/ext/skills/documentation/SKILL.md` in the same session.
- Do not let skill guidance drift away from the owning `AGENTS.md` files.
- For the development super-skill specifically, keep `/mod/_core/skillset/ext/skills/development/AGENTS.md` current whenever the framework, router, API, layer, or auth contracts it mirrors change.
