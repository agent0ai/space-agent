# Customware Bundles

This doc covers the Customware Bundle Interface for reusable downstream modules.

## Primary Sources

- `AGENTS.md`
- `app/AGENTS.md`
- `app/L0/_all/mod/_core/framework/AGENTS.md`
- `server/lib/customware/AGENTS.md`
- `server/api/AGENTS.md`

## What A Bundle Is

A customware bundle is an ordinary installed module with one extra manifest:

```txt
L1/<group>/mod/<author>/<repo>/space.bundle.yaml
L2/<user>/mod/<author>/<repo>/space.bundle.yaml
```

The bundle still uses the normal Space Agent composition model:

- UI through `ext/html/...`
- behavior through `ext/js/...` and `space.extend(...)`
- skills through `ext/skills/*/SKILL.md`
- browser guest behavior through documented web-browsing guest-runtime seams
- visual/theme changes through `_core/framework/theme/end`
- head-side setup through `_core/framework/head/end`

The manifest advertises the package. It does not grant permission to monkey patch private runtime internals.

## Manifest Shape

The root file is `space.bundle.yaml`.

The checked-in minimal reference fixture lives at `tests/fixtures/customware_bundle_example/`.

Example:

```yaml
id: acme/fleet
name: Fleet Control
version: 1.0.0
description: Team-owned fleet controls for Space Agent
capabilities: [theme, actions, browser-runtime]
extension_points:
  - _core/framework/theme/end
  - _core/web_browsing/browser-guest-runtime.js/buildBrowserGuestRuntimeScriptPaths/end
compatibility:
  space_agent: ">=0.65"
config_defaults:
  accent: teal
actions:
  - id: fleet.open
    title: Open fleet
    capability: actions
    description: Open the fleet dashboard
```

Stable fields:

- `id`: lowercase bundle id, usually `<author>/<repo>`
- `name`, `version`, and `description`: display metadata
- `capabilities`: high-level advertised capabilities
- `extension_points`: documented seams the bundle expects to use
- `compatibility`: version or runtime compatibility notes
- `config_defaults`: optional structured defaults owned by the bundle
- `actions`: declarative action metadata

## Runtime Surface

Installed bundle metadata is available through:

- `space.api.bundleList(options)`
- `space.api.bundleInfo(pathOrOptions)`
- `space.bundles.list(options)`
- `space.bundles.info(pathOrOptions)`

Executable browser actions are registered at runtime:

```js
const dispose = space.bundles.actions.register({
  bundleId: "acme/fleet",
  id: "fleet.open",
  title: "Open fleet",
  async run(payload) {
    return payload;
  }
});
```

When the module unmounts or disables the feature, call `dispose()` or `space.bundles.actions.unregister("fleet.open")`.

External integrations can publish bridge state through:

```js
space.bundles.bridge.registerSync("acme/fleet", async (payload) => payload);
await space.bundles.bridge.syncState("acme/fleet", { online: true });
```

## Install, Update, Remove

Bundles are installed, updated, and removed as modules.

Use the normal module locations:

- `L1/<group>/mod/<author>/<repo>/` for group-level customware
- `L2/<user>/mod/<author>/<repo>/` for user-level customware

The existing module APIs and admin module views still own installation and removal. Removing the module removes its bundle metadata, extension files, skills, and action handlers once the owning page reloads or unregisters them.

## Why Not Runtime Injection

Direct runtime injection is fragile because it depends on private file names, timing, or implementation details. Bundles should instead turn desired changes into stable extension contracts:

- add a missing HTML seam
- add a missing JS hook through `space.extend(...)`
- add metadata under `ext/...`
- add a browser-side action through `space.bundles.actions`
- add a bridge sync handler through `space.bundles.bridge`
- propose the missing seam upstream when no stable contract exists

That keeps downstream customizations rebase-friendly while preserving Space Agent's browser-first customware model.
