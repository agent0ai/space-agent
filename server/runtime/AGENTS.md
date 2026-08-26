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

### Local Contracts

Cluster runtime rules:

- `WORKERS=1` stays on the normal single-process runtime
- `WORKERS>1` starts a primary plus worker-process model through `cluster.js`
- workers own normal HTTP handling, cookie validation, and local filesystem writes
- the primary owns the authoritative watchdog, the authoritative unified state system, and any server-owned periodic jobs
- workers keep replica watchdog snapshots and apply primary-published state deltas or snapshot resets by version
- clustered worker bootstrap snapshots intentionally carry only startup-replicated file-index scope, currently `L0`, `L1`, and layer roots; workers request `L2/<user>` file-index shards from the primary on demand and apply those shards locally without making them part of the normal replicated snapshot
- L2 shard changes publish tiny replicated version markers so `Space-State-Version` fences cover stale-shard invalidations without broadcasting full user file indexes to every worker
- clustered processes should set distinct OS process titles for operator tools: the primary uses `space-serve-p`, and workers use `space-serve-w<N>` with stable worker ordinals

Unified state-system rules:

- worker-visible state is stored as `state[area][id]`
- one `(area,id)` value is one replication unit; updates replace the whole shard value
- replicated state shares one global monotonic version for request fencing and worker catch-up
- primary-owned watchdog state seeds that monotonic version space from a long startup epoch and then increments by `1` per replicated commit, so fresh runtimes do not fall behind a browser's previously observed version while delta replay still keeps exact `fromVersion -> toVersion` chaining
- the primary retains only the most recent delta window, currently `1000` versions, and workers that fall behind that window must request a full snapshot
- entries may opt out of replication with `replicate: false`; those entries stay out of replicated snapshots and may carry a TTL
- worker-local or primary-local lazy `L2/<user>` file-index shards use local, non-replicated state entries so module and file discovery can read the same state interface after demand loading without bloating every worker snapshot
- `file_index_meta/<L2/user>` entries are replicated version notices only; they mark already-loaded worker shards stale and must not be treated as file listings
- named locks are explicit and token-based through `acquireLock` and `releaseLock`
- login challenges live in the primary-only `login_challenge/<token>` area today, and future shared coordination should reuse this system instead of inventing ad hoc primary RPC paths
- periodic job scheduling should also reuse this primary-owned coordination surface, especially named locks, rather than adding process-local lockfiles or worker-side schedulers

Mutation and visibility rules:

- mutating request paths are captured through `request_mutations.js`
- workers perform the filesystem mutation first, then commit the affected logical project paths to the primary once
- the primary updates the authoritative watchdog-derived state, schedules any debounced writable-layer Git history commits for those rebuilt owner roots, and publishes deltas or snapshots asynchronously; writes do not wait for every worker to acknowledge
- when a mutation touches `L2/<user>`, the primary returns that user's refreshed lazy file-index shard to the mutating worker in the mutation response, while other workers receive only the replicated L2 version notice and load the full shard only if a later request needs it
- when a loaded L2 shard is removed, the lazy-shard response must carry an empty tombstone shard so the mutating or requesting worker clears its local copy
- workers do not ping the primary for L2 freshness on every authenticated request; they use their local shard when current, and demand-pull only when the shard is missing or marked stale
- request-to-request freshness is enforced through `Space-State-Version`: responses advertise the worker's current replicated version, and requests may require a minimum version before handling continues
- when a worker receives a higher requested version than its replica currently has, it should pull from primary immediately before falling back to the bounded local wait window, so startup and cross-worker races recover without making the client sit through a full timeout first
- responses also advertise `Space-Worker`; clustered workers use stable ordinal numbers starting at `1`, while single-process runtime reports `0`

## Work Guidance

### Local Work Rules

- keep the primary narrow: authoritative state, watchdog ownership, and coordination only
- keep workers request-shaped: accept the request, do local work, then commit changed app paths once
- add new shared runtime coordination through `state_system.js` with stable `area` and `id` shards instead of one-off IPC methods
- keep replicated state replayable by version and snapshot-recoverable when deltas are pruned
- when runtime IPC, worker-state visibility, or state-hosting rules change, update this file and `/server/AGENTS.md`

## Verification



## Child DOX Index

- No child DOX docs.
