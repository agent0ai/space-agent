# AGENTS

## Purpose

`_core/skillset/` owns first-party reusable skill packs, the small browser helper scripts that those skills import, and the shared browser-side skill discovery helper used by both agent surfaces.

This module is not a routed UI surface. It exists to keep skill instructions short, stable, and maintainable by moving repeatable browser-side logic into ordinary importable module files.

Documentation is top priority for this module. After any change under `_core/skillset/`, update this file and any affected parent docs in the same session.

## Documentation Hierarchy

`_core/skillset/AGENTS.md` owns the shared skill-pack module, helper-script ownership, and the map of deeper docs inside this subtree.

Current deeper docs:

- `app/L0/_all/mod/_core/skillset/ext/skills/development/AGENTS.md`

Parent vs child split:

- this file owns module-wide skill-pack ownership, shared skill-discovery helper contracts, and helper-script contracts
- `ext/skills/development/AGENTS.md` owns the shared development skill tree and its mirrored frontend or backend source contracts

Child doc section pattern:

- `Purpose`
- `Documentation Hierarchy` when the subtree owns deeper docs
- `Ownership`
- `Local Contracts`
- `Development Guidance`

Update rules:

- update this file when shared skill-pack ownership, helper APIs, or ownership boundaries change
- update the deeper development-skill doc when the development skill tree, routing map, or mirrored source contracts change
- when framework, router, API, path, permission, or auth contracts change in ways that affect the shared development skill tree, update the deeper doc in the same session

## Ownership

This module owns:

- `ext/skills/development/`: the shared first-party frontend development skill tree and its helper script
- `ext/skills/file-download/SKILL.md`: the top-level onscreen skill for downloading app files, generated files, or external URLs
- `ext/skills/screenshots/SKILL.md`: the top-level onscreen skill for page or element screenshots
- `ext/skills/user-management/SKILL.md`: the top-level onscreen skill for user account and membership file operations
- `skills.js`: shared browser-side skill discovery, frontmatter metadata parsing, live `<x-skill-context>` tag collection, `metadata.when` and `metadata.just_loaded` evaluation, and compact prompt-section builders reused by `_core/onscreen_agent` and `_core/admin`
- `screenshots.js`: browser screenshot helpers, lazy `html2canvas` loading, and the exported screenshot wrapper API
- `vendor/html2canvas.min.js` and `vendor/html2canvas.LICENSE`: vendored `html2canvas@1.4.1` browser bundle and license used by the screenshot helper

## Skill Helper Contract

- this module owns repo-owned shared first-party top-level skills such as `development`, `file-download`, `screenshots`, and `user-management`; module-specific skills that describe one module's private contracts may still live under that owning module
- `skills.js` is the shared owner of the browser-side skill-discovery contract across agent surfaces: skill ids come from `ext/skills/.../SKILL.md`, live page tags come from `<x-skill-context>` elements in the current document, `metadata.when.tags` gates catalog eligibility, and `metadata.just_loaded` controls automatic prompt injection after the catalog
- `metadata.just_loaded` may be `true` or another `{ tags: [...] }` condition; unset means the skill is only loadable on demand
- helper files in this module must stay importable through stable `/mod/_core/skillset/...` paths from skill instructions
- `screenshots.js` is browser-only and should keep its public API small and explicit
- `screenshots.js` lazy-loads the module-local vendored `html2canvas@1.4.1` bundle from `/mod/_core/skillset/vendor/html2canvas.min.js` on first use and reuses the loaded global afterward
- `takeScreenshot(options)` captures `document.body` by default, applies full-page-friendly defaults for body screenshots, and returns `{ canvas, blob, width, height, type, filename }`
- `screenshotBase64(options)` returns `{ base64, width, height, type, filename }`
- `screenshotDownload(filenameOrOptions, maybeOptions)` downloads the captured image and returns `{ downloaded: true, filename, width, height, type }`
- the screenshots skill should point agents at `/mod/_core/skillset/screenshots.js` instead of repeating the low-level `html2canvas` bootstrap inline

## Development Guidance

- keep helper APIs narrow, stable, and easy to call from one short execution block
- prefer module-local helpers over bloating `SKILL.md` with long scripts, but promote a helper into `_core/framework/` only when it becomes general frontend runtime infrastructure rather than skill-focused utility
- when a helper API changes, update the affected `SKILL.md` files in the same session
