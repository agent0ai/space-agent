# AGENTS

## Purpose

`customware_bundle_example/` is a minimal reference implementation of a Customware Bundle Interface manifest.

It is intentionally a fixture, not a bundled product feature. Tests copy this folder into temporary `L1/<group>/mod/...` roots to verify manifest discovery without checking sample writable-layer content into `app/L1` or `app/L2`.

## Ownership

This folder owns:

- `space.bundle.yaml`: the reference bundle manifest.
- `README.md`: installation and extension notes for humans and agents reading the fixture.

## Local Contracts

- Keep the manifest valid and small.
- Do not add behavior here that silently changes the running app.
- If the example grows real `ext/html`, `ext/js`, or `ext/skills` files, document those folders here and keep them clearly marked as reference behavior.

## Development Guidance

- Use this fixture to demonstrate manifest shape and discovery only.
- Runtime action handlers still belong in normal module code and must register through `space.bundles.actions`.
