import { showToast } from "/mod/_core/visual/chrome/toast.js";

const BUNDLE_ID = "space/component-context-menu";
const MENU_LAYER_ID = "space-component-context-menu-layer";
const STYLESHEET_ID = "space-component-context-menu-style";
const STYLESHEET_HREF = "/mod/space/component-context-menu/component-menu.css";
const RUNTIME_KEY = "__spaceComponentMenuRuntime";
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOrder(value) {
  const order = Number(value);
  return Number.isFinite(order) ? order : 100;
}

function getSpaceRuntime() {
  if (!globalThis.space || typeof globalThis.space !== "object") {
    globalThis.space = {};
  }

  return globalThis.space;
}

function getSpacesStore() {
  try {
    return globalThis.Alpine?.store?.("spacesPage") || null;
  } catch {
    return null;
  }
}

function ensureStylesheet() {
  if (document.getElementById(STYLESHEET_ID)) {
    return;
  }

  const link = document.createElement("link");
  link.id = STYLESHEET_ID;
  link.rel = "stylesheet";
  link.href = STYLESHEET_HREF;
  document.head.append(link);
}

function isElement(value) {
  return typeof Element !== "undefined" && value instanceof Element;
}

function findElementTarget(target) {
  if (isElement(target)) {
    return target;
  }

  return isElement(target?.parentElement) ? target.parentElement : null;
}

function isEditableTarget(target) {
  const element = findElementTarget(target);
  return Boolean(element?.closest?.(EDITABLE_SELECTOR));
}

function findComponentElement(target) {
  const element = findElementTarget(target);

  if (!element) {
    return null;
  }

  return element.closest("[data-space-component-id], .spaces-widget-card[data-widget-id], .spaces-widget-card, [data-widget-id]");
}

function buildWidgetPath(spaceId, widgetId) {
  const normalizedSpaceId = normalizeText(spaceId);
  const normalizedWidgetId = normalizeText(widgetId);

  if (!normalizedSpaceId || !normalizedWidgetId) {
    return "";
  }

  return `~/spaces/${normalizedSpaceId}/widgets/${normalizedWidgetId}.yaml`;
}

function getContextFromEvent(event) {
  if (!event || isEditableTarget(event.target)) {
    return null;
  }

  const element = findComponentElement(event.target);

  if (!element) {
    return null;
  }

  const widgetCard = element.closest?.(".spaces-widget-card[data-widget-id], .spaces-widget-card, [data-widget-id]") || element;
  const widgetId = normalizeText(widgetCard?.dataset?.widgetId || element.dataset?.widgetId);
  const componentId = normalizeText(element.dataset?.spaceComponentId || widgetId || element.id);

  if (!componentId) {
    return null;
  }

  const spacesStore = getSpacesStore();
  const spaceId = normalizeText(
    element.dataset?.spaceId ||
      widgetCard?.dataset?.spaceId ||
      spacesStore?.currentSpaceId ||
      spacesStore?.currentSpace?.id
  );
  const type = widgetId ? "space-widget" : "component";

  return {
    type,
    id: componentId,
    widgetId,
    spaceId,
    path: buildWidgetPath(spaceId, widgetId),
    element,
    event
  };
}

function clonePublicContext(context) {
  return {
    type: context.type,
    id: context.id,
    widgetId: context.widgetId,
    spaceId: context.spaceId,
    path: context.path,
    element: context.element,
    event: context.event
  };
}

async function copyTextToClipboard(text) {
  const value = normalizeText(text);

  if (!value) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  document.body.append(input);
  input.select();

  try {
    return document.execCommand("copy");
  } finally {
    input.remove();
  }
}

function notify(message, tone = "success") {
  showToast(message, {
    durationMs: 1800,
    tone
  });
}

