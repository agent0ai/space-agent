# AGENTS

## Purpose

`server/lib/tmp/` owns transient server-side file storage under `server/tmp/`.

It is the canonical place for creating short-lived archive files, ensuring the temp directory exists, and running the low-memory janitor that removes stale temp artifacts. Endpoint modules should reuse this subtree instead of inventing ad hoc temp paths or cleanup loops.

Documentation is top priority for this subtree. After any change under `server/lib/tmp/` or to the `server/tmp/` contract, update this file and the affected parent docs in the same session.

## Ownership

This subtree owns:

- `tmp_watch.js`: temp-directory creation plus the interval-backed janitor for stale entries
- `archive_create.js`: unique temp archive allocation, in-process ZIP creation, attachment filename headers, and cleanup-aware archive streams
- `server/tmp/`: the runtime temp directory for transitory server artifacts, kept in git through `.gitignore`

## Local Contracts

### Temp Directory Contract

Current rules:

- `server/tmp/` is for transitory files and folders only
- every temp artifact should be created as its own top-level entry inside `server/tmp/`
- the janitor removes top-level entries whose `mtime` is older than `25 minutes`
- the janitor runs on startup and then on a fixed low-memory interval instead of per-file timers
- repo-owned anchor files such as `server/tmp/.gitignore` are preserved

### Archive Contract

Current folder-download behavior:

- folder archives are created inside `server/tmp/`
- archive filenames on disk are unique and sanitized to avoid collisions
- the archive builder uses the in-process Node `archiver` ZIP implementation with fast compression and symbolic-link preservation, writing the archive to disk in `server/tmp/` before the response stream opens
- streamed archive files are unlinked after the response stream closes; the janitor is the fallback cleanup path if any request exits early or misses manual cleanup

## Work Guidance

### Local Work Rules

- keep temp storage disk-backed and streaming-oriented; avoid blob buffering for large artifacts
- do not create feature-local cleanup timers when the janitor already owns stale-entry cleanup
- if temp retention, archive creation behavior, or the `server/tmp/` ownership contract changes, update this file and `/server/AGENTS.md`

## Verification



## Child DOX Index

- No child DOX docs.
