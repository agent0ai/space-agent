# AGENTS

## Purpose

`tests/fixtures/` owns small, hand-authored files that test harnesses copy into temporary project roots.

Fixtures in this folder are durable reference inputs, not runtime state. Keep them readable, deterministic, and independent from the real `app/L1` or `app/L2` writable layers.

## Ownership

Current fixture folders:

- `customware_bundle_example/`: minimal reference customware-bundle module used by bundle discovery tests and documentation.

## Local Contracts

- Do not store generated output or local verification artifacts here.
- Fixtures must be safe to copy into a temporary project root during tests.
- Prefer explicit README or AGENTS notes for each fixture folder so future agents know whether it is a runtime example, parser fixture, or regression case.

## Development Guidance

- Keep fixture contents small and hand-authored.
- Update `tests/AGENTS.md` when adding or repurposing a fixture family.