function dispatchRuntimeEvent(type, detail) {
  if (typeof CustomEvent !== "function" || !globalThis.window) {
    return;
  }

  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function normalizeAction(action) {
  const source = action && typeof action === "object" ? action : {};
  const id = normalizeText(source.id);
  const label = normalizeText(source.label || source.title || source.name || id);

  if (!id || !label || typeof source.run !== "function") {
    throw new TypeError("Component menu actions require id, label/title, and run(context).");
  }

  return {
    bundleId: normalizeText(source.bundleId || BUNDLE_ID),
    id,
    label,
    order: normalizeOrder(source.order),
    when: typeof source.when === "function" ? source.when : null,
    run: source.run
  };
}

function createRuntime() {
  const actions = new Map();
  let layer = null;
  let activeContext = null;

  function unregisterAction(id) {
    const normalizedId = normalizeText(id);
    const existing = actions.get(normalizedId);

    if (!existing) {
      return false;
    }

    actions.delete(normalizedId);
    dispatchRuntimeEvent("space:component-menu-action-unregistered", {
      id: normalizedId,
      bundleId: existing.bundleId
    });
    return true;
  }

  function registerAction(action) {
    const entry = normalizeAction(action);
    actions.set(entry.id, entry);
    dispatchRuntimeEvent("space:component-menu-action-registered", {
      id: entry.id,
      bundleId: entry.bundleId,
      label: entry.label
    });
    return () => unregisterAction(entry.id);
  }

  function getVisibleActions(context) {
    const publicContext = clonePublicContext(context);

    return [...actions.values()]
      .filter((action) => {
        if (!action.when) {
          return true;
        }

        try {
          return Boolean(action.when(publicContext));
        } catch (error) {
          console.warn("[component-context-menu] action predicate failed", action.id, error);
          return false;
        }
      })
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }

  function listActions(context = null) {
    const candidateActions = context ? getVisibleActions(context) : [...actions.values()];
    return candidateActions.map((action) => ({
      bundleId: action.bundleId,
      id: action.id,
      label: action.label,
      order: action.order
    }));
  }

  function close() {
    if (!layer) {
      return;
    }

    layer.remove();
    layer = null;
    activeContext = null;
  }

  async function runMenuAction(action, context) {
    try {
      await action.run(clonePublicContext(context));
      close();
    } catch (error) {
      console.error("[component-context-menu] action failed", action.id, error);
      notify(String(error?.message || "Component menu action failed."), "error");
    }
  }

  async function copyContextId(context) {
    try {
      await copyTextToClipboard(context.id);
      notify("Component ID copied.");
      close();
    } catch (error) {
      console.error("[component-context-menu] copy id failed", error);
      notify("Unable to copy component ID.", "error");
    }
  }

  function createMenuButton(action, context) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "space-component-menu-action";
    button.setAttribute("role", "menuitem");
    button.textContent = action.label;
    button.addEventListener("click", () => {
      void runMenuAction(action, context);
    });
    return button;
  }

  function buildLayer(context) {
    const nextLayer = document.createElement("div");
    nextLayer.id = MENU_LAYER_ID;
    nextLayer.className = "space-component-menu-layer";

    const panel = document.createElement("section");
    panel.className = "space-component-menu-panel";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "Component actions");

    const header = document.createElement("header");
    header.className = "space-component-menu-header";

    const title = document.createElement("p");
    title.className = "space-component-menu-title";
    title.textContent = context.type === "space-widget" ? "Space widget" : "Component";

    const subtitle = document.createElement("p");
    subtitle.className = "space-component-menu-subtitle";
    subtitle.textContent = context.id;
    header.append(title, subtitle);

    const actionsElement = document.createElement("div");
    actionsElement.className = "space-component-menu-actions";
    const visibleActions = getVisibleActions(context);

    if (visibleActions.length) {
      visibleActions.forEach((action) => {
        actionsElement.append(createMenuButton(action, context));
      });
    } else {
      const empty = document.createElement("p");
      empty.className = "space-component-menu-empty";
      empty.textContent = "No custom actions";
      actionsElement.append(empty);
    }

    const footer = document.createElement("footer");
    footer.className = "space-component-menu-footer";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "space-component-menu-footer-button";
    copyButton.setAttribute("role", "menuitem");
    copyButton.textContent = "Copy ID";
    copyButton.addEventListener("click", () => {
      void copyContextId(context);
    });
    footer.append(copyButton);

    panel.append(header, actionsElement, footer);
    nextLayer.append(panel);
    return {
      layer: nextLayer,
      panel
    };
  }

  function placePanel(panel, clientX, clientY) {
    const margin = 8;
    const rect = panel.getBoundingClientRect();
    const left = Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function open(context, position = {}) {
    close();
    activeContext = context;
    const menu = buildLayer(context);
    layer = menu.layer;
    document.body.append(layer);
    placePanel(menu.panel, Number(position.clientX) || 0, Number(position.clientY) || 0);
    menu.panel.querySelector("button")?.focus?.({ preventScroll: true });
    dispatchRuntimeEvent("space:component-menu-opened", {
      id: context.id,
      type: context.type,
      widgetId: context.widgetId,
      spaceId: context.spaceId
    });
  }

  function handleContextMenu(event) {
    if (layer?.contains(event.target)) {
      event.preventDefault();
      return;
    }

    const context = getContextFromEvent(event);

    if (!context) {
      return;
    }

    event.preventDefault();
    open(context, {
      clientX: event.clientX,
      clientY: event.clientY
    });
  }

  function handlePointerDown(event) {
    if (layer && !layer.contains(event.target)) {
      close();
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      close();
    }
  }

  function destroy() {
    close();
    document.removeEventListener("contextmenu", handleContextMenu, true);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close, true);
    actions.clear();
  }

  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close, true);

  return {
    close,
    destroy,
    get activeContext() {
      return activeContext ? clonePublicContext(activeContext) : null;
    },
    getContextFromEvent,
    listActions,
    open,
    registerAction,
    unregisterAction
  };
}

function registerBuiltInActions(runtime) {
  runtime.registerAction({
    id: "space.component_menu.copy_widget_path",
    label: "Copy Widget Path",
    order: 20,
    when(context) {
      return context.type === "space-widget" && Boolean(context.path);
    },
    async run(context) {
      await copyTextToClipboard(context.path);
      notify("Widget path copied.");
    }
  });
}

function registerBundleAction(runtime) {
  const bundles = getSpaceRuntime().bundles;

  if (!bundles?.actions?.register) {
    return null;
  }

  return bundles.actions.register({
    bundleId: BUNDLE_ID,
    capability: "component-menu",
    id: "space.component_menu.copy_id",
    title: "Copy component ID",
    async run(payload = {}) {
      const id = normalizeText(payload.id || runtime.activeContext?.id);

      if (!id) {
        throw new Error("A component id is required.");
      }

      await copyTextToClipboard(id);
      notify("Component ID copied.");
      return {
        id
      };
    }
  });
}

export function installComponentContextMenu() {
  if (globalThis[RUNTIME_KEY]) {
    return globalThis[RUNTIME_KEY].api;
  }

  ensureStylesheet();

  const api = createRuntime();
  const unregisterBundleAction = registerBundleAction(api);
  registerBuiltInActions(api);

  const runtime = {
    api,
    destroy() {
      unregisterBundleAction?.();
      api.destroy();
      delete globalThis[RUNTIME_KEY];
    }
  };

  globalThis[RUNTIME_KEY] = runtime;

  const space = getSpaceRuntime();
  space.componentMenu = api;

  return api;
}
