# AGENTS

## Purpose

`app/` is the browser-runtime root.

It is organized into a three-layer modular runtime:

- `L0/`: immutable firmware
- `L1/`: editable group customware
- `L2/`: editable user customware

## Layer Rules

- `L0` is firmware and should only change through updates
- `L1` contains per-group customware; subfolders are group ids and `_all` plus `_admin` must always exist
- `L2` contains per-user customware; subfolders are usernames
- users should only write inside their own `L2/<username>/`
- users should only read through the group and user inheritance chain that applies to them
- groups may include users and groups, and may declare managers that can write to that group's `L1` area
- modules are the only supported extension unit
- each group or user owns a `mod/` folder, with module contents under `mod/<author>/<repo>/...`
- server-owned concerns such as raw proxy transport and SQLite access do not belong here unless they are browser clients for those services
- keep non-HTML browser assets fetchable through `/mod/...`, not through ad hoc top-level static paths
- keep `L0/` root narrow: root HTML entry shells plus `mod/`
- pack the shared browser runtime under `L0/mod/_all/mod/_core/framework/`
- pack the current chat UI under `L0/mod/_all/mod/_core/chat/`

## Frontend Patterns

- Prefer framework-backed pages over page-local imperative bootstraps.
- A page shell should usually load framework assets from `/mod/_core/framework/`, then mount a root `x-component` from `/mod/...` instead of owning complex inline markup and controller logic itself.
- Put page behavior into a dedicated Alpine store created with `createStore(...)`.
- Store-dependent component content should be gated with `x-data` plus `template x-if="$store.<name>"` before rendering.
- Use Alpine handlers such as `@click`, `@submit.prevent`, `@input`, `@keydown`, `x-model`, `x-text`, `x-ref`, `x-init`, and `x-destroy` instead of wiring most UI behavior through `querySelector` and manual event listener registration.
- Use `x-component` includes for reusable or page-root UI fragments instead of duplicating markup in page shells.
- When a component needs DOM references, pass them into the store from Alpine via `x-ref` during mount rather than having the store scan the document globally.
- Keep stores responsible for controller state, persistence, async flows, and orchestration. Keep render-only DOM assembly helpers in separate modules when the UI is too complex for direct Alpine templating alone.
- Prefer one public browser runtime namespace. Expose browser-facing APIs through `A1`, and nest chat-specific execution data under `A1.currentChat` instead of adding parallel aliases.
- Keep `runtime.js` generic. Feature-specific runtime state such as chat attachments or message mirrors belongs in the owning feature store, not in the shared runtime bootstrap.

## Current State

Only the first simplified slice is active today.

- `/mod/...` resolves only from `L0/mod/_all/`
- inheritance across `L0`, `L1`, and `L2` is not implemented yet
- the main `L0/index.html` entry now boots `/mod/_core/framework/` and mounts `/mod/_core/chat/chat-page.html`
- non-`/mod` requests should stay limited to root HTML shells under `L0/`
