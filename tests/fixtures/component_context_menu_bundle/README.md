# Component Context Menu Bundle

This reference Customware Bundle Interface plugin adds a right-click context menu for Space widget cards.

Install it as a normal customware module:

```txt
L1/team/mod/space/component-context-menu/
L2/alice/mod/space/component-context-menu/
```

The bundle uses the documented `_core/framework/initializer.js/initialize/end` browser hook. It does not edit Space Agent core files or monkey patch private widget runtime functions.

## What It Does

- Right-click a Space widget card to open a component menu.
- Use the footer `Copy ID` button to copy the clicked UI entity id.
- Paste that id into Agent Space when you want the agent to modify a precise widget or component.
- Register custom actions that appear above the footer and receive the clicked component context.

## Action Registration

Other bundles can add menu actions from browser code:

```js
const unregister = space.componentMenu.registerAction({
  id: "example.inspect",
  label: "Inspect component",
  order: 100,
  when(context) {
    return context.type === "space-widget";
  },
  async run(context) {
    console.log(context.id, context.widgetId, context.path);
  }
});
```

Call `unregister()` when the action should disappear.

The v1 context contains:

- `type`
- `id`
- `widgetId`
- `spaceId`
- `path`
- `element`
- `event`

## Update And Remove

Update or remove this bundle the same way as any other installed module. Removing the module removes its manifest and hook files; the context menu runtime disappears after the page reloads.

Direct runtime injection is discouraged because it binds customware to private implementation details. This bundle keeps the customization attached to Space Agent through documented module, manifest, and `ext/js` seams.
