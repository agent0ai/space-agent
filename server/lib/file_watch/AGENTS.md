# AGENTS

## Purpose

`server/lib/file_watch/` owns the config-driven watchdog and the derived live indexes built from the logical app tree.

This subtree is the canonical source of the sharded live `file_index` plus the derived `group_index` and `user_index` views used by request routing, module resolution, file access, and auth. In clustered runtime, it is also the primary writer of the replicated filesystem-derived state shards that workers consume.

Documentation is top priority for this subtree. After any change under `server/lib/file_watch/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `watchdog.js`: watchdog implementation, config loading, pattern compilation, scanning, refresh, and handler lifecycle
- `file_index_store.js`: sharded `file_index` storage, loaded or stale shard flags, per-shard versions, lazy shard snapshots, and L2 invalidation application
- `config.yaml`: declarative handler configuration
- `handlers/group_index.js`: derived group graph builder backed by `server/lib/customware/group_index.js`
- `handlers/user_index.js`: derived user and session graph builder backed by `server/lib/auth/user_index.js`
- `state_shards.js`: mapping between derived indexes and replicated `area/id` state shards

## Local Contracts

### Configuration Contract

`config.yaml` is the source of truth for handler loading.

Current rules:

- each top-level key maps directly to `server/lib/file_watch/handlers/<name>.js`
- each handler config lists the logical project-path patterns that feed that handler
- the canonical app-file scan pattern is owned by `watchdog.js`; do not add a `path_index` handler just to make `/app/**/*` indexed
- directory entries in file-index shards use a trailing slash
- `watchdog.js` is responsible for mapping those logical `/app/...` patterns onto repo `L0` plus the configured writable `CUSTOMWARE_PATH` roots for `L1` and `L2`
- `CUSTOMWARE_WATCHDOG=true` keeps the live `fs.watch` layer, config-file watching, and the periodic reconcile backstop enabled; `false` still runs L0/L1 startup indexing, on-demand L2 loading, and the explicit `applyProjectPathChanges(...)` sync path but disables those background watch sources

Current default handlers:

- `group_index` over `group.yaml` files in `L0` and `L1`
- `user_index` over `user.yaml`, `meta/logins.json`, and `meta/password.json` in `L2`

### Index Contract

`file_index`:

- is the canonical fast lookup for file existence and listing
- is stored as owner shards such as `app`, `L0`, `L1/<group>`, and `L2/<user>`; do not keep a duplicate aggregate map as a second source of truth
- stores per-path metadata instead of booleans: directory flag, byte size, and last modified time
- excludes `.git` directories and their contents so per-owner local history metadata is not exposed as app files and does not create watchdog churn
- startup scans only `L0`, `L1`, and the logical app or layer root entries; it must not enumerate `L2/<user>` roots
- auth first touch loads only `L2/<user>/user.yaml`, `meta/password.json`, and `meta/logins.json` plus their ancestor metadata; it must not scan the full user tree
- full `L2/<user>` shards are loaded only when file, module, extension, app-fetch, quota, or mutation behavior needs user-owned files beyond auth state
- replicated startup snapshots and normal deltas include `L0`, `L1` group shards, layer roots, derived auth or group shards, and tiny `file_index_meta` version markers for changed L2 shards; full lazy `L2/<user>` file-index shards stay local to the primary or requesting worker and are transferred through explicit lazy-shard payloads
- workers keep loaded L2 shards locally, mark them stale from replicated invalidation/version notices, and pull the full shard again only when a later request needs a missing or stale shard
- lazy L2 shard payloads must include an empty shard tombstone when a previously loaded user shard is deleted so workers clear stale local path entries
- live `fs.watch` events and periodic reconcile scans may refresh already-loaded `L2/<user>` shards, but they must ignore unloaded L2 users instead of discovering stale accounts by walking the whole L2 layer
- request-time consumers that only need one ownership slice, such as module inheritance or user-scoped module listings, should read the relevant shared `file_index` shards from state instead of scanning the full `path_index`
- request-time quota helpers should reuse the same `sizeBytes` metadata for current `L2/<user>/` totals and subtree deltas instead of recursively walking user folders on disk

`path_index`:

- is a compatibility view assembled from currently loaded file-index shards only when a caller explicitly asks for it
- must not be treated as a mutable aggregate cache or replicated as its own state area
- may omit unloaded `L2/<user>` content by design

`group_index`:

- is rebuilt from currently loaded file-index paths
- derives membership and management relationships from `group.yaml`
- is replicated as per-group shards plus shared group-meta shards

`user_index`:

- is rebuilt from currently loaded L2 file-index shards
- derives user metadata, sealed-password presence, and stored session graphs from logical `L2`
- leaves password-record opening and session-signature validation to `server/lib/auth/service.js`
- is replicated as per-user shards plus per-session shards after that user shard has been loaded, so workers can validate cookies without reading auth files on every request
- may be hydrated from auth-only L2 file-index entries; do not require a full user-tree scan to make login or cookie validation work

Rules:

- keep derived indexes derived; do not build side-channel mutable state around them
- treat the watchdog as the only authoritative writer of replicated filesystem-derived state shards
- primary-owned watchdog state initializes its replicated version space from a long startup epoch when no snapshot version is provided, while replicas continue to trust the primary snapshot version they were bootstrapped with
- exact logical-path mutation reports from workers and jobs plus `fs.watch` incremental sync are the normal freshness path; do not rely on a fast whole-tree reconcile for routine writes
- worker or job mutation sync should hydrate the exact changed path plus only the ancestor directories whose metadata can change or whose entries are still missing; do not expand ordinary `L1` or `L2` file writes to the whole layer root
- operation scheduling prioritizes explicit mutations first, demand L2/auth loads second, ordinary work third, and background reconcile last
- explicit mutation sync for an L2 path may load or refresh that user's L2 shard because the user is active; background startup and reconcile paths must not use that as permission to enumerate unrelated L2 users
- ordinary file updates should remove or upsert only the exact path-index entry; subtree removal is reserved for directory sync, directory replacement, directory deletion, and full rescans
- watcher cleanup is only needed for deleted paths and directory syncs; ordinary file upserts must not scan the directory-watcher map
- when `CUSTOMWARE_WATCHDOG=false`, those exact logical-path mutation reports remain the only freshness path inside the running process because `fs.watch`, config watching, and the reconcile timer are intentionally disabled
- incremental `user_index` rebuilds rely on concrete changed auth or profile file paths, so mutation publishers must include `user.yaml`, `meta/password.json`, and `meta/logins.json` when those files are created or rewritten
- periodic full rescans are a backstop for missed external or out-of-process changes in already-loaded index scope, are scheduled from the previous run's completion time, default to 5 minutes, and may be disabled with `reconcileIntervalMs <= 0`
- full rescans should rebuild indexes asynchronously and yield to the event loop so the primary stays responsive during larger walks
- full rescans must build `file_index` shards directly in one pass over the scanned roots, and incremental publishes should patch only the changed shard entries instead of rebuilding every shard
- incremental publishes must derive affected file-index shard ids from changed project paths, not by scanning all of `currentPathIndex`
- clustered worker replicas consume versioned snapshots and incremental state deltas from the primary watchdog owner
- if a feature needs a new live derived view, add a handler plus config entry instead of manually wiring one-off logic in `server/app.js`

## Work Guidance

### Local Work Rules

- add or change handlers through `config.yaml` plus handler classes, not special cases in bootstrap code
- keep refresh behavior deterministic and centralized in `watchdog.js`
- keep incremental sync authoritative; when a change must be visible across workers immediately after a write, publish the exact logical project paths that changed
- keep backstop rescans infrequent and non-blocking; reuse the yielding full-scan path instead of adding new synchronous polling loops
- keep index semantics stable because router, auth, and customware depend on them
- if watched paths, handler names, or index contracts change, update this file and the affected docs in the same session

## Verification



## Child DOX Index

- No child DOX docs.
