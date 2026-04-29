import { installComponentContextMenu } from "/mod/space/component-context-menu/component-menu.js";

export default async function componentContextMenuInitializerEnd() {
  installComponentContextMenu();
}
