# AGENTS

## Purpose

`component_context_menu_bundle/` is a reference Customware Bundle Interface plugin for component-level context menus.

It demonstrates how an installable bundle can add browser behavior through documented `ext/js` hooks without patching Space Agent core runtime files.

## Ownership

This folder owns:

- `space.bundle.yaml`: bundle manifest metadata for discovery tests and module listings.
- `component-menu.js`: browser runtime that installs `space.componentMenu`.
- `component-menu.css`: bundle-owned menu presentation.
- `ext/js/_core/framework/initializer.js/initialize/end/component-context-menu.js`: the documented framework initializer hook that starts the bundle.
- `README.md`: install, update, removal, and action-registration guidance.

## Local Contracts

- Keep this fixture installable at `L1/<group>/mod/space/component-context-menu/` or `L2/<user>/mod/space/component-context-menu/`.
- Runtime behavior must enter through `_core/framework/initializer.js/initialize/end`.
- Do not patch `_core/spaces/store.js`, private widget functions, or other core runtime files.
- Treat widget DOM signals such as `.spaces-widget-card` and `data-widget-id` as the stable v1 component target contract.
- Keep `Copy ID` available in the menu footer because it is the agent-targeting workflow this bundle exists to support.

## Development Guidance

- Add new menu integrations through `space.componentMenu.registerAction(...)`.
- If a future component type needs stronger metadata than DOM discovery can provide, document the missing upstream seam before adding a workaround.
- Keep the example generic and not Hermes-branded; downstream mirrors can layer product-specific actions on top.
