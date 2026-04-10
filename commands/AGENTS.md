# AGENTS

## Purpose

`commands/` contains CLI command modules used by `space`.

Keep this file scoped to command-module behavior and help metadata. Repo-wide CLI surface and top-level command names still belong in `/AGENTS.md`.

This is one of the five core docs. It owns the command-tree contract for `commands/`. If command-specific helper subtrees later grow their own `AGENTS.md` files, those local docs should own the implementation detail while this file stays focused on the command surface and conventions.

Documentation is top priority for this area. After any change to command discovery, command behavior, command help, or the command tree under `commands/`, update this file and the matching supplemental docs under `app/L0/_all/mod/_core/documentation/docs/` in the same session before finishing.

## Documentation Hierarchy

`/commands/AGENTS.md` stays the command-tree doc for top-level command behavior. Command-family or helper subtrees with their own local contracts should add child `AGENTS.md` files.

Current child docs:

- `commands/lib/supervisor/AGENTS.md`

If that happens:

- the parent command doc should own the command-family surface and cross-command conventions
- the child doc should own the concrete subcommand or helper contract
- update both docs when the surfaced CLI behavior and the helper boundary change together

## How To Document Command Child Docs

Future command-family docs should keep the same section spine:

- `Purpose`
- `Ownership`
- `Command Surface` or `Helper Contract`
- `Arguments, Output, And State Changes`
- `Development Guidance`

Required coverage:

- which command files or helpers are owned
- which subcommands, flags, environment variables, or schema entries are part of the public CLI contract
- what the command prints and what files or runtime state it mutates
- which shared server or helper libraries it must delegate to instead of re-implementing logic
- which help text and examples must stay synchronized with the code

A child doc is justified only when a command family has enough behavior or helper ownership that this file would otherwise become vague or bloated.

## Contract

Each command module should export:

- `execute(context)`
- `help`

The `help` export may include:

- `name`
- `summary`
- `usage`
- `description`
- `arguments`
- `options`
- `examples`

The command loader discovers command modules dynamically from `commands/*.js`.

That means:

- every `.js` file in this folder is treated as a command module
- command names come from filenames
- command modules must stay import-safe because `help` loads them dynamically to collect metadata
- avoid top-level side effects, heavy startup work, or environment-specific initialization during import
- keep parsing and validation explicit inside the command module instead of relying on hidden global state

Non-command command-tree assets should stay out of `commands/*.js`. Shared helpers belong under subfolders such as `commands/lib/`, and command-owned metadata files such as `commands/params.yaml` should stay non-JavaScript so the loader does not treat them as commands.

`commands/params.yaml` is the command-owned schema for CLI-managed server config parameters. Each top-level key is the `.env` variable name, and each entry currently uses:

- `description`
- `type` with `boolean`, `text`, or `number`
- `allowed` as an inline list
- `default` for the server-side runtime fallback when no launch arg, stored `.env` value, or process env var is set
- `frontend_exposed` to opt a parameter into page-shell meta-tag exposure for the frontend

Parameter validation rules:

- `boolean` entries accept `true` or `false`
- `text` entries may use exact values, glob-style patterns with `*` and `?`, or `/regex/` patterns in `allowed`
- `number` entries may use exact numeric values or inclusive ranges such as `1024..65535` in `allowed`
- a parameter may intentionally allow the empty string, and `set` must preserve that instead of forcing a manual `.env` edit

Runtime resolution rules:

- `get` and `set` still manage the project `.env` file only
- `node space serve` accepts launch-time `PARAM=VALUE` overrides for any parameter defined in `commands/params.yaml`
- launch arguments win over stored `.env` parameter values
- stored `.env` parameter values win over process environment variables
- process environment variables win over the schema `default`
- only parameters with `frontend_exposed: true` are injected into page shells for frontend reads
- `CUSTOMWARE_PATH`, when non-empty, is the parent directory that contains backend `L1/` and `L2/` writable roots
- `CUSTOMWARE_GIT_HISTORY` enables optional adaptive-debounced per-owner local Git history repositories for writable `L1` and `L2` roots; it defaults to `false`
- `USER_FOLDER_SIZE_LIMIT_BYTES` sets an optional byte cap for each on-disk `L2/<user>/` folder; `0` disables the cap
- short-lived `user` and `group` commands flush pending local-history commits before returning when `CUSTOMWARE_GIT_HISTORY` is enabled

