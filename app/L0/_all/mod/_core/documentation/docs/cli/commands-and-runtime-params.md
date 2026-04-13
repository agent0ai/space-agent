# Commands And Runtime Params

This doc covers the CLI entry surface and the runtime-parameter system.

## Primary Sources

- `AGENTS.md`
- `commands/AGENTS.md`
- `space.js`
- `commands/serve.js`
- `commands/supervise.js`
- `commands/lib/supervisor/`
- `commands/params.yaml`
- `server/lib/utils/runtime_params.js`

## CLI Entry

The CLI entry file is `space.js`.

Current behavior:

- dynamically lists `commands/*.js`
- normalizes `--help` -> `help`
- normalizes `--version` -> `version`
- imports the chosen command module dynamically
- expects each command module to export `execute(context)`

Important note:

- `space.js` is still legacy CommonJS
- the rest of the repo prefers ES modules
- treat that CommonJS entry as migration debt, not a pattern to copy

## Current Command Families

Operational commands:

- `serve`
- `supervise`
- `help`
- `get`
- `set`
- `version`
- `update`

Runtime-state commands:

- `user`
- `group`

`node space user create` can add the new user to groups in the same command with `--groups <group[,group...]>`. The group list is comma-separated, normalized, de-duplicated, and written through the same `L1` group helper used by `node space group add`.

`node space group add` creates the target writable `L1` group if it does not already exist, including predefined runtime group ids such as `_admin`.

The command tree prefers a small number of readable top-level commands with explicit subcommands instead of many tiny files.

`node space version`, the `node space serve` startup banner, and the `/enter` launcher version label share the resolver in `server/lib/utils/project_version.js`. Source checkouts use the latest Git tag plus commit count when needed, while package-only runtimes can fall back to the package version for display.

## `update`

`node space update` updates a source checkout from the configured Git update repository.

Current behavior:

- before fetching, it resolves the update repository from `GIT_URL`, then the local `origin` remote URL, and only then the canonical fallback, then pins `origin` to that remote
- for GitHub remotes, it uses `SPACE_GITHUB_TOKEN` when set and otherwise sends no GitHub auth header
- with no target, it fast-forwards the current or recoverable branch from `origin`
- with `--branch <branch>` or a branch positional target, it reattaches and updates that branch
- with a tag or commit target, it moves the current or recovered branch to that exact revision when possible
- it remains source-checkout only and does not update packaged Electron apps

## `supervise`

`node space supervise` runs the source checkout behind a command-owned, production-ready zero-downtime supervisor with auto-update enabled by default.

Current behavior:

- binds the public `HOST` and `PORT` in the supervisor process
- sets the supervisor OS process title to `space-supervise` so operator tools can distinguish it from child runtimes
- requires `CUSTOMWARE_PATH`, whether provided as a launch param, stored `.env` value, or process environment variable
- normalizes `CUSTOMWARE_PATH` to an absolute path before passing it to child servers
- starts real `space serve` children on private loopback `HOST=127.0.0.1 PORT=0`
- treats all non-supervisor CLI arguments as opaque `space serve` launch arguments, only rewriting child `HOST`, child `PORT`, and `CUSTOMWARE_PATH`
- periodically checks the watched Git remote and branch for a newer revision when `--auto-update-interval` is greater than `0`
- resolves the watched Git remote from `--remote-url`, then `GIT_URL`, then the local `origin` remote URL, and only then the canonical fallback
- for GitHub remotes, update checks and staged release clones use `SPACE_GITHUB_TOKEN` when set and otherwise send no GitHub auth header
- accepts `--auto-update-interval <seconds>`, defaulting to `300`; values less than or equal to `0` disable update checks and leave crash-restart supervision active
- stages updates in `<projectRoot>/supervisor/releases/` by default
- runs `npm install --omit=optional` inside staged releases
- switches the proxy to a replacement child only after the child prints its listening URL and passes `/api/health`
- keeps update attempts non-overlapping; the next interval is scheduled only after the current attempt finishes or fails
- bounds remote checks, release staging commands, dependency installs, and child readiness waits so one stalled update attempt cannot block later intervals forever
- stops and discards unhealthy replacement child processes without promoting them, then retries on the next eligible interval
- tracks proxied HTTP requests and upgrade streams while draining old children, then stops the old child when streams finish or go quiet, with a hard drain timeout
- falls back to a still-draining previous child if the newly active child exits unexpectedly
- restarts the active target with bounded backoff if no fallback child is available

Current usage:

