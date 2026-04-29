function normalizeId(value) {
  return String(value || "").trim();
}

function cloneAction(action) {
  return {
    bundleId: normalizeId(action.bundleId),
    capability: normalizeId(action.capability),
    description: normalizeId(action.description),
    id: normalizeId(action.id),
    title: normalizeId(action.title || action.name || action.id)
  };
}

function dispatchBundleEvent(type, detail) {
  if (typeof globalThis.CustomEvent !== "function" || !globalThis.window) {
    return;
  }

  globalThis.window.dispatchEvent(new globalThis.CustomEvent(type, { detail }));
}

export function createBundleRuntime(options = {}) {
  const api = options.api;
  const actions = new Map();
  const bridgeSyncHandlers = new Map();

  function requireApi() {
    if (!api || typeof api.bundleList !== "function" || typeof api.bundleInfo !== "function") {
      throw new Error("space.bundles requires the framework API client.");
    }

    return api;
  }

  async function list(listOptions = {}) {
    return requireApi().bundleList(listOptions);
  }

  async function info(pathOrOptions) {
    return requireApi().bundleInfo(pathOrOptions);
  }

  function registerAction(action) {
    const source = action && typeof action === "object" ? action : {};
    const id = normalizeId(source.id);
    const title = normalizeId(source.title || source.name || id);

    if (!id || !title || typeof source.run !== "function") {
      throw new TypeError("Bundle actions require id, title, and run(payload, context).");
    }

    const entry = {
      ...cloneAction({ ...source, id, title }),
      run: source.run
    };

    actions.set(id, entry);
    dispatchBundleEvent("space:bundle-action-registered", cloneAction(entry));
    return () => unregisterAction(id);
  }

  function unregisterAction(id) {
    const normalizedId = normalizeId(id);
    const existing = actions.get(normalizedId);

    if (!existing) {
      return false;
    }

    actions.delete(normalizedId);
    dispatchBundleEvent("space:bundle-action-unregistered", cloneAction(existing));
    return true;
  }

  function listActions() {
    return [...actions.values()].map(cloneAction);
  }

  function getAction(id) {
    const entry = actions.get(normalizeId(id));
    return entry ? cloneAction(entry) : null;
  }

  async function runAction(id, payload = undefined, context = {}) {
    const entry = actions.get(normalizeId(id));

    if (!entry) {
      throw new Error(`Bundle action is not registered: ${String(id || "")}`);
    }

    return entry.run(payload, {
      action: cloneAction(entry),
      payload,
      ...context
    });
  }

  function registerBridgeSync(id, handler) {
    const normalizedId = normalizeId(id);

    if (!normalizedId || typeof handler !== "function") {
      throw new TypeError("Bridge sync handlers require id and handler(payload, context).");
    }

    bridgeSyncHandlers.set(normalizedId, handler);
    return () => unregisterBridgeSync(normalizedId);
  }

  function unregisterBridgeSync(id) {
    return bridgeSyncHandlers.delete(normalizeId(id));
  }

  async function syncBridgeState(id, payload = undefined, context = {}) {
    const normalizedId = normalizeId(id);
    const handler = bridgeSyncHandlers.get(normalizedId);

    dispatchBundleEvent("space:bundle-bridge-sync", {
      id: normalizedId,
      payload
    });

    if (!handler) {
      return null;
    }

    return handler(payload, {
      id: normalizedId,
      payload,
      ...context
    });
  }

  return {
    info,
    list,
    actions: {
      get: getAction,
      list: listActions,
      register: registerAction,
      run: runAction,
      unregister: unregisterAction
    },
    bridge: {
      registerSync: registerBridgeSync,
      syncState: syncBridgeState,
      unregisterSync: unregisterBridgeSync
    }
  };
}