The `help` export should be complete enough that `node space help <command>` is useful without reading the code. Prefer accurate usage lines, concrete descriptions, explicit argument descriptions when position matters, and examples when the command shape is not obvious.

## Current Commands

- `get`
- `group`
- `help`
- `serve`
- `set`
- `supervise`
- `user`
- `update`
- `version`

## Command Families

There are two kinds of commands in this tree:

- operational commands that control or inspect the local runtime: `serve`, `supervise`, `help`, `get`, `set`, `version`, `update`
- state-management commands that edit layered runtime data under the logical app tree: `user` and `group`

The preferred shape is a small number of readable top-level commands with explicit subcommands. Do not add one file per tiny action when a subcommand fits the existing command family cleanly.

## Operational Commands

### `serve`

Purpose:

- start the local Node server
- serve browser page shells and `/mod/...` assets
- expose `/api/...` endpoints
- keep local infrastructure available for browser-first flows

Current launch overrides:

- `PARAM=VALUE` for any parameter defined in `commands/params.yaml`
- `--host <host>`
- `--port <port>`

Current usage:

- `node space serve`
- `node space serve --host 0.0.0.0 --port 3000`
- `node space serve PORT=0`
- `node space serve PORT=3100 ALLOW_GUEST_USERS=false`

Guidance:

- keep `serve` focused on process startup and bootstrap overrides
- keep `--host` and `--port` as aliases of the shared `HOST` and `PORT` runtime parameters
- keep `PORT=0` available as the explicit OS-assigned free-port mode used by the desktop host and other ephemeral local-runtime flows
- prefer `node space set CUSTOMWARE_PATH <path>` before user or group creation when documenting persistent writable-root setup, because launch-only `CUSTOMWARE_PATH=...` overrides affect only that `serve` process
- do not move application behavior into the command when it belongs in `server/`

### `supervise`

Purpose:

- run a public reverse-proxy supervisor in front of replaceable `space serve` child processes
- require stable writable state through `CUSTOMWARE_PATH`
- stage source-checkout updates in separate release directories when `--auto-update-interval` is greater than `0`
- switch traffic only after a replacement child is healthy
- restart the active child if it crashes

Current launch overrides:

- `PARAM=VALUE` for any parameter defined in `commands/params.yaml`
- `--host <host>`
- `--port <port>`

Current supervisor options:

- `--branch <branch>`
- `--remote-url <url>`
- `--state-dir <path>`
- `--auto-update-interval <seconds>`, defaulting to `300`; values less than or equal to `0` disable update checks
- `--startup-timeout <seconds>`
- `--drain-idle <seconds>`
- `--drain-timeout <seconds>`
- `--restart-backoff <seconds>`

Current usage:

- `node space supervise CUSTOMWARE_PATH=/srv/space/customware`
- `node space supervise --host 0.0.0.0 --port 3000 CUSTOMWARE_PATH=/srv/space/customware`
- `node space supervise --branch main --auto-update-interval 300 CUSTOMWARE_PATH=/srv/space/customware`
- `node space supervise --auto-update-interval 0 CUSTOMWARE_PATH=/srv/space/customware`

Guidance:

