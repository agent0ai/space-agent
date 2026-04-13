# AGENTS

## Purpose

`server/lib/file_watch/` owns the config-driven watchdog and the derived live indexes built from the logical app tree.

This subtree is the canonical source of the live `path_index`, `group_index`, and `user_index` views used by request routing, module resolution, file access, and auth. In clustered runtime, it is also the primary writer of the replicated filesystem-derived state shards that workers consume.

Documentation is top priority for this subtree. After any change under `server/lib/file_watch/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `watchdog.js`: watchdog implementation, config loading, pattern compilation, scanning, refresh, and handler lifecycle
- `config.yaml`: declarative handler configuration
- `handlers/path_index.js`: canonical index of current app files and directories
- `handlers/group_index.js`: derived group graph builder backed by `server/lib/customware/group_index.js`
- `handlers/user_index.js`: derived user and session graph builder backed by `server/lib/auth/user_index.js`
- `state_shards.js`: mapping between derived indexes and replicated `area/id` state shards

## Configuration Contract

`config.yaml` is the source of truth for handler loading.

Current rules:

- each top-level key maps directly to `server/lib/file_watch/handlers/<name>.js`
- each handler config lists the logical project-path patterns that feed that handler
- `path_index` is required
- directory entries in the path index use a trailing slash
- `watchdog.js` is responsible for mapping those logical `/app/...` patterns onto repo `L0` plus the configured writable `CUSTOMWARE_PATH` roots for `L1` and `L2`

Current default handlers:

- `path_index` over `/app/**/*`
- `group_index` over `group.yaml` files in `L0` and `L1`
- `user_index` over `user.yaml`, `meta/logins.json`, and `meta/password.json` in `L2`

## Index Contract

`path_index`:

- tracks every currently existing file and directory under the watched logical app tree
- is the canonical fast lookup for file existence and listing
- stores per-path metadata instead of booleans: directory flag, byte size, and last modified time
- excludes `.git` directories and their contents so per-owner local history metadata is not exposed as app files and does not create watchdog churn
- is replicated to workers as `file_index/<id>` shards such as `L0`, `L1/<group>`, and `L2/<user>`
- request-time consumers that only need one ownership slice, such as module inheritance or user-scoped module listings, should read the relevant replicated `file_index` shards from shared state instead of scanning the full `path_index`

`group_index`:

- is rebuilt from `path_index`
- derives membership and management relationships from `group.yaml`
- is replicated as per-group shards plus shared group-meta shards

`user_index`:

- is rebuilt from `path_index`
- derives user metadata, sealed-password presence, and stored session graphs from logical `L2`
- leaves password-record opening and session-signature validation to `server/lib/auth/service.js`
- is replicated as per-user shards plus per-session shards so workers can validate cookies without reading auth files on every request

Rules:

- keep derived indexes derived; do not build side-channel mutable state around them
- treat the watchdog as the only authoritative writer of replicated filesystem-derived state shards
- incremental `user_index` rebuilds rely on concrete changed auth or profile file paths, so mutation publishers must include `user.yaml`, `meta/password.json`, and `meta/logins.json` when those files are created or rewritten
- clustered worker replicas consume versioned snapshots and incremental state deltas from the primary watchdog owner
- if a feature needs a new live derived view, add a handler plus config entry instead of manually wiring one-off logic in `server/app.js`

## Development Guidance

- add or change handlers through `config.yaml` plus handler classes, not special cases in bootstrap code
- keep refresh behavior deterministic and centralized in `watchdog.js`
- keep incremental sync authoritative; when a change must be visible across workers immediately after a write, publish the exact logical project paths that changed
- keep index semantics stable because router, auth, and customware depend on them
- if watched paths, handler names, or index contracts change, update this file and the affected docs in the same session
