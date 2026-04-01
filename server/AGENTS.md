# AGENTS

## Purpose

`server/` is the thin local infrastructure layer.

It should not become the primary application runtime.

## Responsibilities

- serve root HTML entry shells from `app/L0/`
- resolve browser-delivered modules from the layered `app/L[0-2]/` customware model
- expose framework-style API modules from `server/api/`
- provide the raw outbound fetch proxy at `/api/proxy`
- eventually own SQLite persistence

## Structure

- `app.js`: server factory
- `server.js`: server startup entry
- `dev-server.js`: source-checkout dev supervisor that restarts `serve` on server-side changes
- `lib/`: shared server-side utilities that can be reused by CLI and infrastructure code without moving app logic onto the server
- `lib/api/registry.cjs`: API module loader
- `lib/app-files.cjs`: path normalization and glob/file matching helpers for browser-layer file discovery
- `lib/git/`: backend-abstracted Git client used by source-checkout update flows
- `lib/file-watch/`: watched-file aggregate infrastructure
- `lib/file-watch/store.cjs`: reusable YAML-configured watched-file aggregate store
- `lib/file-watch/path-index.cjs`: path-index aggregate built on top of the watched-file aggregate store
- `lib/file-watch/config.yaml`: watched file-glob configuration shared by file-backed aggregates
- `api/`: simple endpoint modules loaded by name
- `proxy/`: request routing, request parsing, response shaping, CORS handling, and upstream fetch proxy implementation

## API Module Contract

Files in `server/api/` are named by endpoint.

Example:

- `/api/asset_get` loads `server/api/asset_get.js`

Modules can export handlers such as:

- `get(context)`
- `post(context)`
- `put(context)`
- `patch(context)`
- `delete(context)`

Handlers may return:

- plain JS values
  These are serialized as JSON automatically.
- explicit HTTP-style response objects
  Use these when status, headers, binary bodies, or streaming behavior matter.
- Web `Response` objects
  Also supported for advanced cases.

## Guidance

- keep endpoints narrow and explicit
- prefer plain JS returns for simple REST-style JSON APIs
- use explicit response objects only when needed
- keep shared server-side libraries infrastructure-focused and reusable
- keep proxy and persistence infrastructure separate from app orchestration
- keep static file serving aligned with the modular browser contract: frontend assets should come through `/mod/...`
- keep inheritance resolution explicit and small; the current implementation only serves `/mod/...` from `app/L0/mod/_all/`
- keep watched-file aggregate infra config-driven and reusable so new server-side aggregates can share the same source scan
- keep source-checkout dev tooling here only when it directly supports the local server workflow
