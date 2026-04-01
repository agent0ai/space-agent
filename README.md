# Agent One

Browser-first AI agent runtime with a thin local Node.js server.

The browser app is the primary runtime. The server exists to keep a narrow boundary around:

- outbound fetch proxying for requests that would otherwise hit CORS limits
- SQLite ownership and integrity-safe persistence operations

## Status

This repo is being refactored into a modular three-layer runtime:

- `app/L0/`: immutable firmware, changed only through updates
- `app/L1/`: runtime-editable group customware
- `app/L2/`: runtime-editable user customware

Special groups `_all` and `_admin` always exist.
Users will read through their effective group chain in `L0` and `L1`, and only write inside their own `L2/<username>/` area.
Groups can include users and other groups, and can declare managers that may write to that group's `L1` customware.

Modules are the only extension unit.
Each group or user owns a `mod/` folder, and module contents live under a two-part namespace:

- `app/L0/mod/<group-id>/mod/<author>/<repo>/...`
- `app/L1/<group-id>/mod/<author>/<repo>/...`
- `app/L2/<username>/mod/<author>/<repo>/...`

Frontend assets are fetched as `/mod/<author>/<repo>/...`.
The intended resolution chain is firmware first, then group customware, then user overrides.
That full inheritance model is not implemented yet.

Current simplified behavior:

- `/mod/...` is served only from `app/L0/mod/_all/`
- non-`/mod` browser requests only serve root-level HTML files from `app/L0/`
- the main chat boot path already runs through `/mod/_core/framework` and `/mod/_core/chat`

## Requirements

- Node.js 20 or newer

## Source Install

Install the runtime dependencies and start the local browser-first app:

```bash
npm install
npm run dev
```

CLI commands also read project-local `.env` and `.env.local` files when present.
On standard installs, npm will also attempt to install the optional `nodegit` backend for faster non-system Git operations when native Git is unavailable. If that native install fails, the updater still falls back to bundled `isomorphic-git`.

If you are installing in a constrained environment where native addons are not expected to work, skip optional dependencies:

```bash
npm install --omit=optional
```

`npm run dev` uses a small supervisor under `server/` to watch `A1.js`, `commands/`, and `server/`, then restarts the local server when server-side code changes.
Browser files under `app/` still need a manual browser refresh because live reload is not wired in yet.

Or run the server directly:

```bash
node A1.js serve
```

The web server binds to `0.0.0.0` by default so container hosts like Render can detect the open port.
The CLI prints a browser-friendly local URL such as `http://127.0.0.1:3000`.
For a local-only bind, pass `--host 127.0.0.1`.

## Optional Packaging Toolchain

Desktop and packaging features are installed separately so a normal source install stays lean.

Install packaging-only dependencies when you need Electron or native build output:

```bash
npm run install:packaging
```

After that, the desktop host and packaging commands are available.

## Desktop Commands

Run the current Electron desktop host:

```bash
npm run desktop:dev
```

Build an unpacked desktop app for the current host platform:

```bash
npm run desktop:pack
```

Build packaged output for the current host platform:

```bash
npm run desktop:dist
```

Build a specific desktop target:

```bash
npm run package:desktop:macos
npm run package:desktop:linux
npm run package:desktop:windows
```

Packaging output is written under:

```text
dist/desktop/<platform>
```

Examples:

- `dist/desktop/macos`
- `dist/desktop/linux`
- `dist/desktop/windows`

## Updating A Source Checkout

The updater is for source checkouts only. It requires a real git worktree.

Update the current branch:

```bash
node A1.js update
```

Update to a specific branch:

```bash
node A1.js update --branch main
node A1.js update main
```

Move the current or remembered branch to a specific tag:

```bash
node A1.js update v0.3
```

Move to a specific commit:

```bash
node A1.js update 1a2b3c4
node A1.js update 1a2b3c4d5e6f...
```

Update behavior:

- plain `update` fast-forwards the current branch from `origin`
- if you previously moved to a tag or commit, plain `update` reconnects to the remembered branch or the remote default branch
- tag and commit updates stay on a branch when a current or remembered branch can be recovered
- detached HEAD is only used as a fallback when no branch can be recovered
- tracked local changes block the update so internal files are not silently overwritten
- the update backend order is native Git first, then NodeGit if it is installed and loadable, then bundled `isomorphic-git`
- standard `npm install` attempts to install `nodegit` automatically as an optional dependency
- use `npm install --omit=optional` when packaging for environments that cannot build or load native addons
- set `A1_GIT_BACKEND` to `native`, `nodegit`, or `isomorphic` if you need to force a specific backend
- when the fallback backend has to reach a private HTTPS remote, provide credentials with `AGENT_ONE_GIT_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`

## CLI Surface

The supported CLI commands are:

```bash
node A1.js serve
node A1.js update
node A1.js help
node A1.js --help
node A1.js version
node A1.js --version
```

## Top-Level Layout

```text
A1.js         Root CLI router
commands/     CLI command modules
server/       Thin local server
app/          Layered browser runtime
packaging/    Native hosts, packaging scripts, and platform metadata
```

## Design Direction

- browser first, server last
- modules first for browser-delivered code and assets
- keep agent logic in the browser whenever possible
- keep the server narrow and explicit
- keep native hosts thin
- treat packaging as optional infrastructure around the browser runtime, not the main runtime
