# AGENTS

## Purpose

`commands/lib/supervisor/` owns the command-local zero-downtime supervisor used by `node space supervise`.

The supervisor keeps `server/` agnostic: it does not require server-owned clustering, hot-reload, or update hooks. It runs real `node space serve` children on private loopback ports, owns the public reverse proxy, stages source updates in separate release directories when `--auto-update-interval` is greater than `0`, and switches traffic only after a replacement child is healthy.

## Ownership

Current files:

- `auth_keys.js`: supervisor-owned shared auth-key storage and environment injection for child servers
- `child_process.js`: `space serve` child startup, readiness detection, health checking, crash/stop handling, and proxied-stream activity tracking
- `git_releases.js`: Git remote polling, release cloning, dependency installation, and release metadata
- `http_proxy.js`: public HTTP and upgrade proxying to the active child
- `process_log.js`: prefixed child-process output helpers
- `supervisor.js`: orchestration for startup, update checks, child promotion, stream-aware drain, fallback, crash restart, and shutdown

## Helper Contract

`node space supervise` is the only intended caller of this subtree.

Stable behavior:

- the supervisor process binds the public `HOST` and `PORT`
- child servers always receive `HOST=127.0.0.1` and `PORT=0`
- all other resolved runtime params are passed to child `space serve` processes as launch arguments
- `CUSTOMWARE_PATH` is required and is normalized to an absolute path before being passed to children
- supervisor state defaults to `CUSTOMWARE_PATH/.space-supervisor`
- staged releases live under the supervisor state directory, not in the live source checkout
- auto-update polling uses `--auto-update-interval`, defaults to `300` seconds, and is disabled when the interval is less than or equal to `0`
- auth keys are either inherited from `SPACE_AUTH_PASSWORD_SEAL_KEY` and `SPACE_AUTH_SESSION_HMAC_KEY` or generated once under supervisor state and injected into every child
- when the auto-update interval is greater than `0`, updates are staged by cloning the watched branch, checking out the exact remote revision, running `npm install --omit=optional`, then starting and health-checking the replacement child
- update attempts never overlap; the next interval is scheduled only after the current attempt finishes or fails
- Git remote checks, release staging commands, dependency installs, and child readiness waits are bounded so one stalled update attempt cannot block future intervals forever
- an unhealthy replacement child is stopped by the child-startup path, left unpromoted, and retried on the next eligible update interval
- old children are drained by tracking proxied HTTP requests and upgrade streams; they are stopped when streams finish or stop sending traffic, with the drain timeout as a hard cap
- if the active child crashes, the supervisor falls back to a still-draining previous child when available, otherwise restarts the active target with bounded backoff

## Arguments, Output, And State Changes

The public command owns argument parsing. Helper modules should receive normalized config instead of re-reading CLI arguments.

Runtime state written by this subtree:

- `CUSTOMWARE_PATH/.space-supervisor/auth/auth_keys.json` by default, unless auth keys are injected through environment variables
- `CUSTOMWARE_PATH/.space-supervisor/releases/<revision>/` release directories by default

External commands used by this subtree:

- `git` for source checkout discovery, remote polling, cloning, and exact checkout
- `npm install --omit=optional` for staged release dependencies
- `node <release>/space serve ...` for child servers

Supervisor logs use `[supervise]`, `[serve:<label>]`, `[supervise:git]`, and `[supervise:npm]` prefixes so operator output stays attributable.

## Development Guidance

- keep this subtree command-owned; do not add server-side hooks just to help the supervisor
- keep child servers replaceable at runtime by treating them as opaque HTTP targets after readiness
- preserve `CUSTOMWARE_PATH` as the stable writable state boundary across releases
- do not update the live checkout in place during supervised auto-update
- keep the proxy stream-aware so long-running responses and upgrades are not cut during normal promotion
- keep crash recovery independent from update polling; a failed update must not prevent restart of the currently active target
- keep `--auto-update` command-owned; do not add it to `commands/params.yaml` unless the server runtime itself starts consuming it
- if the supervisor adds new public flags, update `commands/supervise.js`, `/commands/AGENTS.md`, and `app/L0/_all/mod/_core/documentation/docs/cli/commands-and-runtime-params.md` in the same session
