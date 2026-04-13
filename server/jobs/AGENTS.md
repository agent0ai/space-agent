# AGENTS

## Purpose

`server/jobs/` owns primary-run periodic maintenance jobs.

This subtree is for backend-owned maintenance loops that must run inside the server process rather than through browser code. Jobs should stay narrow, deterministic, and easy to discover. They orchestrate shared helpers; they do not become a second place to hide auth, filesystem, or policy logic.

Documentation is top priority for this subtree. After any change under `server/jobs/`, update this file and any affected parent or helper docs in the same session.

## Ownership

Current files:

- `job_base.js`: shared job superclass and required schedule or run interface
- `job_registry.js`: deterministic job discovery from `server/jobs/*.js`
- `job_runner.js`: primary-owned scheduler, overlap prevention, lock use, and tracked-mutation execution
- `guest_collect.js`: shared guest-account file-index aggregation helpers for maintenance jobs
- `guest_cleanup_inactive.js`: hourly inactive-guest cleanup job
- `guest_cleanup_oversized.js`: five-minute oversized-guest cleanup job

## Local Contracts

Discovery and scheduling rules:

- every `.js` file in this folder is treated as a job module unless it is one of the shared infrastructure files owned by this doc
- job files export a default class extending `JobBase`
- the job id comes from the filename, for example `guest_cleanup_inactive.js` -> `guest_cleanup_inactive`
- jobs may optionally implement `isEnabled(context)` when scheduling depends on runtime configuration
- each job class must implement `getSchedule()` and `run(context)`
- schedules currently use interval semantics through `everyMs`; jobs do not use sidecar cron or metadata files
- `initialDelayMs` is optional; when omitted, the first run waits one normal interval
- `lockTtlMs` is optional; `job_runner.js` acquires a primary-state named lock per job id before each run so accidental duplicate runners cannot overlap the same job
- after each run, the next due time is based on the current run's start time plus `everyMs`; jobs never overlap and do not perform multi-run catch-up bursts

Primary-runtime rules:

- jobs run only on the authoritative runtime owner: the single-process runtime or the clustered primary when `WORKERS>1`
- clustered workers never load or execute jobs
- disabled jobs are not scheduled at all; the runner checks `isEnabled(context)` before creating timers and again before each run
- jobs should use `runTrackedMutation(...)` from the runner context for filesystem mutations so changed logical app paths are published through the normal watchdog mutation path
- shared policy and deletion semantics belong in owning helpers such as `server/lib/auth/user_manage.js`, not inline inside job files

Current guest-maintenance rules:

- guest detection is prefix-based through randomized `guest_...` usernames, matching the existing auth contract
- both guest jobs are disabled whenever guest accounts are disabled by runtime config
- `guest_cleanup_inactive` scans the replicated `path_index` view of each guest `L2/<username>/` root and deletes guests whose most recent file change is older than 72 hours
- `guest_cleanup_oversized` scans the same `path_index` view and deletes guests when they exceed either 1000 tracked files or 1,000,000,000 total tracked bytes
- both guest jobs read file metadata from the watchdog-owned path index rather than walking the filesystem ad hoc

## Development Guidance

- keep job files small and focused on schedule plus orchestration
- prefer interval schedules unless a real wall-clock requirement appears
- reuse primary-owned shared state and named locks instead of inventing job-local lockfiles or extra metadata files
- if a job mutates auth or writable-layer data, reuse the existing shared helper and mutation-publication path
- if job discovery, scheduling semantics, or primary-only execution rules change, update this file plus `/server/AGENTS.md` and `/server/runtime/AGENTS.md`
