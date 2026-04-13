# Skills And Documentation

This doc covers the shared browser-side skill-loading contract and the documentation skill/helper contract.

## Primary Sources

- `app/L0/_all/mod/_core/onscreen_agent/AGENTS.md`
- `app/L0/_all/mod/_core/skillset/AGENTS.md`
- `app/L0/_all/mod/_core/onscreen_agent/skills.js`
- `app/L0/_all/mod/_core/skillset/skills.js`
- `app/L0/_all/mod/_core/skillset/ext/skills/development/AGENTS.md`
- `app/L0/_all/mod/_core/documentation/AGENTS.md`
- `app/L0/_all/mod/_core/documentation/documentation.js`

## Skill Discovery

Onscreen skills are discovered from readable module trees:

- top-level catalog pattern: `mod/*/*/ext/skills/*/SKILL.md`
- full skill tree pattern: `mod/*/*/ext/skills/**/SKILL.md`

Important rules:

- top-level skills appear in the prompt catalog automatically
- nested skills are not listed by default
- both catalog visibility and explicit skill loads evaluate the current document's live `<x-skill-context>` tags
- `metadata.when.tags` requires all listed tags before the skill becomes catalog-loadable
- any readable skill at any depth may still be just-loaded with `metadata.just_loaded: true` or `metadata.just_loaded.tags`
- skill ids are relative to `ext/skills/` without the trailing `/SKILL.md`

Current first-party skill-context examples:

- `_core/onscreen_agent/panel.html` exports `onscreen`
- `_core/admin/views/shell/shell.html` exports `admin`
- `_core/router/view.html` exports `route:<current-path>`
- `_core/spaces/view.html` exports `space:open` when a current space is active

Examples:

- `ext/skills/documentation/SKILL.md` -> `documentation`
- `ext/skills/development/modules-routing/SKILL.md` -> `development/modules-routing`

## Loading And Visibility

On-demand loading uses:

```js
await space.skills.load("skill/path")
```

Loaded skill content is inserted into execution output and then becomes part of history.

Visibility rules:

- readable group-scoped modules may contribute extra skills
- admin-only groups may contribute admin-only skills
- module-owned skill-context tags may hide those skills unless the current page exports the required tags
- same-module layered overrides replace lower-ranked skill files before the catalog is built

Conflict rules:

- skill ids must be unique across readable modules
- conflicting ids are omitted from the catalog
- loading a conflicting id fails with an ambiguity error

## Current First-Party Shared Top-Level Skills

Current repo-owned shared top-level skills include:

- `development`
- `file-download`
- `spaces`
- `screenshots`
- `user-management`
- `documentation`

Additional group-scoped skills may exist for narrower audiences.

Some of those first-party ids are still gated by live skill-context tags. For example, the shared `development`, `file-download`, and `user-management` skills require `onscreen`, while `spaces` requires `route:spaces`.

The first-party `development` tree is intentionally split into narrower nested skills. In particular, `development/modules-routing` now teaches custom routed pages as the main alternative to spaces when the user wants a reusable feature surface, and it may reference small importable helper scripts under the same module tree instead of pasting long browser snippets into the skill text.

The first-party `screenshots` skill imports `/mod/_core/skillset/screenshots.js`. That helper lazy-loads the vendored `html2canvas@1.4.1` bundle from `/mod/_core/skillset/vendor/html2canvas.min.js`, so page screenshots do not depend on jsDelivr or another CDN at runtime.

## Documentation Skill And Helper

Broad orientation starts in the top-level `documentation` skill:

```js
await space.skills.load("documentation");
```

That skill carries the compact docs map directly in its body. Use the helper below only for focused follow-up reads once you know the path you need.

The documentation helper lives at:

```txt
/mod/_core/documentation/documentation.js
```

Stable exports:

- `read("relative/path.md")`
- `url("relative/path.md")`

Examples:

```js
await space.skills.load("documentation");
const documentation = await import("/mod/_core/documentation/documentation.js");
const filesDoc = await documentation.read("server/api/files.md");
```

## How To Use These Docs Correctly

- use the `documentation` skill for fast orientation
- use the helper for focused doc reads once you know the relative path
- use the relevant `AGENTS.md` file for the concrete contract
- use code for exact implementation detail

When you change a stable contract or workflow, update all three layers together.