- keep `supervise` command-owned and do not add server hooks for supervisor lifecycle
- keep auto-update polling enabled by default for production supervised source checkouts, while preserving `--auto-update-interval 0` for crash-restart-only supervision
- keep the supervisor public `HOST` and `PORT` separate from child `space serve` ports; children must run on private loopback `PORT=0`
- pass all resolved runtime params other than public `HOST` and `PORT` to child `serve` processes
- normalize `CUSTOMWARE_PATH` to an absolute path before passing it to children so every release shares the same writable `L1` and `L2` roots
- keep release staging out of the live source checkout to avoid mixed old-code/new-asset windows
- keep update attempts non-overlapping and bounded so a stalled Git, install, or child-readiness step cannot block future intervals forever
- keep unhealthy replacement children unpromoted and stopped so the active child keeps serving and the next interval can retry
- keep old-child drain stream-aware so long responses or upgrade streams can finish or go quiet before the old process is stopped
- keep crash restart independent from update checks, with bounded backoff

### `help`

Purpose:

- list discovered commands
- show per-command help derived from each command module's `help` export

Current usage:

- `node space help`
- `node space help <command>`
- `node space --help`
- `node space --help <command>`

Guidance:

- command help text is part of the CLI contract; keep it accurate
- if a command grows new flags or subcommands, update both the module help and this file

### `get`

Purpose:

- read CLI-managed server config parameters from the project `.env`
- expose the parameter catalog defined in `commands/params.yaml`

Current usage:

- `node space get`
- `node space get <param>`

Behavior summary:

- with no parameter, it lists every available parameter from `commands/params.yaml` with the current stored `.env` value, type, description, and allowed values
- with a parameter name, it prints that parameter and its current stored `.env` value

Guidance:

- keep `get` read-only
- keep the printed parameter catalog aligned with `commands/params.yaml`

### `set`

Purpose:

- validate and write CLI-managed server config parameters into the project `.env`

Current usage:

- `node space set <param> <value>`

Behavior summary:

- parameter names are defined by `commands/params.yaml`
- `set` validates the value against the parameter's `type` and `allowed` rules before writing `.env`
- `set` updates only the target key and preserves unrelated `.env` entries

Guidance:

- keep `set` limited to explicit parameter writes; do not let it mutate unrelated runtime state
- if server config validation rules change, update both the command logic and `commands/params.yaml`

### `version`

Purpose:

- print the git-derived project version string

Current usage:

- `node space version`
- `node space --version`

Guidance:

- keep output machine-friendly and concise
- delegate version resolution to `server/lib/utils/project_version.js` so CLI output and page-shell version display share one resolver
- omit the `+0` suffix when HEAD is exactly on the latest tag; print the bare tag instead
- avoid adding unrelated diagnostics here

### `update`

Purpose:

- update a source checkout from the canonical `agent0ai/space-agent` git repository
- support branch tracking, remembered branch reconnect, tag targets, and commit targets

Current usage:

- `node space update`
- `node space update --branch <branch>`
- `node space update <branch>`
- `node space update <version-tag>`
- `node space update <commit>`

Behavior summary:

- before fetching, it pins `origin` to `https://github.com/agent0ai/space-agent.git` and sets the normal branch fetch refspec for that remote
- with no target, it fast-forwards the current or recoverable branch from `origin`
- with `--branch <branch>` or a branch positional target, it reattaches and updates that branch
- with a tag or commit target, it moves the current or recovered branch to that exact revision when possible, otherwise it may fall back to detached HEAD

Guidance:

- keep update logic source-checkout specific
- prefer explicit revision handling over clever inference
- surface destructive or branch-moving behavior clearly in help text

## Runtime State Commands

These commands edit the layered runtime state under `app/`. They should operate through explicit filesystem contracts and shared backend libraries, not through ad hoc inline file mutations.

### `user`

Purpose:

- create and maintain `L2` users
- manage password verifier state

Current subcommands:

- `create`
- `password`
- `passwd` as an alias of `password`

Current usage:

- `node space user create <username> --password <password> [--full-name <name>] [--groups <group[,group...]>] [--force]`
- `node space user password <username> --password <password>`

Current behavior:

