# Runtime Overview

This doc is the shortest map of the whole system.

## Core Idea

Space Agent is browser-first:

- the browser app in `app/` is the primary runtime
- the server in `server/` is thin infrastructure for page shells, auth, APIs, module delivery, app-file access, and outbound fetch proxying
- the CLI in `space.js` plus `commands/` starts and manages that runtime

Default implementation rule:

- new behavior belongs in the frontend unless a backend boundary is required for security, shared-data integrity, cross-user isolation, or runtime stability
- backend edits are exceptional and should be requested or explicitly approved, not assumed as the default implementation path

The repo is designed so the agent can act through browser state plus narrow backend contracts instead of moving application logic onto the server.

## Major Entry Files

- `space.js`: CLI entry router that discovers commands dynamically
- `commands/serve.js`: runtime startup command and launch-time param overrides
- `commands/supervise.js`: command-owned production-ready zero-downtime supervisor for source checkout auto-updates
- `server/server.js` and `server/app.js`: create and start the local HTTP runtime
- `packaging/desktop/main.js`: Electron desktop host that starts the server on a free loopback port and loads the resolved runtime URL
- `server/router/router.js`: exact request ordering
- `server/pages/*.html`: server-owned page shells for `/`, `/admin`, `/login`, and `/enter`
- `app/L0/_all/mod/_core/framework/js/initFw.js`: frontend bootstrap
- `app/L0/_all/mod/_core/router/`: authenticated root app shell
- `app/L0/_all/mod/_core/onscreen_agent/`: floating routed overlay agent

## Runtime Surfaces

- `/`: authenticated app shell, then `_core/router`
- `/admin`: authenticated firmware-only admin shell with `maxLayer=0`
- `/login`: public sign-in shell
- `/enter`: recovery-safe launcher shell for launcher-eligible sessions
- `/api/<endpoint>`: backend endpoint surface
- `/api/proxy`: authenticated outbound fetch proxy
- `/mod/<author>/<repo>/...`: browser module delivery
- `/~/...` and `/L0/...`, `/L1/...`, `/L2/...`: authenticated direct app-file fetches

## Layered Runtime Model

The browser and the module resolver use three logical layers:

- `L0`: firmware, immutable by normal runtime writes
- `L1`: group customware
- `L2`: user customware

Important consequences:

- frontend modules are delivered through `/mod/...`, but their backing files may come from `L0`, `L1`, or `L2`
- writable `L1` and `L2` may live under `CUSTOMWARE_PATH/L1` and `CUSTOMWARE_PATH/L2` even though logical paths stay `L1/...` and `L2/...`
- admin UI module resolution is clamped to `L0` through `maxLayer=0`

## Documentation Sources

For work in this repo, use these in order:

1. user request and explicit local context
2. relevant `AGENTS.md` files
3. the docs in this module
4. concrete code

Read `architecture/documentation-system.md` next if you need the documentation rules themselves.
