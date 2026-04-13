---
name: Documentation
description: Read the supplemental project documentation module
---

Use this skill when you need project orientation before editing or answering architecture questions.

helper
- Import `/mod/_core/documentation/documentation.js`
- `read("path/to/file.md")` reads a nested markdown doc relative to `docs/`
- `url("path/to/file.md")` builds the resolved `/mod/...` URL for a doc file

workflow
- Start with the built-in documentation index below unless you already know the exact doc path
- Use one focused `read("path/to/file.md")` call instead of loading many large docs blindly
- Treat `/README.md` as the public product source of truth for the project pitch, quick starts, release links, community links, and DeepWiki discovery
- After orientation, confirm the concrete contract in the owning `AGENTS.md` file and then inspect code when needed
- Keep the repo's frontend-first rule in mind while reading: backend docs explain constraints and existing contracts, not default permission to edit `server/`
- If the change appears to require backend work and the user did not explicitly ask for backend edits, ask for permission and explain the security, integrity, or stability reason before changing backend files
- When you change a stable contract or workflow, update both the relevant `AGENTS.md` files and the matching docs in `/mod/_core/documentation/docs/`
- When you add, remove, rename, or substantially repurpose a doc file, update this skill's in-file index in the same session

recommended starting points
- overall system shape: `architecture/overview.md`
- desktop host or packaging flow: `architecture/desktop-host-and-packaging.md`
- documentation rules: `architecture/documentation-system.md`
- frontend runtime and layers: `app/runtime-and-layers.md`
- admin agent runtime: `app/admin-agent-runtime.md`
- modules, routing, or extensions: `app/modules-and-extensions.md`
- browser-side Hugging Face testing: `app/huggingface-browser-runtime.md`
- browser-side WebLLM testing: `app/webllm-browser-runtime.md`
- spaces and widgets: `app/spaces-and-widgets.md`
- overlay agent runtime: `agent/onscreen-agent-runtime.md`
- prompt or execution protocol: `agent/prompt-and-execution.md`
- skills or this documentation surface: `agent/skills-and-documentation.md`
- server routing or pages: `server/request-flow-and-pages.md`
- server jobs or maintenance loops: `server/jobs-and-maintenance.md`
- app-file APIs: `server/api/files.md`
- module, login, or runtime endpoints: `server/api/modules-and-runtime.md`
- auth and sessions: `server/auth-and-sessions.md`
- layered filesystem, `CUSTOMWARE_PATH`, or writable-layer history: `server/customware-layers-and-paths.md`
- CLI commands or runtime params: `cli/commands-and-runtime-params.md`

docs path|name|description↓
architecture/overview.md|Runtime Overview|Browser-first architecture, major entry surfaces, and the layered runtime model.
architecture/desktop-host-and-packaging.md|Desktop Host And Packaging|Electron host startup, free-port binding, packaged single-user behavior, and desktop build outputs.
architecture/documentation-system.md|Documentation System|How `AGENTS.md`, the documentation module, and code fit together, plus update rules.
app/runtime-and-layers.md|App Runtime And Layers|Frontend boot flow, `space` runtime namespaces, entry shells, and `L0/L1/L2` rules.
app/admin-agent-runtime.md|Admin Agent Runtime|Admin chat ownership, config persistence, shared execution loop, and API-versus-local-Hugging-Face transport switching.
app/modules-and-extensions.md|Modules And Extensions|`/mod/...` delivery, router path resolution, `ext/html`, `ext/js`, and `<x-component>` behavior.
app/huggingface-browser-runtime.md|Hugging Face Browser Runtime|The routed Transformers.js test surface, its worker split, direct Hub model loading contract, and throughput metrics.
app/webllm-browser-runtime.md|WebLLM Browser Runtime|The routed WebLLM test surface, its worker split, model-loading modes, and throughput metrics contract.
app/spaces-and-widgets.md|Spaces And Widgets|Space storage, widget renderer contracts, widget-shell defaults, and the main `space.current` / `space.spaces` helpers.
agent/onscreen-agent-runtime.md|Onscreen Agent Runtime|Overlay ownership, persistence, defaults, UI/runtime surfaces, and prompt file ownership.
agent/prompt-and-execution.md|Prompt And Execution|Prompt assembly order, message markers, execution transcript rules, and compaction behavior.
agent/skills-and-documentation.md|Skills And Documentation|Skill discovery rules, top-level versus nested skills, conflict rules, and the documentation skill/helper contract.
server/request-flow-and-pages.md|Request Flow And Pages|Exact server routing order, page shell contracts, auth gating, and direct app-file fetches.
server/jobs-and-maintenance.md|Jobs And Maintenance|Primary-owned periodic jobs, interval scheduling, mutation publishing, and guest cleanup maintenance rules.
server/api/files.md|File APIs|The authenticated file endpoints, path forms, writable discovery, folder downloads, and optional local history APIs.
server/api/modules-and-runtime.md|Module And Runtime APIs|Module endpoints, login/runtime endpoints, `extensions_load`, and identity helpers.
server/auth-and-sessions.md|Auth And Sessions|User storage layout, sealed password/session records, and login/runtime auth behavior.
server/customware-layers-and-paths.md|Customware Layers And Paths|Logical-versus-disk paths, permission rules, optional writable-layer history, override order, and `maxLayer`.
cli/commands-and-runtime-params.md|Commands And Runtime Params|`space.js`, command families, runtime-param precedence, and the current schema surface.

examples
Reading the frontend runtime docs
_____javascript
const documentation = await import("/mod/_core/documentation/documentation.js")
return await documentation.read("app/runtime-and-layers.md")
