# AGENTS

## Purpose

`server/runtime/` owns the multi-worker server runtime glue.

This subtree keeps clustered process startup, worker bootstrap, request-scoped mutation capture, and unified cross-worker state replication explicit and small. It is the coordination layer between HTTP workers and the authoritative server state, not a place for endpoint logic or filesystem policy.

Documentation is top priority for this subtree. After any change under `server/runtime/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `cluster.js`: clustered primary and worker startup, worker bootstrap, IPC dispatch, worker-local sync, and primary state hosting
- `ipc.js`: cluster IPC message ids and request-id generation
- `state_system.js`: authoritative area-or-id state engine, global replicated versioning, delta retention, snapshot replay, primary-only entries, and named locks
- `state_areas.js`: canonical area names for replicated and primary-only state shards
- `request_mutations.js`: request-scoped app-path mutation capture and commit helpers
- `mutation_capture.js`: `AsyncLocalStorage` capture of mutated logical app paths
- `app_path_mutations.js`: runtime hook that lets clustered workers suppress local post-write side effects that belong to the primary
- `worker_entry.js`: cluster worker entrypoint

## Local Contracts

Cluster runtime rules:

- `WORKERS=1` stays on the normal single-process runtime
- `WORKERS>1` starts a primary plus worker-process model through `cluster.js`
- workers own normal HTTP handling, cookie validation, and local filesystem writes
- the primary owns the authoritative watchdog, the authoritative unified state system, and any server-owned periodic jobs
- workers keep replica watchdog snapshots and apply primary-published state deltas or snapshot resets by version
- clustered processes should set distinct OS process titles for operator tools: the primary uses `space-serve-p`, and workers use `space-serve-w<N>` with stable worker ordinals

Unified state-system rules:

- worker-visible state is stored as `state[area][id]`
- one `(area,id)` value is one replication unit; updates replace the whole shard value
- replicated state shares one global monotonic version for request fencing and worker catch-up
- the primary retains only the most recent delta window, currently `1000` versions, and workers that fall behind that window must request a full snapshot
- entries may opt out of replication with `replicate: false`; those entries stay primary-only and may carry a TTL
- named locks are explicit and token-based through `acquireLock` and `releaseLock`
- login challenges live in the primary-only `login_challenge/<token>` area today, and future shared coordination should reuse this system instead of inventing ad hoc primary RPC paths
- periodic job scheduling should also reuse this primary-owned coordination surface, especially named locks, rather than adding process-local lockfiles or worker-side schedulers

Mutation and visibility rules:

- mutating request paths are captured through `request_mutations.js`
- workers perform the filesystem mutation first, then commit the affected logical project paths to the primary once
- the primary updates the authoritative watchdog-derived state, schedules any debounced writable-layer Git history commits for those rebuilt owner roots, and publishes deltas or snapshots asynchronously; writes do not wait for every worker to acknowledge
- request-to-request freshness is enforced through `Space-State-Version`: responses advertise the worker's current replicated version, and requests may require a minimum version before handling continues
- responses also advertise `Space-Worker`; clustered workers use stable ordinal numbers starting at `1`, while single-process runtime reports `0`

## Development Guidance

- keep the primary narrow: authoritative state, watchdog ownership, and coordination only
- keep workers request-shaped: accept the request, do local work, then commit changed app paths once
- add new shared runtime coordination through `state_system.js` with stable `area` and `id` shards instead of one-off IPC methods
- keep replicated state replayable by version and snapshot-recoverable when deltas are pruned
- when runtime IPC, worker-state visibility, or state-hosting rules change, update this file and `/server/AGENTS.md`
