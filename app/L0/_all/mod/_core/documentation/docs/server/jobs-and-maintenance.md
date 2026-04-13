# Jobs And Maintenance

This doc covers the primary-owned server job runner and the current guest-maintenance jobs.

## Primary Sources

- `server/AGENTS.md`
- `server/runtime/AGENTS.md`
- `server/jobs/AGENTS.md`
- `server/jobs/job_runner.js`
- `server/jobs/guest_cleanup_inactive.js`
- `server/jobs/guest_cleanup_oversized.js`
- `server/lib/auth/user_manage.js`

## Ownership And Discovery

The server now has a dedicated `server/jobs/` subtree for periodic backend-owned maintenance work.

Current rules:

- job files are discovered deterministically from `server/jobs/*.js`
- infrastructure files in that same folder own the shared base class, registry, scheduler, and helper logic
- each job module exports a default class extending `JobBase`
- the job id comes from the filename, not from a sidecar metadata file
- jobs may optionally implement `isEnabled(context)` when runtime-config gating should prevent scheduling entirely

This keeps the subsystem small and makes one folder the whole source of truth.

## Scheduling Model

Jobs currently use interval schedules, not cron syntax.

Each job class returns a small schedule object from `getSchedule()`:

- `everyMs`: required repeat interval
- `initialDelayMs`: optional first-run delay; defaults to one full interval
- `lockTtlMs`: optional named-lock TTL used by the runner

Important behavior:

- jobs run only on the authoritative runtime owner: the single server process when `WORKERS=1`, or the clustered primary when `WORKERS>1`
- workers never execute jobs
- disabled jobs are not scheduled at all; the runner checks `isEnabled(context)` before creating timers and again before each run
- the runner acquires a named lock per job id through the primary-owned unified state system before each run
- jobs do not overlap
- the next due time is based on the current run's start time plus `everyMs`, so long runs do not trigger overlap or catch-up bursts

## Mutation Contract

Jobs should stay orchestration-only.

When a job needs to change app files:

- it should call the shared helper that owns the behavior, such as `server/lib/auth/user_manage.js`
- it should run that helper through the runner's tracked-mutation wrapper
- the changed logical app paths are then committed through the normal watchdog mutation path so file, user, and session indexes refresh correctly in both single-process and clustered runtime

Jobs should not invent their own filesystem refresh loop, direct worker broadcast, or lockfile protocol.

## Current Guest Jobs

Guest identity remains prefix-based through randomized `guest_...` usernames.

Both guest-maintenance jobs are disabled entirely when guest-account creation is disabled by runtime config.

`guest_cleanup_inactive`:

- runs once per hour
- inspects the watchdog `path_index` entries under each guest `L2/<username>/` root
- uses the most recent tracked file `mtimeMs`, falling back to any tracked entry under the root when needed
- deletes a guest when no tracked change has happened in the last 72 hours

`guest_cleanup_oversized`:

- runs every 5 minutes
- inspects the same guest `L2/<username>/` path-index slice
- counts tracked files and sums tracked file bytes
- deletes a guest when either threshold is exceeded: more than 1000 tracked files, or more than 1,000,000,000 total tracked bytes

Both jobs intentionally use the existing file index instead of rescanning the filesystem ad hoc.