- `node space supervise CUSTOMWARE_PATH=/srv/space/customware`
- `node space supervise HOST=0.0.0.0 PORT=3000 CUSTOMWARE_PATH=/srv/space/customware`
- `node space supervise --branch main --auto-update-interval 300 CUSTOMWARE_PATH=/srv/space/customware`
- `node space supervise --auto-update-interval 0 CUSTOMWARE_PATH=/srv/space/customware`

Current supervisor options:

- `--branch <branch>`
- `--remote-url <url>`
- `--state-dir <path>`
- `--auto-update-interval <seconds>`
- `--startup-timeout <seconds>`
- `--drain-idle <seconds>`
- `--drain-timeout <seconds>`
- `--restart-backoff <seconds>`

Supervisor state:

- default state directory: `<projectRoot>/supervisor`
- shared child auth keys: `auth/auth_keys.json`, unless `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY` are already injected
- staged source releases: `releases/<revision>/`

The supervisor intentionally avoids changing `server/` lifecycle code. Its only runtime assumptions about a child are that `node space serve` prints the existing listening URL line and that `/api/health` succeeds after startup.

It also intentionally avoids depending on server runtime-param parsing so new `space serve` launch arguments can flow through supervision without needing a supervisor-specific update first.

## `serve`

`node space serve` starts the local runtime.

Current startup output:

- prints `space server version <resolved version>` before the listening banner
- preserves the separate `space server listening at <url>` line so supervisor readiness parsing stays stable

Current process titles:

- single-process `serve`: `space-serve`
- clustered primary: `space-serve-p`
- clustered worker `N`: `space-serve-w<N>`

Current override forms:

- `PARAM=VALUE`

Launch-time override precedence is:

1. launch arguments
2. stored `.env` values written by `node space set KEY=VALUE`
3. process environment variables
4. schema defaults from `commands/params.yaml`

## Runtime Params Schema

The schema lives in `commands/params.yaml`.

Current params:

- `HOST`
- `PORT`
- `WORKERS`
- `CUSTOMWARE_PATH`
- `SINGLE_USER_APP`
- `ALLOW_GUEST_USERS`
- `CUSTOMWARE_GIT_HISTORY`
- `GIT_URL`
- `USER_FOLDER_SIZE_LIMIT_BYTES`

Important fields per param:

- `description`
- `type`
- `allowed`
- `default`
- `frontend_exposed`

Only params with `frontend_exposed: true` are injected into page-shell meta tags for the frontend.

## Current High-Value Params

- `CUSTOMWARE_PATH`: parent directory that owns writable `L1/` and `L2/` roots
- `PORT`: accepts `0` when a caller wants the OS to assign a free local port at startup
- `WORKERS`: number of parallel HTTP worker processes for `serve` and `supervise`; `1` keeps the single-process runtime, and larger values start a clustered primary plus worker model with one authoritative replicated state host
- `SINGLE_USER_APP`: implicit always-authenticated `user` principal with virtual `_admin` access
- `ALLOW_GUEST_USERS`: enables guest creation from the login screen when password login is enabled
- `CUSTOMWARE_GIT_HISTORY`: enables optional debounced local Git history repositories for writable `L1/<group>/` and `L2/<user>/` roots; defaults to `true`; owner-root commits wait 10 seconds of quiet, then shorten to 5 seconds after 1 minute of pending writes, 1 second after 5 minutes, and immediate commit after 10 minutes; with `WORKERS>1`, those debounced commits are scheduled only by the clustered primary after it rebuilds authoritative state for worker-reported path changes
- `GIT_URL`: optional Git repository URL used by `node space update` and `node space supervise`; if unset they fall back to the local `origin` remote URL and only then to the canonical repo URL
- `USER_FOLDER_SIZE_LIMIT_BYTES`: optional per-user `L2/<user>/` folder cap in bytes; `0` disables it, and positive values make app-file mutations reject projected growth over the cap while still allowing mutations that reduce an already-over-limit folder
- `user` and `group` commands flush pending local-history commits before returning when `CUSTOMWARE_GIT_HISTORY` is enabled because those commands are short-lived processes
- `node space set CUSTOMWARE_PATH=<path>` should be run before creating users or groups when writable state should live outside the source checkout, because `user` and `group` commands resolve that stored parameter before deciding where `L1` and `L2` files belong
- `node space supervise` requires `CUSTOMWARE_PATH` and uses it as the stable writable state boundary across source-release swaps

## Practical Reading Order

- Need exact CLI shape or help metadata: `commands/AGENTS.md`
- Need server startup implications: `architecture/overview.md`
- Need writable-layer and permission effects: `server/customware-layers-and-paths.md`