- `create` creates the logical `L2/<username>/` root
- `create` writes metadata to `L2/<username>/user.yaml`
- `create` writes the backend-sealed password verifier envelope to `L2/<username>/meta/password.json`
- `create` initializes signed session storage in `L2/<username>/meta/logins.json`
- `create` ensures a `mod/` folder exists for the user
- `create --groups <group[,group...]>` adds the created user to one or more writable `L1` groups after user creation
- group ids passed through `--groups` are comma-separated, normalized, de-duplicated, and sorted before membership writes
- missing target groups in `--groups` are created automatically in the writable `L1` layer through the shared group helper
- `password` rewrites the verifier and clears active sessions
- `--full-name` sets `full_name` in `user.yaml`; if omitted it defaults to the user id
- `--force` replaces the full user directory during create
- when `CUSTOMWARE_PATH` is configured with `node space set CUSTOMWARE_PATH <path>` or process env, these logical `L2/...` writes land under `CUSTOMWARE_PATH/L2/...` and `--groups` writes land under `CUSTOMWARE_PATH/L1/...`

Examples:

- `node space user create alice --password secret123`
- `node space user create alice --password secret123 --full-name "Alice Example"`
- `node space user create alice --password secret123 --groups _admin,team-red`
- `node space user create alice --password secret123 --force`
- `node space user password alice --password newsecret456`

Guidance:

- keep user creation idempotent only when explicitly requested; otherwise fail on existing users
- password-changing commands must clear sessions unless the auth model is intentionally changed
- keep auth storage layout consistent: metadata in `user.yaml`, auth state under `meta/`, and backend-only seal keys outside `app/`

### `group`

Purpose:

- create and maintain writable `L1` groups
- edit logical `L1/<group-id>/group.yaml` membership and manager relationships
- do not write `L0`; firmware groups are developer-maintained outside the CLI

Current subcommands:

- `create`
- `add`
- `remove`

Current usage:

- `node space group create <group-id> [--force]`
- `node space group add <group-id> <user|group> <id> [--manager]`
- `node space group remove <group-id> <user|group> <id> [--manager]`

Current behavior:

- `create` creates the logical `L1/<group-id>/` root and initializes `group.yaml`
- `create` ensures a `mod/` folder exists for the group
- `add` and `remove` work with both user membership and group inclusion
- `add` creates the target writable `L1` group if it does not already exist, which allows predefined runtime groups such as `_admin` to gain their first writable membership file without a separate `group create`
- `--manager` switches the target list from included members to managing members
- user targets affect `included_users` or `managing_users`
- group targets affect `included_groups` or `managing_groups`
- when `CUSTOMWARE_PATH` is configured with `node space set CUSTOMWARE_PATH <path>` or process env, those logical `L1/...` writes land under `CUSTOMWARE_PATH/L1/...`

Parameter meanings:

- `<group-id>` is the target writable `L1` group id
- `<user|group>` selects whether `<id>` is a user id or another group id
- `<id>` is the user id or group id being added or removed

Examples:

- `node space group create team-red`
- `node space group add team-red user alice`
- `node space group add team-red user alice --manager`
- `node space group add team-red group qa-team`
- `node space group add team-red group ops --manager`
- `node space group remove team-red user alice`
- `node space group remove team-red group qa-team`

Guidance:

- keep group mutations explicit; the command should always make it clear whether it edits members or managers
- prefer normalized list editing through shared helpers in `server/lib/customware/`
- when extending group semantics, keep command syntax readable instead of growing multiple near-duplicate top-level commands

## Implementation Conventions

- keep command modules small and explicit
- put shared CLI routing behavior in `space`
- put shared domain logic in server libraries, not inside the command parser
- commands should parse arguments, validate them, call a shared library, and print a concise result
- unknown flags or malformed argument combinations should fail fast with a useful usage error
- prefer deterministic output over chatty logs
- do not hide important destructive behavior behind implicit defaults
- prefer explicit filesystem contracts such as `user.yaml`, `meta/password.json`, `meta/logins.json`, and `group.yaml`
- keep command names and subcommands stable once exposed; when changing them, update help text and docs in the same session

## Guidance

- prefer a small number of readable top-level commands with subcommands over proliferating one-file one-action command names
- when command discovery, command help shape, or command-specific conventions change, update this file in the same session
