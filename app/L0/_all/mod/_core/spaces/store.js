import {
  DEFAULT_WIDGET_POSITION,
  MAX_WIDGET_COLS,
  MAX_WIDGET_ROWS,
  SPACES_ROUTE_PATH,
  WIDGET_API_VERSION
} from "/mod/_core/spaces/constants.js";
import {
  buildCenteredFirstFitLayout,
  clampWidgetPosition,
  findFirstFitWidgetPlacement,
  getRenderedWidgetSize,
  normalizeWidgetPosition,
  resolveSpaceLayout
} from "/mod/_core/spaces/layout.js";
import {
  buildSpaceRootPath,
  buildSpaceWidgetFilePath,
  createSpace,
  createWidgetSource,
  duplicateSpace as duplicateSpaceFromStorage,
  installExampleSpace as installExampleSpaceFromStorage,
  listSpaces,
  normalizeRendererSource,
  normalizeSpaceId,
  normalizeWidgetId,
  patchWidget as patchWidgetFromStorage,
  previewWidgetRecord,
  readSpace,
  readWidget as readWidgetFromStorage,
  removeSpace,
  removeWidget,
  removeWidgets as removeWidgetsFromStorage,
  resolveAppUrl,
  saveSpaceLayout,
  saveSpaceMeta,
  upsertWidget
} from "/mod/_core/spaces/storage.js";
import { loadEmptyCanvasExamples } from "/mod/_core/spaces/empty-canvas-examples.js";
import {
  DEFAULT_SPACE_ICON,
  DEFAULT_SPACE_ICON_COLOR,
  getSpaceDisplayIcon,
  getSpaceDisplayIconColor,
  getSpaceDisplayTitle,
  normalizeSpaceAgentInstructions,
  normalizeSpaceIcon,
  normalizeSpaceIconColor,
  normalizeSpaceTitle
} from "/mod/_core/spaces/space-metadata.js";
import { openIconColorSelector } from "/mod/_core/visual/icons/icon-color-selector.js";
import {
  DEFAULT_WIDGET_SIZE,
  defineWidget,
  normalizeWidgetSize,
  sizeToToken,
} from "/mod/_core/spaces/widget-sdk-core.js";
import { renderWidgetOutput } from "/mod/_core/spaces/widget-render.js";

let activeSpacesStore = null;
const SPACES_STORE_NAME = "spacesPage";
const TAU = Math.PI * 2;
const GRID_BASE_HALF_COLS = 0;
const GRID_BASE_HALF_ROWS = 0;
const GRID_CONTENT_BUFFER_COLS = 6;
const GRID_CONTENT_BUFFER_ROWS = 6;
const GRID_CAMERA_BUFFER_COLS = 2;
const GRID_CAMERA_BUFFER_ROWS = 2;
const GRID_EDGE_SCROLL_THRESHOLD = 72;
const GRID_EDGE_SCROLL_SPEED = 8;
const SPACE_META_PERSIST_DELAY_MS = 320;
const CURRENT_WIDGET_TRANSIENT_KEY = "spaces/current-widget";
const EMPTY_SPACE_FLOAT_PROFILE = Object.freeze({
  orbitPeriodMs: 12400,
  rotationAmplitude: 3.2,
  rotationPeriodMs: 17600,
  xRadius: 7.2,
  yRadius: 8.2
});
const EMPTY_SPACE_TEXT_FLOAT_PROFILES = Object.freeze([
  {
    orbitPeriodMs: 13600,
    phase: 0.2,
    rotationAmplitude: 1.4,
    rotationPeriodMs: 18800,
    xRadius: 5.8,
    yRadius: 6.2
  },
  {
    orbitPeriodMs: 14900,
    phase: 1.35,
    rotationAmplitude: 1.1,
    rotationPeriodMs: 17100,
    xRadius: 4.4,
    yRadius: 5.1
  },
  {
    orbitPeriodMs: 14300,
    phase: 2.45,
    rotationAmplitude: 1.35,
    rotationPeriodMs: 19400,
    xRadius: 5.4,
    yRadius: 6
  },
  {
    orbitPeriodMs: 15500,
    phase: 3.1,
    rotationAmplitude: 1,
    rotationPeriodMs: 18200,
    xRadius: 4.2,
    yRadius: 4.8
  }
]);
const EMPTY_SPACE_SEQUENCE_PROFILE = Object.freeze({
  buttonsDelayMs: 2400,
  examplesLineDelayMs: 2400,
  firstLineDelayMs: 500,
  introGapDelayMs: 2400,
  lineSwapGapDelayMs: 3600,
  promptLineDelayMs: 2200
});

function positiveModulo(value, divisor) {
  if (!Number.isFinite(divisor) || divisor === 0) {
    return 0;
  }

  return ((value % divisor) + divisor) % divisor;
}

function clampNumber(value, min, max) {
  if (min > max) {
    return (min + max) / 2;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeRenderWidgetRequest(optionsOrId, cols, rows, renderer) {
  if (optionsOrId && typeof optionsOrId === "object" && !Array.isArray(optionsOrId)) {
    return { ...optionsOrId };
  }

  return {
    cols,
    id: optionsOrId,
    rows,
    renderer
  };
}

function normalizeRuntimeWidgetIdList(values) {
  const rawValues = Array.isArray(values) ? values : typeof values === "string" && values ? [values] : [];
  return [...new Set(rawValues.map((value) => String(value ?? "").trim()).filter(Boolean).map((value) => normalizeWidgetId(value)))];
}

function widgetSizesMatch(left, right) {
  const leftSize = normalizeWidgetSize(left, DEFAULT_WIDGET_SIZE);
  const rightSize = normalizeWidgetSize(right, DEFAULT_WIDGET_SIZE);
  return leftSize.cols === rightSize.cols && leftSize.rows === rightSize.rows;
}

function widgetPositionsMatch(left, right) {
  const leftPosition = normalizeWidgetPosition(left, DEFAULT_WIDGET_POSITION);
  const rightPosition = normalizeWidgetPosition(right, DEFAULT_WIDGET_POSITION);
  return leftPosition.col === rightPosition.col && leftPosition.row === rightPosition.row;
}

function widgetRecordNeedsRender(previousSpace, nextSpace, widgetId) {
  const previousWidget = getWidgetRecord(previousSpace, widgetId);
  const nextWidget = getWidgetRecord(nextSpace, widgetId);

  if (!previousWidget || !nextWidget) {
    return true;
  }

  return (
    previousWidget.name !== nextWidget.name ||
    previousWidget.rendererSource !== nextWidget.rendererSource ||
    previousWidget.schema !== nextWidget.schema ||
    !widgetSizesMatch(previousWidget.defaultSize, nextWidget.defaultSize) ||
    !widgetPositionsMatch(previousWidget.defaultPosition, nextWidget.defaultPosition)
  );
}

function hasExplicitWidgetPosition(options = {}) {
  return (
    options.position !== undefined ||
    options.col !== undefined ||
    options.row !== undefined
  );
}

function mergeWidgetOrder(prioritizedWidgetIds, existingWidgetIds) {
  const merged = [];
  const seen = new Set();

  [...prioritizedWidgetIds, ...existingWidgetIds].forEach((widgetId) => {
    if (!widgetId || seen.has(widgetId)) {
      return;
    }

    seen.add(widgetId);
    merged.push(widgetId);
  });

  return merged;
}

function normalizeWidgetLayoutEntries(entries) {
  const normalizedEntries = [];
  const entryMap = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }

    const rawWidgetId = String(entry.widgetId ?? entry.id ?? "").trim();

    if (!rawWidgetId) {
      return;
    }

    const widgetId = normalizeWidgetId(rawWidgetId);
    const positionSource = entry.position && typeof entry.position === "object" && !Array.isArray(entry.position) ? entry.position : entry;
    const sizeSource = entry.size && typeof entry.size === "object" && !Array.isArray(entry.size) ? entry.size : entry;
    const normalizedEntry = {
      id: widgetId
    };

    if (positionSource.col !== undefined || positionSource.row !== undefined) {
      normalizedEntry.position = normalizeWidgetPosition(
        {
          col: positionSource.col,
          row: positionSource.row
        },
        DEFAULT_WIDGET_POSITION
      );
    }

    if (sizeSource.cols !== undefined || sizeSource.rows !== undefined) {
      normalizedEntry.size = normalizeWidgetSize(
        {
          cols: sizeSource.cols,
          rows: sizeSource.rows
        },
        DEFAULT_WIDGET_SIZE
      );
    }

    if (entryMap.has(widgetId)) {
      entryMap.delete(widgetId);
    }

    entryMap.set(widgetId, normalizedEntry);
  });

  entryMap.forEach((entry) => {
    normalizedEntries.push(entry);
  });

  return normalizedEntries;
}

function assertSpaceOwnsWidgets(spaceRecord, widgetIds, actionLabel = "update widgets") {
  const missingWidgetIds = widgetIds.filter((widgetId) => !spaceRecord?.widgetIds?.includes(widgetId));

  if (!missingWidgetIds.length) {
    return;
  }

  throw new Error(`Cannot ${actionLabel}: widget ids not found in space "${spaceRecord?.id || ""}": ${missingWidgetIds.join(", ")}.`);
}

async function rearrangePersistedSpaceWidgets(options = {}) {
  const targetSpaceId = normalizeOptionalSpaceId(options.spaceId ?? options.id);

  if (!targetSpaceId) {
    throw new Error("A target spaceId is required to rearrange widgets.");
  }

  const currentSpace = await readSpace(targetSpaceId);
  const widgetEntries = normalizeWidgetLayoutEntries(options.widgets ?? options.widgetLayouts);

  if (!widgetEntries.length) {
    return currentSpace;
  }

  const widgetIds = widgetEntries.map((entry) => entry.id);
  assertSpaceOwnsWidgets(currentSpace, widgetIds, "rearrange widgets");

  const widgetPositions = { ...currentSpace.widgetPositions };
  const widgetSizes = { ...currentSpace.widgetSizes };
  widgetEntries.forEach((entry) => {
    if (entry.position) {
      widgetPositions[entry.id] = entry.position;
    }

    if (entry.size) {
      widgetSizes[entry.id] = entry.size;
    }
  });

  return saveSpaceLayout({
    id: targetSpaceId,
    minimizedWidgetIds: currentSpace.minimizedWidgetIds,
    widgetIds: mergeWidgetOrder(widgetIds, currentSpace.widgetIds),
    widgetPositions,
    widgetSizes
  });
}

async function togglePersistedSpaceWidgets(options = {}) {
  const targetSpaceId = normalizeOptionalSpaceId(options.spaceId ?? options.id);

  if (!targetSpaceId) {
    throw new Error("A target spaceId is required to toggle widgets.");
  }

  const currentSpace = await readSpace(targetSpaceId);
  const widgetIds = normalizeRuntimeWidgetIdList(options.widgetIds ?? options.widgets);

  if (!widgetIds.length) {
    return currentSpace;
  }

  assertSpaceOwnsWidgets(currentSpace, widgetIds, "toggle widgets");
  const nextMinimizedWidgetIds = new Set(currentSpace.minimizedWidgetIds);
  widgetIds.forEach((widgetId) => {
    if (nextMinimizedWidgetIds.has(widgetId)) {
      nextMinimizedWidgetIds.delete(widgetId);
      return;
    }

    nextMinimizedWidgetIds.add(widgetId);
  });

  return saveSpaceLayout({
    id: targetSpaceId,
    minimizedWidgetIds: [...nextMinimizedWidgetIds]
  });
}

function ensureSpacesRuntimeNamespace() {
  const runtime = globalThis.space;

  if (!runtime) {
    throw new Error("Space runtime is not available.");
  }

  const previousNamespace = runtime.spaces && typeof runtime.spaces === "object" ? runtime.spaces : {};
  const namespace = {
    ...previousNamespace,
    all: Array.isArray(previousNamespace.all) ? [...previousNamespace.all] : [],
    byId: previousNamespace.byId && typeof previousNamespace.byId === "object" ? { ...previousNamespace.byId } : {},
    createSpace: async (options = {}) => {
      const createdSpace = await createSpace(options);

      if (options.open !== false && globalThis.space.router) {
        await namespace.openSpace(createdSpace.id, {
          replace: options.replace === true
        });
      }

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(createdSpace.id);
      }

      return createdSpace;
    },
    createWidgetSource,
    duplicateSpace: async (spaceIdOrOptions = undefined) => {
      const requestedSpaceId =
        typeof spaceIdOrOptions === "string"
          ? spaceIdOrOptions
          : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
            ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id
            : activeSpacesStore?.currentSpaceId;
      const targetSpaceId = normalizeOptionalSpaceId(requestedSpaceId);

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to duplicate a space.");
      }

      const duplicatedSpace = await duplicateSpaceFromStorage({
        ...(spaceIdOrOptions && typeof spaceIdOrOptions === "object" ? spaceIdOrOptions : {}),
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(duplicatedSpace.id);
      }

      return duplicatedSpace;
    },
    installExampleSpace: async (options = {}) => {
      const createdSpace = await installExampleSpaceFromStorage(options);

      if (options.open !== false && globalThis.space.router) {
        await namespace.openSpace(createdSpace.id, {
          replace: options.replace === true
        });
      }

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(createdSpace.id);
      }

      return createdSpace;
    },
    current: previousNamespace.current || null,
    currentId: String(previousNamespace.currentId || ""),
    defineWidget,
    getCurrentSpace() {
      return globalThis.space?.current || null;
    },
    items: Array.isArray(previousNamespace.items) ? [...previousNamespace.items] : [],
    listSpaces,
    openSpace(spaceId, options = {}) {
      const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);

      if (!normalizedSpaceId) {
        throw new Error("A valid spaceId is required.");
      }

      if (!globalThis.space.router) {
        throw new Error("Router runtime is not available.");
      }

      return options.replace
        ? globalThis.space.router.replaceTo(SPACES_ROUTE_PATH, { params: { id: normalizedSpaceId } })
        : globalThis.space.router.goTo(SPACES_ROUTE_PATH, { params: { id: normalizedSpaceId } });
    },
    readSpace,
    rearrangeWidgets: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to rearrange widgets.");
      }

      const savedSpace = await rearrangePersistedSpaceWidgets({
        ...options,
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      return savedSpace;
    },
    renderWidget: async (optionsOrId, cols, rows, renderer) => {
      const request = normalizeRenderWidgetRequest(optionsOrId, cols, rows, renderer);
      const targetSpaceId = request.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to render a widget.");
      }

      const result = await upsertWidget({
        ...(await applyAutoWidgetPlacementToRequest(request, targetSpaceId)),
        name: request.name ?? request.title,
        spaceId: targetSpaceId,
        widgetId: request.widgetId ?? request.id
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId, {
          widgetId: result.widgetId
        });
      }

      return buildWidgetToolResult(result, {
        operationLabel: "renderWidget(...)",
        spaceId: targetSpaceId,
        widgetId: result.widgetId
      });
    },
    repairLayout: async (spaceIdOrOptions = undefined) => {
      const requestedSpaceId =
        typeof spaceIdOrOptions === "string"
          ? spaceIdOrOptions
          : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
            ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id ?? activeSpacesStore?.currentSpaceId
            : activeSpacesStore?.currentSpaceId;
      const targetSpaceId = normalizeOptionalSpaceId(requestedSpaceId);

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to repair a layout.");
      }

      const currentSpace = await readSpace(targetSpaceId);
      const savedSpace = await saveSpaceLayout({
        id: targetSpaceId,
        minimizedWidgetIds: currentSpace.minimizedWidgetIds,
        widgetIds: currentSpace.widgetIds,
        widgetPositions: currentSpace.widgetPositions,
        widgetSizes: currentSpace.widgetSizes
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      return savedSpace;
    },
    reloadCurrentSpace: async () => {
      if (!activeSpacesStore) {
        throw new Error("The spaces view is not currently mounted.");
      }

      await activeSpacesStore.reloadCurrentSpace();
      return activeSpacesStore.currentSpace;
    },
    reloadWidget: async (widgetIdOrOptions = {}) => {
      if (!activeSpacesStore) {
        throw new Error("The spaces view is not currently mounted.");
      }

      const requestedWidgetId =
        typeof widgetIdOrOptions === "string"
          ? widgetIdOrOptions
          : widgetIdOrOptions && typeof widgetIdOrOptions === "object"
            ? widgetIdOrOptions.widgetId ?? widgetIdOrOptions.id
            : "";
      const targetWidgetId = String(requestedWidgetId || "").trim() ? normalizeWidgetId(requestedWidgetId) : "";
      const targetSpaceId =
        typeof widgetIdOrOptions === "object" && widgetIdOrOptions && !Array.isArray(widgetIdOrOptions)
          ? normalizeOptionalSpaceId(widgetIdOrOptions.spaceId ?? activeSpacesStore.currentSpaceId)
          : activeSpacesStore.currentSpaceId;

      if (!targetWidgetId) {
        throw new Error("A widgetId is required to reload a widget.");
      }

      if (!targetSpaceId || targetSpaceId !== activeSpacesStore.currentSpaceId) {
        throw new Error("Widget reload is only available for the currently open space.");
      }

      return activeSpacesStore.reloadWidget(targetWidgetId);
    },
    removeSpace: async (spaceIdOrOptions = undefined) => {
      const requestedSpaceId =
        typeof spaceIdOrOptions === "string"
          ? spaceIdOrOptions
          : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
            ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id ?? activeSpacesStore?.currentSpaceId
            : activeSpacesStore?.currentSpaceId;
      const targetSpaceId = normalizeOptionalSpaceId(requestedSpaceId);

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to remove a space.");
      }

      const result = await removeSpace({
        ...(spaceIdOrOptions && typeof spaceIdOrOptions === "object" ? spaceIdOrOptions : {}),
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleRemovedSpace(targetSpaceId);
      }

      return result;
    },
    removeWidget: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to remove a widget.");
      }

      const result = await removeWidget({
        ...options,
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      clearCurrentWidgetTransientSection(result.widgetId);

      return result;
    },
    removeWidgets: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to remove widgets.");
      }

      const result = await removeWidgetsFromStorage({
        ...options,
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      result.widgetIds.forEach((widgetId) => clearCurrentWidgetTransientSection(widgetId));

      return result;
    },
    removeAllWidgets: async (spaceIdOrOptions = undefined) => {
      const requestedSpaceId =
        typeof spaceIdOrOptions === "string"
          ? spaceIdOrOptions
          : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
            ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id ?? activeSpacesStore?.currentSpaceId
            : activeSpacesStore?.currentSpaceId;
      const targetSpaceId = normalizeOptionalSpaceId(requestedSpaceId);

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to remove all widgets.");
      }

      const currentSpace = await readSpace(targetSpaceId);
      const result =
        currentSpace.widgetIds.length > 0
          ? await removeWidgetsFromStorage({
              spaceId: targetSpaceId,
              widgetIds: currentSpace.widgetIds
            })
          : {
              space: currentSpace,
              widgetIds: []
            };

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      result.widgetIds.forEach((widgetId) => clearCurrentWidgetTransientSection(widgetId));

      return result;
    },
    patchWidget: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to patch a widget.");
      }

      const result = await patchWidgetFromStorage({
        ...options,
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId, {
          widgetId: result.widgetId
        });
      }

      return buildWidgetToolResult(result, {
        operationLabel: "patchWidget(...)",
        spaceId: targetSpaceId,
        widgetId: result.widgetId
      });
    },
    resolveAppUrl,
    saveSpaceLayout: async (options = {}) => {
      const savedSpace = await saveSpaceLayout(options);

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(savedSpace.id);
      }

      return savedSpace;
    },
    saveSpaceMeta: async (options = {}) => {
      const savedSpace = await saveSpaceMeta(options);

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(savedSpace.id);
      }

      return savedSpace;
    },
    sizeToToken,
    toggleWidgets: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to toggle widgets.");
      }

      const savedSpace = await togglePersistedSpaceWidgets({
        ...options,
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      return savedSpace;
    },
    upsertWidget: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to save a widget.");
      }

      const result = await upsertWidget({
        ...(await applyAutoWidgetPlacementToRequest(options, targetSpaceId)),
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId, {
          widgetId: result.widgetId
        });
      }

      return buildWidgetToolResult(result, {
        operationLabel: "upsertWidget(...)",
        spaceId: targetSpaceId,
        widgetId: result.widgetId
      });
    },
    widgetApiVersion: WIDGET_API_VERSION
  };

  runtime.spaces = namespace;
  return namespace;
}

const spacesRuntime = ensureSpacesRuntimeNamespace();

function createElement(tagName, className = "", textContent = "") {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (textContent) {
    element.textContent = textContent;
  }

  return element;
}

function formatErrorMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message || fallback;
}

function logSpacesError(context, error, details = undefined) {
  if (details === undefined) {
    console.error(`[spaces] ${context}`, error);
    return;
  }

  console.error(`[spaces] ${context}`, details, error);
}

function normalizeOptionalSpaceId(value) {
  const rawValue = String(value ?? "").trim();
  return rawValue ? normalizeSpaceId(rawValue) : "";
}

function normalizeOptionalWidgetId(value) {
  const rawValue = String(value ?? "").trim();
  return rawValue ? normalizeWidgetId(rawValue) : "";
}

function createWidgetRenderCheck(options = {}) {
  const widgetId = normalizeOptionalWidgetId(options.widgetId ?? options.id);
  const status = options.status === "ok" || options.status === "error" ? options.status : "not_checked";
  const defaultMessage =
    status === "ok"
      ? `Widget "${widgetId}" rendered successfully.`
      : status === "error"
        ? `Widget "${widgetId}" failed to render.`
        : `Widget "${widgetId}" has not been live-tested yet.`;

  return {
    checked: status !== "not_checked",
    message: String(options.message || defaultMessage),
    needsRepair: status === "error",
    ok: status === "ok" ? true : status === "error" ? false : null,
    phase: String(options.phase || ""),
    status,
    widgetId
  };
}

function createUncheckedWidgetRenderCheck(widgetId, message = "") {
  return createWidgetRenderCheck({
    message,
    status: "not_checked",
    widgetId
  });
}

function createSuccessfulWidgetRenderCheck(widgetId, phase = "render") {
  return createWidgetRenderCheck({
    phase,
    status: "ok",
    widgetId
  });
}

function createFailedWidgetRenderCheck(widgetId, error, phase = "render") {
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);

  return createWidgetRenderCheck({
    message: `Widget "${normalizedWidgetId}" failed to render: ${formatErrorMessage(
      error,
      `Unable to render widget "${normalizedWidgetId}".`
    )}`,
    phase,
    status: "error",
    widgetId: normalizedWidgetId
  });
}

function cloneWidgetRenderCheck(check, widgetId = "") {
  return createWidgetRenderCheck({
    ...(check && typeof check === "object" ? check : {}),
    widgetId: check?.widgetId || widgetId
  });
}

function getWidgetRenderCheckForSpace(spaceId, widgetId) {
  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);

  if (!normalizedWidgetId) {
    return createUncheckedWidgetRenderCheck("", "No widget id was provided for the live render check.");
  }

  if (activeSpacesStore?.currentSpaceId === normalizedSpaceId) {
    return activeSpacesStore.getWidgetRenderCheck(normalizedWidgetId);
  }

  return createUncheckedWidgetRenderCheck(
    normalizedWidgetId,
    normalizedSpaceId
      ? `Widget "${normalizedWidgetId}" was not live-tested because space "${normalizedSpaceId}" is not currently open.`
      : `Widget "${normalizedWidgetId}" was not live-tested because no current space is open.`
  );
}

function getWidgetOperationStatusVerb(operationLabel) {
  switch (String(operationLabel || "").trim()) {
    case "patchWidget(...)":
      return "patched";
    case "reloadWidget(...)":
      return "reloaded";
    case "renderWidget(...)":
    case "upsertWidget(...)":
      return "saved";
    default:
      return "updated";
  }
}

function formatWidgetOperationStatusText(widgetId, operationLabel, widgetRender, options = {}) {
  const check = cloneWidgetRenderCheck(widgetRender, widgetId);
  const verb = getWidgetOperationStatusVerb(operationLabel);
  const targetLabel = widgetId ? `Widget "${widgetId}"` : "Widget";
  const suffix = options.transientUpdated ? "loaded to TRANSIENT." : "done.";

  if (check.status === "error") {
    return `${targetLabel} ${verb}, render failed, ${suffix}`;
  }

  if (check.status === "ok") {
    return `${targetLabel} ${verb}, rendered ok, ${suffix}`;
  }

  return `${targetLabel} ${verb}, not live-tested, ${suffix}`;
}

function extractWidgetIdFromWidgetText(widgetText) {
  const match = String(widgetText || "").match(/^id:\s*(.+)$/mu);
  return normalizeOptionalWidgetId(match?.[1] || "");
}

function getChatTransientRuntime() {
  const transient = globalThis.space?.chat?.transient;
  return transient && typeof transient.set === "function" ? transient : null;
}

function buildCurrentWidgetTransientContent({
  spaceId = "",
  widgetId = "",
  widgetPath = "",
  widgetStatusText = "",
  widgetHtml = "",
  widgetHtmlAvailable = false,
  widgetHtmlUnavailableReason = "",
  widgetText = ""
} = {}) {
  const normalizedWidgetText = typeof widgetText === "string" ? widgetText.trim() : "";

  if (!normalizedWidgetText) {
    return "";
  }

  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);
  const normalizedWidgetId =
    normalizeOptionalWidgetId(widgetId) || extractWidgetIdFromWidgetText(normalizedWidgetText);
  const normalizedWidgetHtml = typeof widgetHtml === "string" ? widgetHtml.trim() : "";
  const lines = [];

  if (normalizedSpaceId) {
    lines.push(`spaceId: ${normalizedSpaceId}`);
  }

  if (normalizedWidgetId) {
    lines.push(`widgetId: ${normalizedWidgetId}`);
  }

  if (widgetPath) {
    lines.push(`widgetPath: ${widgetPath}`);
  }

  if (widgetStatusText) {
    lines.push(`status: ${widgetStatusText}`);
  }

  lines.push("", "rendered↓");

  if (widgetHtmlAvailable) {
    lines.push(normalizedWidgetHtml || "(empty)");
  } else if (widgetHtmlUnavailableReason) {
    lines.push(`(unavailable: ${widgetHtmlUnavailableReason})`);
  } else {
    lines.push("(unavailable)");
  }

  lines.push("", "source↓", normalizedWidgetText);

  return lines.join("\n");
}

function updateCurrentWidgetTransientSection({
  spaceId = "",
  widgetId = "",
  widgetPath = "",
  widgetStatusText = "",
  widgetHtml = "",
  widgetHtmlAvailable = false,
  widgetHtmlUnavailableReason = "",
  widgetText = ""
} = {}) {
  const transient = getChatTransientRuntime();
  const content = buildCurrentWidgetTransientContent({
    spaceId,
    widgetId,
    widgetPath,
    widgetStatusText,
    widgetHtml,
    widgetHtmlAvailable,
    widgetHtmlUnavailableReason,
    widgetText
  });

  if (!transient || !content) {
    return false;
  }

  transient.set(CURRENT_WIDGET_TRANSIENT_KEY, {
    content,
    heading: "Current Widget",
    key: CURRENT_WIDGET_TRANSIENT_KEY,
    order: 300
  });
  return true;
}

function clearCurrentWidgetTransientSection(widgetId = "") {
  const transient = getChatTransientRuntime();

  if (!transient || typeof transient.delete !== "function") {
    return false;
  }

  if (!widgetId || typeof transient.get !== "function") {
    return transient.delete(CURRENT_WIDGET_TRANSIENT_KEY);
  }

  const currentSection = transient.get(CURRENT_WIDGET_TRANSIENT_KEY);
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);

  if (!currentSection?.content || !normalizedWidgetId) {
    return false;
  }

  if (!currentSection.content.includes(`widgetId: ${normalizedWidgetId}`)) {
    return false;
  }

  return transient.delete(CURRENT_WIDGET_TRANSIENT_KEY);
}

function emitWidgetToolStatus(statusText, widgetRender = null) {
  const normalizedStatusText = String(statusText || "").trim();

  if (!normalizedStatusText) {
    return "";
  }

  const check = widgetRender ? cloneWidgetRenderCheck(widgetRender, widgetRender.widgetId) : null;

  if (check?.status === "error") {
    console.error(`[spaces] ${normalizedStatusText}`, check.message);
  } else {
    console.log(`[spaces] ${normalizedStatusText}`);
  }

  return normalizedStatusText;
}

function emitWidgetReadToolResult(widgetText = "", widgetId = "") {
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);
  const statusText = normalizedWidgetId ? `Read widget "${normalizedWidgetId}".` : "Read current widget.";

  console.log(`[spaces] ${statusText}`);
  return typeof widgetText === "string" ? widgetText : "";
}

function emitWidgetSeeToolResult(widgetHtml = "", widgetId = "", full = false) {
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);
  const statusText = normalizedWidgetId
    ? `Captured ${full ? "full" : "stripped"} rendered HTML for widget "${normalizedWidgetId}".`
    : `Captured ${full ? "full" : "stripped"} rendered HTML for the current widget.`;

  console.log(`[spaces] ${statusText}`);
  return typeof widgetHtml === "string" ? widgetHtml : "";
}

function readMountedWidgetHtmlEnvelope({ spaceId = "", widgetId = "", full = false, widgetRender = null } = {}) {
  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);
  const activeSpaceId = normalizeOptionalSpaceId(activeSpacesStore?.currentSpaceId);

  if (normalizedSpaceId && normalizedWidgetId && normalizedSpaceId === activeSpaceId) {
    const widgetCard = activeSpacesStore?.widgetCards?.[normalizedWidgetId];

    if (widgetCard?.renderTarget) {
      return {
        available: true,
        html: buildWidgetInstanceHtmlResult(widgetCard.renderTarget.innerHTML, full),
        unavailableReason: ""
      };
    }
  }

  const check = widgetRender ? cloneWidgetRenderCheck(widgetRender, normalizedWidgetId) : null;
  return {
    available: false,
    html: "",
    unavailableReason: String(check?.message || "").trim() || "The current widget instance is not mounted."
  };
}

async function buildWidgetToolResult(baseResult = {}, { operationLabel = "widget operation", spaceId = "", widgetId = "" } = {}) {
  const nextResult = baseResult && typeof baseResult === "object" ? { ...baseResult } : {};
  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId || nextResult.space?.id);
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId || nextResult.widgetId);
  const widgetPath =
    nextResult.widgetPath || (normalizedSpaceId && normalizedWidgetId ? buildSpaceWidgetFilePath(normalizedSpaceId, normalizedWidgetId) : "");

  if ((typeof nextResult.widgetText !== "string" || !nextResult.widgetText) && normalizedSpaceId && normalizedWidgetId) {
    try {
      nextResult.widgetText = await readWidgetFromStorage({
        spaceId: normalizedSpaceId,
        widgetName: normalizedWidgetId
      });
    } catch {
      nextResult.widgetText = typeof nextResult.widgetText === "string" ? nextResult.widgetText : "";
    }
  }

  const widgetRender = getWidgetRenderCheckForSpace(normalizedSpaceId, normalizedWidgetId);
  const widgetView = readMountedWidgetHtmlEnvelope({
    full: false,
    spaceId: normalizedSpaceId,
    widgetId: normalizedWidgetId,
    widgetRender
  });
  const widgetText = typeof nextResult.widgetText === "string" ? nextResult.widgetText : "";
  const transientUpdated = updateCurrentWidgetTransientSection({
    spaceId: normalizedSpaceId,
    widgetId: normalizedWidgetId,
    widgetPath,
    widgetStatusText: "",
    widgetHtml: widgetView.html,
    widgetHtmlAvailable: widgetView.available,
    widgetHtmlUnavailableReason: widgetView.unavailableReason,
    widgetText
  });
  const widgetStatusText = formatWidgetOperationStatusText(normalizedWidgetId, operationLabel, widgetRender, {
    transientUpdated
  });

  if (transientUpdated) {
    updateCurrentWidgetTransientSection({
      spaceId: normalizedSpaceId,
      widgetId: normalizedWidgetId,
      widgetPath,
      widgetStatusText,
      widgetHtml: widgetView.html,
      widgetHtmlAvailable: widgetView.available,
      widgetHtmlUnavailableReason: widgetView.unavailableReason,
      widgetText
    });
  }

  return emitWidgetToolStatus(widgetStatusText, widgetRender);
}

function formatTitleFromId(id) {
  return String(id || "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function listReadableRuntimeWidgetChoices(spaceRecord) {
  return normalizeRuntimeWidgetIdList(spaceRecord?.widgetIds).map((widgetId) => {
    const widgetName = String(getWidgetRecord(spaceRecord, widgetId)?.name || formatTitleFromId(widgetId)).trim();
    return widgetName && widgetName !== widgetId ? `${widgetId} (${widgetName})` : widgetId;
  });
}

function resolveWidgetIdFromMountedSpace(spaceRecord, widgetName) {
  const rawWidgetName = String(widgetName ?? "").trim();

  if (!rawWidgetName) {
    throw new Error("A widget name or id is required.");
  }

  const normalizedWidgetId = normalizeOptionalWidgetId(rawWidgetName);

  if (normalizedWidgetId && getWidgetRecord(spaceRecord, normalizedWidgetId)) {
    return normalizedWidgetId;
  }

  const normalizedWidgetName = rawWidgetName.toLocaleLowerCase();
  const matchingWidgetIds = normalizeRuntimeWidgetIdList(spaceRecord?.widgetIds).filter((widgetId) => {
    const displayName = String(getWidgetRecord(spaceRecord, widgetId)?.name || formatTitleFromId(widgetId)).trim();
    return displayName.toLocaleLowerCase() === normalizedWidgetName;
  });

  if (matchingWidgetIds.length === 1) {
    return matchingWidgetIds[0];
  }

  if (matchingWidgetIds.length > 1) {
    throw new Error(
      `Widget name "${rawWidgetName}" is ambiguous in space "${spaceRecord?.id || ""}". Matches: ${matchingWidgetIds
        .map((widgetId) => {
          const widgetName = String(getWidgetRecord(spaceRecord, widgetId)?.name || formatTitleFromId(widgetId)).trim();
          return widgetName && widgetName !== widgetId ? `${widgetId} (${widgetName})` : widgetId;
        })
        .join(", ")}.`
    );
  }

  const availableWidgets = listReadableRuntimeWidgetChoices(spaceRecord);
  throw new Error(
    `Widget "${rawWidgetName}" was not found in space "${spaceRecord?.id || ""}". Available widgets: ${
      availableWidgets.length ? availableWidgets.join(", ") : "none"
    }.`
  );
}

function shouldStripWidgetHtmlAttribute(attributeName = "") {
  const normalizedName = String(attributeName || "").trim().toLowerCase();

  if (!normalizedName) {
    return false;
  }

  return (
    normalizedName === "class" ||
    normalizedName === "id" ||
    normalizedName === "part" ||
    normalizedName === "role" ||
    normalizedName === "slot" ||
    normalizedName === "style" ||
    normalizedName === "tabindex" ||
    normalizedName.startsWith("@") ||
    normalizedName.startsWith(":") ||
    normalizedName.startsWith("aria-") ||
    normalizedName.startsWith("data-") ||
    normalizedName.startsWith("on") ||
    normalizedName.startsWith("wire:") ||
    normalizedName.startsWith("x-")
  );
}

function buildWidgetInstanceHtmlResult(widgetHtml = "", full = false) {
  const normalizedWidgetHtml = typeof widgetHtml === "string" ? widgetHtml.trim() : "";

  if (full || !normalizedWidgetHtml) {
    return normalizedWidgetHtml;
  }

  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return normalizedWidgetHtml;
  }

  const template = document.createElement("template");
  template.innerHTML = normalizedWidgetHtml;
  template.content.querySelectorAll("link, meta, script, style").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (shouldStripWidgetHtmlAttribute(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML.trim();
}

function isTruthyRouteParam(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getWidgetRecord(spaceRecord, widgetId) {
  return spaceRecord?.widgets?.[widgetId] || null;
}

function getWidgetDefaultPosition(spaceRecord, widgetId) {
  return normalizeWidgetPosition(getWidgetRecord(spaceRecord, widgetId)?.defaultPosition, DEFAULT_WIDGET_POSITION);
}

function getWidgetDefaultSize(spaceRecord, widgetId) {
  return normalizeWidgetSize(getWidgetRecord(spaceRecord, widgetId)?.defaultSize, DEFAULT_WIDGET_SIZE);
}

function getEffectiveWidgetSize(spaceRecord, widgetId) {
  return normalizeWidgetSize(spaceRecord?.widgetSizes?.[widgetId] || getWidgetDefaultSize(spaceRecord, widgetId), DEFAULT_WIDGET_SIZE);
}

function buildWidgetCatalogDescription(widget) {
  const state = widget?.state || (widget?.minimized ? "minimized" : "expanded");
  const cols = widget?.size?.cols ?? widget?.cols ?? 0;
  const rows = widget?.size?.rows ?? widget?.rows ?? 0;
  const sizeLabel = cols > 0 && rows > 0 ? `${cols}x${rows}` : "";
  const broken = Boolean(widget?.needsRepair ?? widget?.render?.needsRepair);
  const parts = [];

  if (state) {
    parts.push(state);
  }

  if (sizeLabel) {
    parts.push(`${sizeLabel} widget`);
  } else {
    parts.push("widget");
  }

  if (broken) {
    parts.push("currently broken");
  }

  return parts.join(", ");
}

function buildWidgetCatalogEntry(widget) {
  return {
    description: buildWidgetCatalogDescription(widget),
    id: String(widget?.id || ""),
    name: String(widget?.name || formatTitleFromId(widget?.id || "widget"))
  };
}

function normalizeWidgetCatalogTextField(value = "") {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\s*\n+\s*/gu, " ")
    .replace(/[|]/gu, "/")
    .trim();
}

function buildWidgetCatalogTextLine(widget) {
  const entry = buildWidgetCatalogEntry(widget);

  if (!entry.id) {
    return "";
  }

  return [
    entry.id,
    normalizeWidgetCatalogTextField(entry.name),
    normalizeWidgetCatalogTextField(entry.description)
  ].join("|");
}

function buildWidgetCatalogText(widgets = []) {
  const lines = (Array.isArray(widgets) ? widgets : [])
    .map((widget) => buildWidgetCatalogTextLine(widget))
    .filter(Boolean);

  return ["widgets (id|name|description)↓", ...(lines.length ? lines : ["[empty]"])].join("\n");
}

function buildResolvedLayoutInputs(spaceRecord, overrides = {}) {
  const widgetIds = (Array.isArray(overrides.widgetIds) ? overrides.widgetIds : spaceRecord?.widgetIds || []).filter((widgetId) =>
    Boolean(getWidgetRecord(spaceRecord, widgetId))
  );
  const widgetPositions = {};
  const widgetSizes = {};

  widgetIds.forEach((widgetId) => {
    widgetPositions[widgetId] = normalizeWidgetPosition(
      overrides.widgetPositions?.[widgetId] ?? spaceRecord?.widgetPositions?.[widgetId] ?? getWidgetDefaultPosition(spaceRecord, widgetId),
      getWidgetDefaultPosition(spaceRecord, widgetId)
    );
    widgetSizes[widgetId] = normalizeWidgetSize(
      overrides.widgetSizes?.[widgetId] ?? spaceRecord?.widgetSizes?.[widgetId] ?? getWidgetDefaultSize(spaceRecord, widgetId),
      getWidgetDefaultSize(spaceRecord, widgetId)
    );
  });

  return {
    minimizedWidgetIds:
      overrides.minimizedWidgetIds ??
      (Array.isArray(spaceRecord?.minimizedWidgetIds) ? [...spaceRecord.minimizedWidgetIds] : []),
    widgetIds,
    widgetPositions,
    widgetSizes
  };
}

function buildRuntimeWidgetDescriptor(spaceRecord, resolvedLayout, widgetId) {
  const widgetRecord = getWidgetRecord(spaceRecord, widgetId);

  if (!widgetRecord) {
    return null;
  }

  const effectiveSize = getEffectiveWidgetSize(spaceRecord, widgetId);
  const position = normalizeWidgetPosition(
    resolvedLayout?.positions?.[widgetId] ?? getWidgetDefaultPosition(spaceRecord, widgetId),
    getWidgetDefaultPosition(spaceRecord, widgetId)
  );
  const renderedSize = normalizeWidgetSize(
    resolvedLayout?.renderedSizes?.[widgetId] ?? effectiveSize,
    effectiveSize
  );
  const minimized = Boolean(resolvedLayout?.minimizedMap?.[widgetId] ?? spaceRecord?.minimizedWidgetIds?.includes(widgetId));
  const renderCheck = getWidgetRenderCheckForSpace(spaceRecord?.id, widgetId);

  return {
    col: position.col,
    cols: renderedSize.cols,
    description: buildWidgetCatalogDescription({
      minimized,
      needsRepair: renderCheck.needsRepair,
      rows: effectiveSize.rows,
      size: effectiveSize,
      state: minimized ? "minimized" : "expanded"
    }),
    id: widgetId,
    minimized,
    name: widgetRecord.name || formatTitleFromId(widgetId),
    needsRepair: renderCheck.needsRepair,
    path: buildSpaceWidgetFilePath(spaceRecord.id, widgetId),
    position,
    render: renderCheck,
    renderStatus: renderCheck.status,
    renderedSize,
    row: position.row,
    rows: renderedSize.rows,
    size: effectiveSize,
    state: minimized ? "minimized" : "expanded"
  };
}

async function applyAutoWidgetPlacementToRequest(request = {}, targetSpaceId = "") {
  if (!targetSpaceId || hasExplicitWidgetPosition(request)) {
    return request;
  }

  const widgetPreview = previewWidgetRecord({
    ...request,
    name: request.name ?? request.title,
    widgetId: request.widgetId ?? request.id
  });
  const viewportCols = resolveViewportCols();
  let targetSpace = null;
  let resolvedLayout = null;

  if (activeSpacesStore?.currentSpaceId === targetSpaceId && activeSpacesStore.currentSpace) {
    targetSpace = activeSpacesStore.currentSpace;
    resolvedLayout = activeSpacesStore.currentResolvedLayout || activeSpacesStore.resolveCurrentSpaceLayout(targetSpace);
  } else {
    targetSpace = await readSpace(targetSpaceId);
    resolvedLayout = resolveSpaceLayout(buildResolvedLayoutInputs(targetSpace));
  }

  if (!targetSpace || targetSpace.widgetIds.includes(widgetPreview.id)) {
    return request;
  }

  const suggestedPosition = findFirstFitWidgetPlacement({
    existingWidgetPositions: resolvedLayout?.positions || {},
    existingWidgetSizes: resolvedLayout?.renderedSizes || {},
    viewportCols,
    widgetSize: widgetPreview.defaultSize
  });

  return {
    ...request,
    col: suggestedPosition.col,
    position: suggestedPosition,
    row: suggestedPosition.row
  };
}

function createCurrentSpaceRuntime(namespace) {
  const currentSpace = activeSpacesStore?.currentSpace;

  if (!currentSpace) {
    return null;
  }

  return {
    get byId() {
      return Object.fromEntries(this.widgets.map((widget) => [widget.id, widget]));
    },
    get id() {
      return activeSpacesStore?.currentSpace?.id || "";
    },
    get icon() {
      return activeSpacesStore?.currentSpaceIconDraft || "";
    },
    get iconColor() {
      return activeSpacesStore?.currentSpaceIconColorDraft || "";
    },
    get path() {
      return activeSpacesStore?.currentSpace ? buildSpaceRootPath(activeSpacesStore.currentSpace.id) : "";
    },
    get agentInstructions() {
      return activeSpacesStore?.currentSpaceInstructionsDraft || "";
    },
    get specialInstructions() {
      return this.agentInstructions;
    },
    get title() {
      return activeSpacesStore?.currentSpaceTitleDraft || "";
    },
    get updatedAt() {
      return activeSpacesStore?.currentSpace?.updatedAt || "";
    },
    get widgets() {
      const nextSpace = activeSpacesStore?.currentSpace;
      const resolvedLayout = activeSpacesStore?.currentResolvedLayout;

      if (!nextSpace) {
        return [];
      }

      return nextSpace.widgetIds
        .map((widgetId) => buildRuntimeWidgetDescriptor(nextSpace, resolvedLayout, widgetId))
        .filter(Boolean);
    },
    listWidgets() {
      return buildWidgetCatalogText(this.widgets);
    },
    reload() {
      return namespace.reloadCurrentSpace();
    },
    reloadWidget(widgetId) {
      return namespace.reloadWidget({
        spaceId: activeSpacesStore?.currentSpaceId,
        widgetId
      });
    },
    readWidget(widgetName) {
      const spaceId = activeSpacesStore?.currentSpaceId;

      return (async () => {
        const widgetText = await readWidgetFromStorage({
          spaceId,
          widgetName
        });
        const widgetId = extractWidgetIdFromWidgetText(widgetText) || normalizeOptionalWidgetId(widgetName);
        return emitWidgetReadToolResult(widgetText, widgetId);
      })();
    },
    seeWidget(widgetName, full = false) {
      return (async () => {
        const currentRuntimeSpace = activeSpacesStore?.currentSpace;

        if (!currentRuntimeSpace) {
          throw new Error("The spaces view is not currently mounted.");
        }

        const widgetId = resolveWidgetIdFromMountedSpace(currentRuntimeSpace, widgetName);
        const widgetCard = activeSpacesStore?.widgetCards?.[widgetId];

        if (!widgetCard?.renderTarget) {
          throw new Error(`Widget "${widgetId}" is not mounted in the current space.`);
        }

        const widgetHtml = buildWidgetInstanceHtmlResult(widgetCard.renderTarget.innerHTML, Boolean(full));
        return emitWidgetSeeToolResult(widgetHtml, widgetId, Boolean(full));
      })();
    },
    patchWidget(widgetId, options = {}) {
      return namespace.patchWidget({
        ...options,
        spaceId: activeSpacesStore?.currentSpaceId,
        widgetId
      });
    },
    removeWidget(widgetId) {
      return namespace.removeWidget({
        spaceId: activeSpacesStore?.currentSpaceId,
        widgetId
      });
    },
    removeWidgets(widgetIds) {
      return namespace.removeWidgets({
        spaceId: activeSpacesStore?.currentSpaceId,
        widgetIds
      });
    },
    removeAllWidgets() {
      return namespace.removeAllWidgets({
        spaceId: activeSpacesStore?.currentSpaceId
      });
    },
    renderWidget(optionsOrId, cols, rows, renderer) {
      return namespace.renderWidget({
        ...normalizeRenderWidgetRequest(optionsOrId, cols, rows, renderer),
        spaceId: activeSpacesStore?.currentSpaceId
      });
    },
    rearrangeWidgets(widgets) {
      return namespace.rearrangeWidgets({
        spaceId: activeSpacesStore?.currentSpaceId,
        widgets
      });
    },
    repairLayout() {
      return namespace.repairLayout({
        spaceId: activeSpacesStore?.currentSpaceId
      });
    },
    rearrange() {
      if (!activeSpacesStore) {
        throw new Error("The spaces view is not currently mounted.");
      }

      return activeSpacesStore.rearrangeCurrentSpace();
    },
    saveLayout(options = {}) {
      return namespace.saveSpaceLayout({
        ...options,
        id: activeSpacesStore?.currentSpaceId
      });
    },
    saveMeta(options = {}) {
      return namespace.saveSpaceMeta({
        ...options,
        id: activeSpacesStore?.currentSpaceId
      });
    },
    toggleWidgets(widgetIds) {
      return namespace.toggleWidgets({
        spaceId: activeSpacesStore?.currentSpaceId,
        widgetIds
      });
    }
  };
}

function syncSpacesRuntimeState() {
  const runtime = globalThis.space;

  if (!runtime?.spaces) {
    return;
  }

  const items = Array.isArray(activeSpacesStore?.spaceList)
    ? activeSpacesStore.spaceList.map((entry) => ({ ...entry }))
    : Array.isArray(runtime.spaces.items)
      ? runtime.spaces.items.map((entry) => ({ ...entry }))
      : [];
  const byId = Object.fromEntries(items.map((entry) => [entry.id, { ...entry }]));
  const current = createCurrentSpaceRuntime(runtime.spaces);

  runtime.spaces.items = items;
  runtime.spaces.all = items;
  runtime.spaces.byId = byId;
  runtime.spaces.current = current;
  runtime.spaces.currentId = current?.id || "";
  runtime.current = current;
}

function createWidgetPlaceholder(textValue) {
  const root = createElement("div", "spaces-widget-placeholder");
  root.appendChild(createElement("p", "spaces-widget-placeholder-copy", textValue));
  return root;
}

function createGridStateCard(titleValue, bodyValue, tone = "info") {
  const root = createElement("section", `spaces-grid-state is-${tone}`);
  root.appendChild(createElement("h2", "spaces-grid-state-title", titleValue));
  root.appendChild(createElement("p", "spaces-grid-state-copy", bodyValue));
  return root;
}

function createLoadingCanvasState() {
  const root = createElement("section", "spaces-empty-canvas spaces-loading-canvas");
  const content = createElement("div", "spaces-empty-canvas-content spaces-loading-canvas-content");
  const title = createElement("h2", "spaces-empty-canvas-title spaces-loading-canvas-title");

  title.appendChild(createElement("span", "spaces-empty-canvas-line", "Loading space..."));
  content.appendChild(title);
  root.appendChild(content);

  return { root, title };
}

function createEmptyCanvasState(exampleDefinitions = []) {
  const root = createElement("section", "spaces-empty-canvas");
  const content = createElement("div", "spaces-empty-canvas-content");
  const copy = createElement("div", "spaces-empty-canvas-copy");
  const primarySlot = createElement("div", "spaces-empty-canvas-copy-slot spaces-empty-canvas-copy-slot-primary");
  const secondarySlot = createElement("div", "spaces-empty-canvas-copy-slot spaces-empty-canvas-copy-slot-secondary");
  const firstFloater = createElement("div", "spaces-empty-canvas-floater spaces-empty-canvas-floater-intro-primary");
  const secondFloater = createElement("div", "spaces-empty-canvas-floater spaces-empty-canvas-floater-intro-secondary");
  const thirdFloater = createElement("div", "spaces-empty-canvas-floater spaces-empty-canvas-floater-prompt");
  const fourthFloater = createElement("div", "spaces-empty-canvas-floater spaces-empty-canvas-floater-examples-copy");
  const firstText = createElement("p", "spaces-empty-canvas-text spaces-empty-canvas-text-intro-primary", "Just an empty space here");
  const secondText = createElement("p", "spaces-empty-canvas-text spaces-empty-canvas-text-intro-secondary", "for now");
  const thirdText = createElement(
    "p",
    "spaces-empty-canvas-text spaces-empty-canvas-text-prompt",
    "Tell your agent what to create"
  );
  const fourthText = createElement(
    "p",
    "spaces-empty-canvas-text spaces-empty-canvas-text-examples-copy",
    "or try one of the examples above"
  );
  const examples = createElement("div", "spaces-empty-canvas-examples");

  copy.tabIndex = 0;
  copy.setAttribute("role", "button");
  copy.setAttribute("aria-label", "Show all empty space guidance");
  content.dataset.emptyCanvasStage = "boot";
  firstFloater.appendChild(firstText);
  secondFloater.appendChild(secondText);
  thirdFloater.appendChild(thirdText);
  fourthFloater.appendChild(fourthText);
  primarySlot.append(firstFloater, thirdFloater);
  secondarySlot.append(secondFloater, fourthFloater);
  copy.append(primarySlot, secondarySlot);
  exampleDefinitions.forEach((exampleDefinition) => {
    const button = createElement("button", "spaces-empty-canvas-example", exampleDefinition.text);
    button.type = "button";
    button.addEventListener("click", async (event) => {
      button.disabled = true;

      try {
        await exampleDefinition.execute(event);
      } catch (error) {
        logSpacesError("empty canvas example click failed", error, {
          exampleId: exampleDefinition.id,
          promptText: exampleDefinition.text
        });
      } finally {
        button.disabled = false;
      }
    });
    examples.appendChild(button);
  });

  content.append(examples, copy);
  root.appendChild(content);

  return {
    copy,
    content,
    floaters: [firstFloater, secondFloater, thirdFloater, fourthFloater],
    root
  };
}

function startEmptyCanvasSequenceAnimation(elements, motionQuery = null) {
  const stageHost = elements?.content || elements || null;
  const skipTarget = elements?.copy || null;

  if (!stageHost) {
    return () => {};
  }

  const stageSteps = [
    ["intro-primary", EMPTY_SPACE_SEQUENCE_PROFILE.firstLineDelayMs],
    ["intro-secondary", EMPTY_SPACE_SEQUENCE_PROFILE.introGapDelayMs],
    ["swap-gap", EMPTY_SPACE_SEQUENCE_PROFILE.lineSwapGapDelayMs],
    ["prompt", EMPTY_SPACE_SEQUENCE_PROFILE.promptLineDelayMs],
    ["examples-copy", EMPTY_SPACE_SEQUENCE_PROFILE.examplesLineDelayMs],
    ["buttons", EMPTY_SPACE_SEQUENCE_PROFILE.buttonsDelayMs]
  ];
  let stageTimeouts = [];

  const clearTimers = () => {
    stageTimeouts.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    stageTimeouts = [];
  };

  const setStage = (stage) => {
    if (!stageHost.isConnected) {
      return;
    }

    stageHost.dataset.emptyCanvasStage = stage;
  };

  const jumpToFinalStage = () => {
    clearTimers();
    setStage("buttons");
  };

  const start = () => {
    clearTimers();

    if (!stageHost.isConnected) {
      return;
    }

    if (motionQuery?.matches) {
      jumpToFinalStage();
      return;
    }

    let elapsedMs = 0;
    stageSteps.forEach(([stageName, delayMs], index) => {
      elapsedMs += delayMs;
      const timeoutId = window.setTimeout(() => {
        setStage(stageName);
      }, elapsedMs);
      stageTimeouts.push(timeoutId);

      if (index === 0 && delayMs === 0) {
        setStage(stageName);
      }
    });
  };

  const handleMotionPreferenceChange = () => {
    start();
  };
  const handleSkipClick = () => {
    jumpToFinalStage();
  };
  const handleSkipKeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    jumpToFinalStage();
  };

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", handleMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(handleMotionPreferenceChange);
    }
  }

  if (skipTarget) {
    skipTarget.addEventListener("click", handleSkipClick);
    skipTarget.addEventListener("keydown", handleSkipKeydown);
  }

  start();

  return () => {
    clearTimers();

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === "function") {
        motionQuery.removeEventListener("change", handleMotionPreferenceChange);
      } else if (typeof motionQuery.removeListener === "function") {
        motionQuery.removeListener(handleMotionPreferenceChange);
      }
    }

    if (skipTarget) {
      skipTarget.removeEventListener("click", handleSkipClick);
      skipTarget.removeEventListener("keydown", handleSkipKeydown);
    }
  };
}

function combineCleanupFunctions(...cleanups) {
  return () => {
    cleanups.forEach((cleanup) => {
      if (typeof cleanup === "function") {
        cleanup();
      }
    });
  };
}

function applyEmptyCanvasTextPose(element, x, y, rotation) {
  if (!element) {
    return;
  }

  element.style.setProperty("--spaces-empty-text-float-x", `${x.toFixed(1)}px`);
  element.style.setProperty("--spaces-empty-text-float-y", `${y.toFixed(1)}px`);
  element.style.setProperty("--spaces-empty-text-float-rotate", `${rotation.toFixed(1)}deg`);
}

function startEmptyCanvasTextFloatAnimation(elements, motionQuery = null) {
  const floaters = Array.isArray(elements)
    ? elements.filter(Boolean).map((element, index) => ({
      element,
      profile: EMPTY_SPACE_TEXT_FLOAT_PROFILES[index % EMPTY_SPACE_TEXT_FLOAT_PROFILES.length]
    }))
    : [];

  if (!floaters.length) {
    return () => {};
  }

  let frame = 0;
  let startTime = 0;

  const resetPose = () => {
    floaters.forEach(({ element }) => {
      applyEmptyCanvasTextPose(element, 0, 0, 0);
    });
  };

  const step = (timestamp) => {
    const hasConnectedElement = floaters.some(({ element }) => element.isConnected);

    if (!hasConnectedElement) {
      frame = 0;
      return;
    }

    if (motionQuery?.matches) {
      frame = 0;
      startTime = 0;
      resetPose();
      return;
    }

    if (!startTime) {
      startTime = timestamp;
    }

    const elapsed = timestamp - startTime;
    floaters.forEach(({ element, profile }) => {
      if (!element.isConnected) {
        return;
      }

      const orbitAngle = ((elapsed / profile.orbitPeriodMs) * TAU) + profile.phase;
      const rotationAngle = ((elapsed / profile.rotationPeriodMs) * TAU) + (profile.phase * 0.75);

      applyEmptyCanvasTextPose(
        element,
        Math.cos(orbitAngle) * profile.xRadius,
        Math.sin(orbitAngle) * profile.yRadius,
        Math.sin(rotationAngle) * profile.rotationAmplitude
      );
    });

    frame = window.requestAnimationFrame(step);
  };

  const start = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    startTime = 0;
    resetPose();

    if (motionQuery?.matches) {
      return;
    }

    frame = window.requestAnimationFrame(step);
  };

  const handleMotionPreferenceChange = () => {
    start();
  };

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", handleMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(handleMotionPreferenceChange);
    }
  }

  start();

  return () => {
    window.cancelAnimationFrame(frame);
    frame = 0;

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === "function") {
        motionQuery.removeEventListener("change", handleMotionPreferenceChange);
      } else if (typeof motionQuery.removeListener === "function") {
        motionQuery.removeListener(handleMotionPreferenceChange);
      }
    }

    resetPose();
  };
}

function applyFloatingTitlePose(element, x, y, rotation) {
  if (!element) {
    return;
  }

  element.style.setProperty("--spaces-empty-title-float-x", `${x.toFixed(1)}px`);
  element.style.setProperty("--spaces-empty-title-float-y", `${y.toFixed(1)}px`);
  element.style.setProperty("--spaces-empty-title-rotate", `${rotation.toFixed(1)}deg`);
}

function startFloatingTitleAnimation(element, motionQuery = null) {
  if (!element) {
    return () => {};
  }

  let frame = 0;
  let startTime = 0;

  const resetPose = () => {
    applyFloatingTitlePose(element, 0, 0, 0);
  };

  const step = (timestamp) => {
    if (!element.isConnected) {
      frame = 0;
      return;
    }

    if (motionQuery?.matches) {
      frame = 0;
      startTime = 0;
      resetPose();
      return;
    }

    if (!startTime) {
      startTime = timestamp;
    }

    const elapsed = timestamp - startTime;
    const orbitAngle = ((elapsed / EMPTY_SPACE_FLOAT_PROFILE.orbitPeriodMs) * TAU) + 0.45;
    const rotationAngle = ((elapsed / EMPTY_SPACE_FLOAT_PROFILE.rotationPeriodMs) * TAU) + 1.1;

    applyFloatingTitlePose(
      element,
      Math.cos(orbitAngle) * EMPTY_SPACE_FLOAT_PROFILE.xRadius,
      Math.sin(orbitAngle) * EMPTY_SPACE_FLOAT_PROFILE.yRadius,
      Math.sin(rotationAngle) * EMPTY_SPACE_FLOAT_PROFILE.rotationAmplitude
    );

    frame = window.requestAnimationFrame(step);
  };

  const start = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    startTime = 0;
    resetPose();

    if (!element.isConnected || motionQuery?.matches) {
      return;
    }

    frame = window.requestAnimationFrame(step);
  };

  const handleMotionPreferenceChange = () => {
    start();
  };

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", handleMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(handleMotionPreferenceChange);
    }
  }

  start();

  return () => {
    window.cancelAnimationFrame(frame);
    frame = 0;

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === "function") {
        motionQuery.removeEventListener("change", handleMotionPreferenceChange);
      } else if (typeof motionQuery.removeListener === "function") {
        motionQuery.removeListener(handleMotionPreferenceChange);
      }
    }

    resetPose();
  };
}

function playGridFadeIn(gridElement, motionQuery = null) {
  if (!gridElement || motionQuery?.matches) {
    return () => {};
  }

  const cleanup = () => {
    gridElement.classList.remove("is-render-fading");
    gridElement.removeEventListener("animationend", cleanup);
  };

  gridElement.removeEventListener("animationend", cleanup);
  gridElement.classList.remove("is-render-fading");
  void gridElement.offsetWidth;
  gridElement.classList.add("is-render-fading");
  gridElement.addEventListener("animationend", cleanup, { once: true });

  return () => {
    gridElement.classList.remove("is-render-fading");
    gridElement.removeEventListener("animationend", cleanup);
  };
}

function applyWidgetCardSize(cardElement, size) {
  cardElement.style.setProperty("--spaces-widget-cols", String(size.cols));
  cardElement.style.setProperty("--spaces-widget-rows", String(size.rows));
}

function normalizeCanvasBounds(bounds) {
  const minCol = Number.isFinite(bounds?.minCol) ? Math.floor(bounds.minCol) : -GRID_BASE_HALF_COLS;
  const maxCol = Number.isFinite(bounds?.maxCol) ? Math.ceil(bounds.maxCol) : GRID_BASE_HALF_COLS;
  const minRow = Number.isFinite(bounds?.minRow) ? Math.floor(bounds.minRow) : -GRID_BASE_HALF_ROWS;
  const maxRow = Number.isFinite(bounds?.maxRow) ? Math.ceil(bounds.maxRow) : GRID_BASE_HALF_ROWS;

  return {
    colCount: Math.max(1, maxCol - minCol),
    maxCol,
    maxRow,
    minCol,
    minRow,
    rowCount: Math.max(1, maxRow - minRow)
  };
}

function createLogicalRect(position, size) {
  const normalizedPosition = normalizeWidgetPosition(position, DEFAULT_WIDGET_POSITION);
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);

  return {
    bottom: normalizedPosition.row + normalizedSize.rows,
    left: normalizedPosition.col,
    right: normalizedPosition.col + normalizedSize.cols,
    top: normalizedPosition.row
  };
}

function parsePixelValue(value, fallback = 0) {
  const parsedValue = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function resolveCssLength(value, contextElement, fallback = 0) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return fallback;
  }

  if (/^-?\d+(\.\d+)?$/u.test(normalizedValue)) {
    return Number.parseFloat(normalizedValue);
  }

  if (/^-?\d+(\.\d+)?px$/u.test(normalizedValue)) {
    return Number.parseFloat(normalizedValue);
  }

  if (/^-?\d+(\.\d+)?rem$/u.test(normalizedValue)) {
    const rootFontSize = parsePixelValue(window.getComputedStyle(document.documentElement).fontSize, 16);
    return Number.parseFloat(normalizedValue) * rootFontSize;
  }

  if (/^-?\d+(\.\d+)?em$/u.test(normalizedValue)) {
    const elementFontSize = parsePixelValue(window.getComputedStyle(contextElement).fontSize, 16);
    return Number.parseFloat(normalizedValue) * elementFontSize;
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.inlineSize = normalizedValue;
  probe.style.blockSize = "0";
  probe.style.pointerEvents = "none";
  contextElement.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();

  return Number.isFinite(width) && width > 0 ? width : fallback;
}

function resolveElementLineHeight(element) {
  const contextElement = element instanceof Element ? element : document.documentElement;
  const computedStyle = window.getComputedStyle(contextElement);
  const explicitLineHeight = parsePixelValue(computedStyle.lineHeight, 0);

  if (explicitLineHeight > 0) {
    return explicitLineHeight;
  }

  const probe = document.createElement("span");
  probe.textContent = "A\nB";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.whiteSpace = "pre";
  probe.style.margin = "0";
  probe.style.padding = "0";
  probe.style.border = "0";
  probe.style.font = computedStyle.font;
  probe.style.lineHeight = computedStyle.lineHeight;
  contextElement.appendChild(probe);
  const measuredLineHeight = probe.getBoundingClientRect().height / 2;
  probe.remove();

  return measuredLineHeight > 0 ? measuredLineHeight : parsePixelValue(computedStyle.fontSize, 16);
}

function resolveWheelDeltaPixels(event, contextElement, viewportElement) {
  const viewportWidth = Math.max(1, viewportElement?.clientWidth || window.innerWidth || 1);
  const viewportHeight = Math.max(1, viewportElement?.clientHeight || window.innerHeight || 1);

  if (event.deltaMode === 1) {
    const lineHeight = resolveElementLineHeight(contextElement);
    return {
      x: event.deltaX * lineHeight,
      y: event.deltaY * lineHeight
    };
  }

  if (event.deltaMode === 2) {
    return {
      x: event.deltaX * viewportWidth,
      y: event.deltaY * viewportHeight
    };
  }

  return {
    x: event.deltaX,
    y: event.deltaY
  };
}

function getPrimaryWheelAxis(deltaX, deltaY) {
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return "x";
  }

  return "y";
}

function canElementScrollInDirection(element, axis, delta) {
  if (!(element instanceof HTMLElement) || Math.abs(delta) < 0.01) {
    return false;
  }

  const computedStyle = window.getComputedStyle(element);
  const overflowValue = axis === "x" ? computedStyle.overflowX : computedStyle.overflowY;

  if (!/(auto|scroll|overlay)/u.test(overflowValue)) {
    return false;
  }

  if (axis === "x") {
    const maxScrollLeft = element.scrollWidth - element.clientWidth;

    if (maxScrollLeft <= 1) {
      return false;
    }

    return delta < 0
      ? element.scrollLeft > 0
      : element.scrollLeft < (maxScrollLeft - 1);
  }

  const maxScrollTop = element.scrollHeight - element.clientHeight;

  if (maxScrollTop <= 1) {
    return false;
  }

  return delta < 0
    ? element.scrollTop > 0
    : element.scrollTop < (maxScrollTop - 1);
}

function shouldAllowNativeWheelScroll(target, boundaryElement, deltaX, deltaY) {
  if (!(target instanceof Element)) {
    return false;
  }

  const primaryAxis = getPrimaryWheelAxis(deltaX, deltaY);
  const secondaryAxis = primaryAxis === "x" ? "y" : "x";
  const primaryDelta = primaryAxis === "x" ? deltaX : deltaY;
  const secondaryDelta = secondaryAxis === "x" ? deltaX : deltaY;
  let element = target;

  while (element && element !== boundaryElement) {
    if (
      canElementScrollInDirection(element, primaryAxis, primaryDelta) ||
      canElementScrollInDirection(element, secondaryAxis, secondaryDelta)
    ) {
      return true;
    }

    element = element.parentElement;
  }

  return false;
}

function readGridMetrics(gridElement) {
  const computedStyle = window.getComputedStyle(gridElement);
  const columnGap = resolveCssLength(computedStyle.getPropertyValue("--spaces-grid-gap"), gridElement, 16);
  const rowGap = columnGap;
  const rowHeight = resolveCssLength(computedStyle.getPropertyValue("--spaces-grid-row-height"), gridElement, 74);
  const rect = gridElement.getBoundingClientRect();
  const canvasElement = activeSpacesStore?.refs?.canvas || gridElement.parentElement;
  const viewportWidth = Math.max(1, canvasElement?.clientWidth || rect.width);
  const viewportHeight = Math.max(1, canvasElement?.clientHeight || rect.height);
  const paddingLeft = parsePixelValue(computedStyle.paddingLeft, 20);
  const paddingRight = parsePixelValue(computedStyle.paddingRight, 20);
  const paddingTop = parsePixelValue(computedStyle.paddingTop, 20);
  const paddingBottom = parsePixelValue(computedStyle.paddingBottom, 20);
  const colWidth = rowHeight;

  return {
    colStep: colWidth + columnGap,
    columnGap,
    colWidth,
    paddingBlock: Math.max(paddingTop, paddingBottom),
    paddingInline: Math.max(paddingLeft, paddingRight),
    rect,
    rowGap,
    rowHeight,
    rowStep: rowHeight + rowGap,
    viewportHeight,
    viewportWidth
  };
}

function resolveViewportCols(gridElement = activeSpacesStore?.refs?.grid) {
  if (gridElement) {
    const metrics = readGridMetrics(gridElement);

    if (metrics.colStep > 0) {
      return Math.max(1, Math.floor(metrics.viewportWidth / metrics.colStep));
    }
  }

  return Math.max(1, Math.floor((window.innerWidth || 1) / 90));
}

function resolveCanvasBounds(resolvedLayout, metrics) {
  const bounds = {
    maxCol: GRID_BASE_HALF_COLS,
    maxRow: GRID_BASE_HALF_ROWS,
    minCol: -GRID_BASE_HALF_COLS,
    minRow: -GRID_BASE_HALF_ROWS
  };

  Object.entries(resolvedLayout?.positions || {}).forEach(([widgetId, position]) => {
    const renderedSize =
      resolvedLayout?.renderedSizes?.[widgetId] || getRenderedWidgetSize(DEFAULT_WIDGET_SIZE, Boolean(resolvedLayout?.minimizedMap?.[widgetId]));
    const rect = createLogicalRect(position, renderedSize);

    bounds.minCol = Math.min(bounds.minCol, rect.left - GRID_CONTENT_BUFFER_COLS);
    bounds.maxCol = Math.max(bounds.maxCol, rect.right + GRID_CONTENT_BUFFER_COLS);
    bounds.minRow = Math.min(bounds.minRow, rect.top - GRID_CONTENT_BUFFER_ROWS);
    bounds.maxRow = Math.max(bounds.maxRow, rect.bottom + GRID_CONTENT_BUFFER_ROWS);
  });

  const viewportCols = Math.max(1, Math.ceil(metrics.viewportWidth / Math.max(metrics.colStep, 1)));
  const viewportRows = Math.max(1, Math.ceil(metrics.viewportHeight / Math.max(metrics.rowStep, 1)));
  bounds.minCol = Math.min(bounds.minCol, -Math.ceil(viewportCols / 2) - GRID_CONTENT_BUFFER_COLS);
  bounds.maxCol = Math.max(bounds.maxCol, Math.ceil(viewportCols / 2) + GRID_CONTENT_BUFFER_COLS);
  bounds.minRow = Math.min(bounds.minRow, -Math.ceil(viewportRows / 2) - GRID_CONTENT_BUFFER_ROWS);
  bounds.maxRow = Math.max(bounds.maxRow, Math.ceil(viewportRows / 2) + GRID_CONTENT_BUFFER_ROWS);

  return normalizeCanvasBounds(bounds);
}

function getCanvasExtent(count, unitSize, gap, padding) {
  return (padding * 2) + (count * unitSize) + (Math.max(0, count - 1) * gap);
}

function applyGridSurfaceLayout(gridElement, bounds, metrics) {
  gridElement.style.width = `${metrics.viewportWidth}px`;
  gridElement.style.height = `${metrics.viewportHeight}px`;
}

function resolveLogicalContentBounds(resolvedLayout) {
  const bounds = {
    maxCol: 0,
    maxRow: 0,
    minCol: 0,
    minRow: 0
  };
  let hasContent = false;

  Object.entries(resolvedLayout?.positions || {}).forEach(([widgetId, position]) => {
    const renderedSize =
      resolvedLayout?.renderedSizes?.[widgetId] || getRenderedWidgetSize(DEFAULT_WIDGET_SIZE, Boolean(resolvedLayout?.minimizedMap?.[widgetId]));
    const rect = createLogicalRect(position, renderedSize);

    if (!hasContent) {
      bounds.minCol = rect.left;
      bounds.maxCol = rect.right;
      bounds.minRow = rect.top;
      bounds.maxRow = rect.bottom;
      hasContent = true;
      return;
    }

    bounds.minCol = Math.min(bounds.minCol, rect.left);
    bounds.maxCol = Math.max(bounds.maxCol, rect.right);
    bounds.minRow = Math.min(bounds.minRow, rect.top);
    bounds.maxRow = Math.max(bounds.maxRow, rect.bottom);
  });

  return hasContent ? bounds : null;
}

function clampCameraOffsetToContent(cameraOffset, resolvedLayout, metrics) {
  const contentBounds = resolveLogicalContentBounds(resolvedLayout);

  if (!contentBounds) {
    return {
      x: 0,
      y: 0
    };
  }

  const visibleHalfCols = metrics.viewportWidth / (2 * Math.max(metrics.colStep, 1));
  const visibleHalfRows = metrics.viewportHeight / (2 * Math.max(metrics.rowStep, 1));
  const minCenterCol = (contentBounds.minCol - GRID_CAMERA_BUFFER_COLS) + visibleHalfCols;
  const maxCenterCol = (contentBounds.maxCol + GRID_CAMERA_BUFFER_COLS) - visibleHalfCols;
  const minCenterRow = (contentBounds.minRow - GRID_CAMERA_BUFFER_ROWS) + visibleHalfRows;
  const maxCenterRow = (contentBounds.maxRow + GRID_CAMERA_BUFFER_ROWS) - visibleHalfRows;
  const currentCenterCol = -cameraOffset.x / Math.max(metrics.colStep, 1);
  const currentCenterRow = -cameraOffset.y / Math.max(metrics.rowStep, 1);
  const clampedCenterCol = clampNumber(currentCenterCol, minCenterCol, maxCenterCol);
  const clampedCenterRow = clampNumber(currentCenterRow, minCenterRow, maxCenterRow);

  return {
    x: -clampedCenterCol * metrics.colStep,
    y: -clampedCenterRow * metrics.rowStep
  };
}

function getWidgetCardFrame(position, size, bounds, metrics) {
  const normalizedPosition = normalizeWidgetPosition(position, DEFAULT_WIDGET_POSITION);
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);
  const cameraOffset = activeSpacesStore?.cameraOffsetPx || { x: 0, y: 0 };
  const originX = (metrics.viewportWidth / 2) + cameraOffset.x;
  const originY = (metrics.viewportHeight / 2) + cameraOffset.y;

  return {
    height: (normalizedSize.rows * metrics.rowHeight) + (Math.max(0, normalizedSize.rows - 1) * metrics.rowGap),
    left: originX + (normalizedPosition.col * metrics.colStep),
    top: originY + (normalizedPosition.row * metrics.rowStep),
    width: (normalizedSize.cols * metrics.colWidth) + (Math.max(0, normalizedSize.cols - 1) * metrics.columnGap)
  };
}

function applyWidgetCardFrame(cardElement, frame) {
  cardElement.style.left = `${frame.left}px`;
  cardElement.style.top = `${frame.top}px`;
  cardElement.style.width = `${frame.width}px`;
  cardElement.style.height = `${frame.height}px`;
}

function applyWidgetCardLayout(cardElement, position, size, bounds, metrics) {
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);
  applyWidgetCardSize(cardElement, normalizedSize);
  applyWidgetCardFrame(cardElement, getWidgetCardFrame(position, normalizedSize, bounds, metrics));
}

function captureWidgetCardRects(widgetCards) {
  const rects = {};

  Object.entries(widgetCards || {}).forEach(([widgetId, skeleton]) => {
    if (!skeleton?.card?.isConnected) {
      return;
    }

    rects[widgetId] = skeleton.card.getBoundingClientRect();
  });

  return rects;
}

function animateWidgetCardsFromRects(widgetCards, previousRects, motionQuery = null, options = {}) {
  const animateEntering = Boolean(options.animateEntering);

  if ((!previousRects && !animateEntering) || motionQuery?.matches) {
    return;
  }

  Object.entries(widgetCards || {}).forEach(([widgetId, skeleton]) => {
    const previousRect = previousRects?.[widgetId];
    const cardElement = skeleton?.card;

    if (!cardElement?.isConnected) {
      return;
    }

    if (!previousRect) {
      if (!animateEntering) {
        cardElement.style.removeProperty("transition");
        cardElement.style.removeProperty("transform");
        cardElement.style.removeProperty("opacity");
        return;
      }

      cardElement.style.transition = "none";
      cardElement.style.transformOrigin = "center center";
      cardElement.style.opacity = "0";
      cardElement.style.transform = "translateY(10px) scale(0.96)";
      void cardElement.offsetWidth;
      cardElement.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease";
      cardElement.style.opacity = "1";
      cardElement.style.transform = "";

      const cleanup = () => {
        cardElement.style.removeProperty("transition");
        cardElement.style.removeProperty("opacity");
        cardElement.removeEventListener("transitionend", cleanup);
      };

      cardElement.addEventListener("transitionend", cleanup, { once: true });
      return;
    }

    const nextRect = cardElement.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    const scaleX = nextRect.width > 0 ? previousRect.width / nextRect.width : 1;
    const scaleY = nextRect.height > 0 ? previousRect.height / nextRect.height : 1;
    const hasMotion =
      Math.abs(deltaX) > 0.5 ||
      Math.abs(deltaY) > 0.5 ||
      Math.abs(scaleX - 1) > 0.02 ||
      Math.abs(scaleY - 1) > 0.02;

    if (!hasMotion) {
      cardElement.style.removeProperty("transition");
      cardElement.style.removeProperty("transform");
      cardElement.style.removeProperty("opacity");
      return;
    }

    cardElement.style.transition = "none";
    cardElement.style.transformOrigin = "top left";
    cardElement.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
    void cardElement.offsetWidth;
    cardElement.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
    cardElement.style.transform = "";

    const cleanup = () => {
      cardElement.style.removeProperty("transition");
      cardElement.style.removeProperty("opacity");
      cardElement.removeEventListener("transitionend", cleanup);
    };

    cardElement.addEventListener("transitionend", cleanup, { once: true });
  });
}

function updateCanvasScrollForBoundsChange(canvasElement, previousBounds, nextBounds, metrics) {
  return;
}

function getOriginScrollPosition(bounds, metrics) {
  return {
    left: 0,
    top: 0
  };
}

function autoScrollCanvas(canvasElement, event) {
  activeSpacesStore?.nudgeCameraAtViewportEdge(event);
}

function toggleGridOverlay(gridElement, active, metrics = null, cameraOffset = { x: 0, y: 0 }) {
  if (!gridElement) {
    return;
  }

  gridElement.classList.toggle("is-layout-active", Boolean(active));

  if (!active || !metrics) {
    gridElement.style.removeProperty("--spaces-grid-overlay-col-step");
    gridElement.style.removeProperty("--spaces-grid-overlay-row-step");
    gridElement.style.removeProperty("--spaces-grid-overlay-offset-x");
    gridElement.style.removeProperty("--spaces-grid-overlay-offset-y");
    return;
  }

  const offsetX = positiveModulo((metrics.viewportWidth / 2) + cameraOffset.x, metrics.colStep);
  const offsetY = positiveModulo((metrics.viewportHeight / 2) + cameraOffset.y, metrics.rowStep);
  gridElement.style.setProperty("--spaces-grid-overlay-col-step", `${metrics.colStep}px`);
  gridElement.style.setProperty("--spaces-grid-overlay-row-step", `${metrics.rowStep}px`);
  gridElement.style.setProperty("--spaces-grid-overlay-offset-x", `${offsetX}px`);
  gridElement.style.setProperty("--spaces-grid-overlay-offset-y", `${offsetY}px`);
}

function shouldShowGridOverlay(layoutInteraction) {
  return layoutInteraction?.type === "move" || layoutInteraction?.type === "resize";
}

function createWidgetActionButton(className, label, title) {
  const button = createElement("button", className, label);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function getSpaceCardClone(spaceRecord) {
  return {
    ...spaceRecord,
    minimizedWidgetIds: [...spaceRecord.minimizedWidgetIds],
    widgetIds: [...spaceRecord.widgetIds],
    widgetPositions: { ...spaceRecord.widgetPositions },
    widgetSizes: { ...spaceRecord.widgetSizes },
    widgets: Object.fromEntries(
      Object.entries(spaceRecord.widgets || {}).map(([widgetId, widgetRecord]) => [widgetId, { ...widgetRecord }])
    )
  };
}

function buildWidgetHeaderTitle(spaceRecord, widgetId) {
  return getWidgetRecord(spaceRecord, widgetId)?.name || formatTitleFromId(widgetId);
}

function createWidgetContext(spaceRecord, widgetId, size, layoutEntry) {
  const widgetPath = buildSpaceWidgetFilePath(spaceRecord.id, widgetId);
  const widgetRecord = getWidgetRecord(spaceRecord, widgetId);

  return {
    api: globalThis.space.api,
    appFiles: {
      delete: globalThis.space.api.fileDelete.bind(globalThis.space.api),
      info: globalThis.space.api.fileInfo.bind(globalThis.space.api),
      list: globalThis.space.api.fileList.bind(globalThis.space.api),
      read: globalThis.space.api.fileRead.bind(globalThis.space.api),
      write: globalThis.space.api.fileWrite.bind(globalThis.space.api)
    },
    fetchExternal: globalThis.space.fetchExternal?.bind(globalThis.space),
    openSpace: spacesRuntime.openSpace,
    paths: {
      assets: `${buildSpaceRootPath(spaceRecord.id)}assets/`,
      data: `${buildSpaceRootPath(spaceRecord.id)}data/`,
      root: buildSpaceRootPath(spaceRecord.id),
      widget: widgetPath
    },
    reloadSpace: spacesRuntime.reloadCurrentSpace,
    resolveAppUrl,
    router: globalThis.space.router,
    size,
    space: {
      id: spaceRecord.id,
      path: buildSpaceRootPath(spaceRecord.id),
      title: spaceRecord.title,
      updatedAt: spaceRecord.updatedAt
    },
    spaces: globalThis.space.spaces,
    widget: {
      defaultPosition: getWidgetDefaultPosition(spaceRecord, widgetId),
      defaultSize: getWidgetDefaultSize(spaceRecord, widgetId),
      id: widgetId,
      minimized: Boolean(layoutEntry?.minimized),
      name: widgetRecord?.name || formatTitleFromId(widgetId),
      path: widgetPath,
      position: normalizeWidgetPosition(layoutEntry?.position, DEFAULT_WIDGET_POSITION),
      size,
      title: buildWidgetHeaderTitle(spaceRecord, widgetId)
    }
  };
}

function createWidgetCardSkeleton(spaceRecord, widgetId, layoutEntry) {
  const card = createElement("article", "space-card spaces-widget-card");
  const controls = createElement("div", "spaces-widget-card-controls");
  const reloadButton = createWidgetActionButton("spaces-widget-control-button spaces-widget-reload-button", "", "Reload widget");
  const handle = createWidgetActionButton("spaces-widget-drag-handle", "", "Move widget");
  const titleLabel = createElement("span", "spaces-widget-card-title", buildWidgetHeaderTitle(spaceRecord, widgetId));
  const actions = createElement("div", "spaces-widget-card-actions");
  const minimizeButton = createWidgetActionButton(
    "spaces-widget-control-button",
    layoutEntry?.minimized ? "+" : "-",
    layoutEntry?.minimized ? "Restore widget" : "Minimize widget"
  );
  const closeButton = createWidgetActionButton("spaces-widget-control-button", "", "Remove widget");
  const body = createElement("div", "spaces-widget-card-body");
  const renderTarget = createElement("div", "spaces-widget-render-target");
  const resizeHandle = createWidgetActionButton("spaces-widget-resize-handle", "", "Resize widget");
  const reloadIcon = createElement("x-icon", "", "refresh");
  const closeIcon = createElement("x-icon", "", "close");

  renderTarget.setAttribute("data-widget-body", "");
  reloadButton.appendChild(reloadIcon);
  closeButton.appendChild(closeIcon);
  handle.append(titleLabel);
  card.dataset.widgetId = widgetId;
  renderTarget.appendChild(createWidgetPlaceholder("Loading widget..."));
  body.appendChild(renderTarget);
  controls.append(handle, reloadButton, actions);
  actions.append(minimizeButton, closeButton);
  card.append(controls, body, resizeHandle);

  handle.addEventListener("pointerdown", (event) => {
    activeSpacesStore?.beginWidgetMove(event, widgetId);
  });
  reloadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void activeSpacesStore?.reloadWidget(widgetId);
  });
  resizeHandle.addEventListener("pointerdown", (event) => {
    activeSpacesStore?.beginWidgetResize(event, widgetId);
  });
  minimizeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void activeSpacesStore?.toggleWidgetMinimized(widgetId);
  });
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void activeSpacesStore?.closeWidget(widgetId);
  });

  return { body, card, cleanup: null, minimizeButton, reloadButton, renderTarget, titleLabel };
}

function runWidgetCleanup(skeleton) {
  if (typeof skeleton?.cleanup !== "function") {
    skeleton.cleanup = null;
    return;
  }

  try {
    skeleton.cleanup();
  } catch (error) {
    logSpacesError("widget cleanup failed", error, {
      widgetId: skeleton.card?.dataset?.widgetId
    });
  } finally {
    skeleton.cleanup = null;
  }
}

function cleanupWidgetCards(widgetCards) {
  Object.values(widgetCards || {}).forEach((skeleton) => {
    runWidgetCleanup(skeleton);
  });
}

function removeWidgetCard(widgetCards, widgetId) {
  const skeleton = widgetCards?.[widgetId];

  if (!skeleton) {
    return;
  }

  runWidgetCleanup(skeleton);
  skeleton.card?.remove();
  delete widgetCards[widgetId];
}

function syncWidgetCardOrder(gridElement, widgetIds = [], widgetCards = {}) {
  if (!gridElement) {
    return;
  }

  widgetIds.forEach((widgetId) => {
    const cardElement = widgetCards?.[widgetId]?.card;

    if (cardElement) {
      gridElement.appendChild(cardElement);
    }
  });
}

function buildWidgetLayoutEntry(resolvedLayout, widgetId) {
  return {
    minimized: Boolean(resolvedLayout?.minimizedMap?.[widgetId]),
    position: resolvedLayout?.positions?.[widgetId],
    renderedSize: resolvedLayout?.renderedSizes?.[widgetId]
  };
}

function tryCompileRendererMethod(rendererSource) {
  const methodObject = Function(`return ({ ${rendererSource} });`)();

  if (typeof methodObject?.renderer === "function") {
    return methodObject.renderer;
  }

  const functionValues = Object.values(methodObject || {}).filter((value) => typeof value === "function");

  if (functionValues.length === 1) {
    return functionValues[0];
  }

  return null;
}

function compileWidgetRenderer(widgetRecord, widgetId) {
  const rendererSource = normalizeRendererSource(widgetRecord?.rendererSource || "");

  if (!rendererSource) {
    throw new Error(`Widget "${widgetId}" is missing a renderer function.`);
  }

  let compiledRenderer = null;

  try {
    compiledRenderer = Function(`return (${rendererSource});`)();
  } catch (directCompileError) {
    try {
      compiledRenderer = tryCompileRendererMethod(rendererSource);
    } catch {
      throw directCompileError;
    }

    if (!compiledRenderer) {
      throw directCompileError;
    }
  }

  if (typeof compiledRenderer !== "function") {
    throw new Error(`Widget "${widgetId}" renderer must evaluate to a function.`);
  }

  return compiledRenderer;
}

async function renderWidgetCard(spaceRecord, widgetId, skeleton, loadToken, layoutEntry, renderPhase = "render") {
  const widgetRecord = getWidgetRecord(spaceRecord, widgetId);

  if (!widgetRecord) {
    throw new Error(`Widget "${widgetId}" could not be found.`);
  }

  const storedSize = getEffectiveWidgetSize(spaceRecord, widgetId);
  const size = layoutEntry?.renderedSize || getRenderedWidgetSize(storedSize, Boolean(layoutEntry?.minimized));
  const context = createWidgetContext(spaceRecord, widgetId, size, layoutEntry);
  const renderer = compileWidgetRenderer(widgetRecord, widgetId);

  skeleton.card.classList.toggle("is-minimized", Boolean(layoutEntry?.minimized));
  skeleton.minimizeButton.textContent = layoutEntry?.minimized ? "+" : "-";
  skeleton.minimizeButton.title = layoutEntry?.minimized ? "Restore widget" : "Minimize widget";
  skeleton.minimizeButton.setAttribute("aria-label", skeleton.minimizeButton.title);
  skeleton.titleLabel.textContent = buildWidgetHeaderTitle(spaceRecord, widgetId);
  runWidgetCleanup(skeleton);
  skeleton.renderTarget.replaceChildren();

  const rendered = await renderer(skeleton.renderTarget, globalThis.space, context);

  if (loadToken !== activeSpacesStore?.widgetLoadToken) {
    if (typeof rendered === "function") {
      rendered();
      return;
    }

    if (rendered && typeof rendered === "object" && !Array.isArray(rendered) && typeof rendered.cleanup === "function") {
      rendered.cleanup();
    }

    return;
  }

  if (typeof rendered === "function") {
    skeleton.cleanup = rendered;
    activeSpacesStore?.recordWidgetRenderSuccess(widgetId, renderPhase);
    return;
  }

  if (rendered && typeof rendered === "object" && !Array.isArray(rendered) && typeof rendered.cleanup === "function") {
    skeleton.cleanup = rendered.cleanup;

    if (rendered.output !== undefined) {
      renderWidgetOutput(rendered.output, skeleton.renderTarget);
    }

    activeSpacesStore?.recordWidgetRenderSuccess(widgetId, renderPhase);
    return;
  }

  if (rendered !== undefined) {
    renderWidgetOutput(rendered, skeleton.renderTarget);
  }

  activeSpacesStore?.recordWidgetRenderSuccess(widgetId, renderPhase);
}

const spacesModel = {
  cameraOffsetPx: {
    x: 0,
    y: 0
  },
  creatingSpace: false,
  currentCanvasBounds: null,
  currentSpace: null,
  currentSpaceIconColorDraft: "",
  currentSpaceIconDraft: "",
  currentSpaceId: "",
  currentSpaceInstructionsDraft: "",
  currentResolvedLayout: null,
  currentSpaceTitleDraft: "",
  emptyCanvasCleanup: null,
  hasCenteredCurrentSpace: false,
  isConfigPanelOpen: false,
  layoutInteraction: null,
  layoutPersistPromise: Promise.resolve(),
  layoutPointerMoveHandler: null,
  layoutPointerUpHandler: null,
  loaded: false,
  loadingList: false,
  loadingSpace: false,
  motionQuery: null,
  noticeText: "",
  noticeTone: "info",
  canvasPointerDownHandler: null,
  canvasWheelHandler: null,
  renderFadeCleanup: null,
  refs: {},
  savingSpaceMeta: false,
  spaceList: [],
  spaceMetaPersistPromise: null,
  spaceMetaPersistQueued: false,
  spaceMetaPersistTimer: 0,
  viewportResizeHandler: null,
  widgetCards: {},
  widgetErrorCount: 0,
  widgetRenderChecks: {},
  widgetLoadToken: 0,

  mount(refs = {}) {
    this.refs = refs;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.viewportResizeHandler = () => {
      this.handleViewportResize();
    };
    window.addEventListener("resize", this.viewportResizeHandler);
    this.canvasPointerDownHandler = (event) => {
      this.handleCanvasPointerDown(event);
    };
    this.refs.canvas?.addEventListener("pointerdown", this.canvasPointerDownHandler);
    this.canvasWheelHandler = (event) => {
      this.handleCanvasWheel(event);
    };
    this.refs.canvas?.addEventListener("wheel", this.canvasWheelHandler, { passive: false });
    activeSpacesStore = this;
    syncSpacesRuntimeState();
    void this.refreshFromRoute();
  },

  unmount() {
    void this.flushCurrentSpaceMetaSave({
      suppressErrors: true
    });
    this.cleanupEmptyCanvas();
    this.cleanupRenderFade();
    this.cleanupLayoutInteraction({
      restoreLayout: false
    });
    cleanupWidgetCards(this.widgetCards);

    if (activeSpacesStore === this) {
      activeSpacesStore = null;
    }

    this.widgetLoadToken += 1;
    this.clearSpaceMetaPersistTimer();
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.currentCanvasBounds = null;
    this.currentResolvedLayout = null;
    this.currentSpaceIconColorDraft = "";
    this.currentSpaceIconDraft = "";
    this.currentSpaceId = "";
    this.currentSpaceInstructionsDraft = "";
    this.currentSpace = null;
    this.currentSpaceTitleDraft = "";
    this.isConfigPanelOpen = false;
    this.spaceMetaPersistQueued = false;
    this.refs.grid?.replaceChildren();
    this.motionQuery = null;
    this.hasCenteredCurrentSpace = false;

    if (this.viewportResizeHandler) {
      window.removeEventListener("resize", this.viewportResizeHandler);
      this.viewportResizeHandler = null;
    }

    if (this.canvasPointerDownHandler && this.refs.canvas) {
      this.refs.canvas.removeEventListener("pointerdown", this.canvasPointerDownHandler);
      this.canvasPointerDownHandler = null;
    }

    if (this.canvasWheelHandler && this.refs.canvas) {
      this.refs.canvas.removeEventListener("wheel", this.canvasWheelHandler);
      this.canvasWheelHandler = null;
    }

    this.widgetCards = {};
    this.refs = {};
    this.renderFadeCleanup = null;
    syncSpacesRuntimeState();
  },

  get hasCurrentSpace() {
    return Boolean(this.currentSpace);
  },

  get hasSpaces() {
    return this.spaceList.length > 0;
  },

  get isBusy() {
    return this.loadingList || this.loadingSpace || this.creatingSpace || this.savingSpaceMeta;
  },

  get currentSpaceFolderPath() {
    return this.currentSpace ? buildSpaceRootPath(this.currentSpace.id) : "";
  },

  get currentSpaceUpdatedLabel() {
    return this.currentSpace?.updatedAt ? new Date(this.currentSpace.updatedAt).toLocaleString() : "";
  },

  get currentSpaceWidgetCountLabel() {
    const count = this.currentSpace?.widgetIds?.length || 0;
    return `${count} ${count === 1 ? "widget" : "widgets"}`;
  },

  get currentSpaceDisplayIcon() {
    return getSpaceDisplayIcon(this.currentSpaceIconDraft);
  },

  get currentSpaceDisplayIconColor() {
    return getSpaceDisplayIconColor(this.currentSpaceIconColorDraft);
  },

  get currentSpaceDisplayTitle() {
    return getSpaceDisplayTitle(this.currentSpaceTitleDraft);
  },

  get currentSpaceMetaToggleLabel() {
    return this.isConfigPanelOpen ? "Collapse space settings" : "Expand space settings";
  },

  get currentSpaceIconPickerLabel() {
    const iconName = normalizeSpaceIcon(this.currentSpaceIconDraft);

    if (iconName) {
      return `Change space icon (${iconName})`;
    }

    return "Change space icon";
  },

  async goBackToDashboard() {
    if (!globalThis.space.router) {
      return;
    }

    await globalThis.space.router.replaceTo("dashboard", { scrollMode: "auto" });
  },

  get hasPendingCurrentSpaceMetaChanges() {
    if (!this.currentSpace) {
      return false;
    }

    return (
      normalizeSpaceIcon(this.currentSpaceIconDraft) !== normalizeSpaceIcon(this.currentSpace.icon) ||
      normalizeSpaceIconColor(this.currentSpaceIconColorDraft) !== normalizeSpaceIconColor(this.currentSpace.iconColor) ||
      normalizeSpaceTitle(this.currentSpaceTitleDraft) !== normalizeSpaceTitle(this.currentSpace.title) ||
      normalizeSpaceAgentInstructions(this.currentSpaceInstructionsDraft) !==
        normalizeSpaceAgentInstructions(this.currentSpace.agentInstructions ?? this.currentSpace.specialInstructions)
    );
  },

  setNotice(textValue, tone = "info") {
    this.noticeText = String(textValue || "").trim();
    this.noticeTone = tone === "error" ? "error" : "info";
  },

  clearNotice() {
    this.noticeText = "";
    this.noticeTone = "info";
  },

  clearSpaceMetaPersistTimer() {
    if (this.spaceMetaPersistTimer) {
      window.clearTimeout(this.spaceMetaPersistTimer);
      this.spaceMetaPersistTimer = 0;
    }
  },

  toggleConfigPanel() {
    if (this.isConfigPanelOpen) {
      this.closeConfigPanel();
      return;
    }

    this.isConfigPanelOpen = true;
  },

  closeConfigPanel() {
    this.isConfigPanelOpen = false;
    void this.flushCurrentSpaceMetaSave({
      suppressErrors: true
    });
  },

  queueCurrentSpaceMetaSave() {
    if (!this.currentSpaceId || !this.currentSpace) {
      return;
    }

    this.clearSpaceMetaPersistTimer();
    this.spaceMetaPersistTimer = window.setTimeout(() => {
      this.spaceMetaPersistTimer = 0;
      void this.persistCurrentSpaceMeta();
    }, SPACE_META_PERSIST_DELAY_MS);
  },

  async openCurrentSpaceIconSelector() {
    if (!this.currentSpaceId || !this.currentSpace) {
      return null;
    }

    try {
      const selection = await openIconColorSelector({
        allowNone: false,
        color: normalizeSpaceIconColor(this.currentSpaceIconColorDraft),
        defaultColor: "",
        defaultIcon: "",
        defaultPreviewColor: DEFAULT_SPACE_ICON_COLOR,
        defaultPreviewIcon: DEFAULT_SPACE_ICON,
        icon: normalizeSpaceIcon(this.currentSpaceIconDraft),
        resetLabel: "Use default icon"
      });

      if (!selection) {
        return null;
      }

      const nextIcon = normalizeSpaceIcon(selection.icon);
      const nextColor = normalizeSpaceIconColor(selection.color);
      const currentIcon = normalizeSpaceIcon(this.currentSpaceIconDraft);
      const currentColor = normalizeSpaceIconColor(this.currentSpaceIconColorDraft);

      if (nextIcon === currentIcon && nextColor === currentColor) {
        return this.currentSpace;
      }

      this.currentSpaceIconDraft = nextIcon;
      this.currentSpaceIconColorDraft = nextColor;
      await this.flushCurrentSpaceMetaSave({
        suppressErrors: true
      });
      return this.currentSpace;
    } catch (error) {
      logSpacesError("openCurrentSpaceIconSelector failed", error, {
        spaceId: this.currentSpaceId
      });
      this.setNotice(formatErrorMessage(error, "Unable to open the icon selector."), "error");
      return null;
    }
  },

  updateSpaceListEntry(spaceRecord) {
    if (!spaceRecord?.id) {
      return;
    }

    const nextUpdatedAtLabel = spaceRecord.updatedAt ? new Date(spaceRecord.updatedAt).toLocaleString() : "Unknown update time";

    this.spaceList = this.spaceList.map((entry) =>
      entry?.id !== spaceRecord.id
        ? entry
        : {
            ...entry,
            displayIcon: getSpaceDisplayIcon(spaceRecord),
            displayIconColor: getSpaceDisplayIconColor(spaceRecord),
            displayTitle: getSpaceDisplayTitle(spaceRecord),
            agentInstructions: spaceRecord.agentInstructions || spaceRecord.specialInstructions || "",
            icon: spaceRecord.icon,
            iconColor: spaceRecord.iconColor,
            specialInstructions: spaceRecord.agentInstructions || spaceRecord.specialInstructions || "",
            title: spaceRecord.title,
            updatedAt: spaceRecord.updatedAt,
            updatedAtLabel: nextUpdatedAtLabel
        }
    );
  },

  applyCurrentSpaceSnapshot(spaceRecord, options = {}) {
    if (!spaceRecord?.id) {
      return;
    }

    this.currentSpace = spaceRecord;
    this.currentSpaceIconColorDraft = spaceRecord.iconColor || "";
    this.currentSpaceIconDraft = spaceRecord.icon || "";
    this.currentSpaceId = spaceRecord.id;
    this.currentSpaceInstructionsDraft = spaceRecord.agentInstructions || spaceRecord.specialInstructions || "";
    this.currentSpaceTitleDraft = spaceRecord.title;

    if (options.cameraOffset && typeof options.cameraOffset === "object") {
      this.cameraOffsetPx = {
        x: Number(options.cameraOffset.x) || 0,
        y: Number(options.cameraOffset.y) || 0
      };
    }

    this.updateSpaceListEntry(spaceRecord);
    syncSpacesRuntimeState();
  },

  async persistCurrentSpaceMeta() {
    if (!this.currentSpaceId || !this.currentSpace || !this.hasPendingCurrentSpaceMetaChanges) {
      return this.currentSpace;
    }

    if (this.spaceMetaPersistPromise) {
      this.spaceMetaPersistQueued = true;
      return this.spaceMetaPersistPromise;
    }

    const targetSpaceId = this.currentSpaceId;
    const normalizedAgentInstructions = normalizeSpaceAgentInstructions(this.currentSpaceInstructionsDraft);
    const normalizedIcon = normalizeSpaceIcon(this.currentSpaceIconDraft);
    const normalizedIconColor = normalizeSpaceIconColor(this.currentSpaceIconColorDraft);
    const normalizedTitle = normalizeSpaceTitle(this.currentSpaceTitleDraft);
    const payload = {
      agentInstructions: normalizedAgentInstructions,
      id: targetSpaceId,
      icon: normalizedIcon,
      iconColor: normalizedIconColor,
      title: normalizedTitle
    };

    this.savingSpaceMeta = true;
    this.spaceMetaPersistPromise = (async () => {
      try {
        const savedSpace = await saveSpaceMeta(payload);

        if (this.currentSpaceId === targetSpaceId && this.currentSpace) {
          const nextAgentInstructions = savedSpace.agentInstructions || savedSpace.specialInstructions || "";
          const shouldSyncAgentInstructionsDraft =
            normalizeSpaceAgentInstructions(this.currentSpaceInstructionsDraft) === normalizedAgentInstructions;
          const shouldSyncIconDraft = normalizeSpaceIcon(this.currentSpaceIconDraft) === normalizedIcon;
          const shouldSyncIconColorDraft = normalizeSpaceIconColor(this.currentSpaceIconColorDraft) === normalizedIconColor;
          const shouldSyncTitleDraft = normalizeSpaceTitle(this.currentSpaceTitleDraft) === normalizedTitle;

          this.currentSpace = {
            ...this.currentSpace,
            agentInstructions: nextAgentInstructions,
            icon: savedSpace.icon,
            iconColor: savedSpace.iconColor,
            specialInstructions: nextAgentInstructions,
            title: savedSpace.title,
            updatedAt: savedSpace.updatedAt
          };

          if (shouldSyncIconColorDraft) {
            this.currentSpaceIconColorDraft = savedSpace.iconColor || "";
          }

          if (shouldSyncIconDraft) {
            this.currentSpaceIconDraft = savedSpace.icon || "";
          }

          if (shouldSyncTitleDraft) {
            this.currentSpaceTitleDraft = savedSpace.title;
          }

          if (shouldSyncAgentInstructionsDraft) {
            this.currentSpaceInstructionsDraft = nextAgentInstructions;
          }

          this.updateSpaceListEntry(this.currentSpace);
          syncSpacesRuntimeState();
        }

        return savedSpace;
      } catch (error) {
        logSpacesError("persistCurrentSpaceMeta failed", error, {
          spaceId: targetSpaceId
        });
        this.setNotice(formatErrorMessage(error, "Unable to save the current space settings."), "error");
        throw error;
      } finally {
        this.savingSpaceMeta = false;
        this.spaceMetaPersistPromise = null;
        const shouldPersistAgain = this.spaceMetaPersistQueued || this.hasPendingCurrentSpaceMetaChanges;
        this.spaceMetaPersistQueued = false;

        if (shouldPersistAgain && this.currentSpaceId) {
          void this.persistCurrentSpaceMeta();
        }
      }
    })();

    return this.spaceMetaPersistPromise;
  },

  async flushCurrentSpaceMetaSave(options = {}) {
    this.clearSpaceMetaPersistTimer();

    if (!this.hasPendingCurrentSpaceMetaChanges) {
      return this.currentSpace;
    }

    try {
      return await this.persistCurrentSpaceMeta();
    } catch (error) {
      if (options.suppressErrors === true) {
        return null;
      }

      throw error;
    }
  },

  cleanupRenderFade() {
    if (typeof this.renderFadeCleanup === "function") {
      this.renderFadeCleanup();
    }

    this.renderFadeCleanup = null;
  },

  cleanupEmptyCanvas() {
    if (typeof this.emptyCanvasCleanup === "function") {
      this.emptyCanvasCleanup();
    }

    this.emptyCanvasCleanup = null;
  },

  resolveCurrentSpaceLayout(spaceRecord = this.currentSpace, overrides = {}) {
    if (!spaceRecord) {
      return null;
    }

    const layoutInputs = buildResolvedLayoutInputs(spaceRecord, {
      minimizedWidgetIds: overrides.minimizedWidgetIds,
      widgetIds: overrides.widgetIds,
      widgetPositions: overrides.widgetPositions,
      widgetSizes: overrides.widgetSizes
    });

    return resolveSpaceLayout({
      anchorMinimized: overrides.anchorMinimized,
      anchorPosition: overrides.anchorPosition,
      anchorSize: overrides.anchorSize,
      anchorWidgetId: overrides.anchorWidgetId,
      minimizedWidgetIds: layoutInputs.minimizedWidgetIds,
      widgetIds: layoutInputs.widgetIds,
      widgetPositions: layoutInputs.widgetPositions,
      widgetSizes: layoutInputs.widgetSizes
    });
  },

  centerCanvasOnOrigin(force = false) {
    if (!this.refs.grid) {
      return;
    }

    if (this.hasCenteredCurrentSpace && !force && this.cameraOffsetPx.x === 0 && this.cameraOffsetPx.y === 0) {
      return;
    }

    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.hasCenteredCurrentSpace = true;
  },

  applyResolvedLayoutToCards(resolvedLayout, spaceRecord = this.currentSpace, options = {}) {
    if (!resolvedLayout || !spaceRecord || !this.refs.grid) {
      return;
    }

    const metrics = readGridMetrics(this.refs.grid);
    const previousRects = options.previousRects || null;

    if (options.centerOrigin) {
      this.centerCanvasOnOrigin(true);
    }

    this.cameraOffsetPx = clampCameraOffsetToContent(this.cameraOffsetPx, resolvedLayout, metrics);

    applyGridSurfaceLayout(this.refs.grid, null, metrics);
    this.currentResolvedLayout = resolvedLayout;
    this.currentCanvasBounds = null;
    spaceRecord.widgetPositions = { ...resolvedLayout.positions };
    spaceRecord.minimizedWidgetIds = spaceRecord.widgetIds.filter((widgetId) => resolvedLayout.minimizedMap[widgetId]);

    spaceRecord.widgetIds.forEach((widgetId) => {
      const skeleton = this.widgetCards[widgetId];

      if (!skeleton) {
        return;
      }

      const renderedSize = resolvedLayout.renderedSizes[widgetId] || getRenderedWidgetSize(getEffectiveWidgetSize(spaceRecord, widgetId));
      applyWidgetCardLayout(skeleton.card, resolvedLayout.positions[widgetId], renderedSize, null, metrics);
      skeleton.card.classList.toggle("is-minimized", Boolean(resolvedLayout.minimizedMap[widgetId]));
      skeleton.minimizeButton.textContent = resolvedLayout.minimizedMap[widgetId] ? "+" : "-";
      skeleton.minimizeButton.title = resolvedLayout.minimizedMap[widgetId] ? "Restore widget" : "Minimize widget";
      skeleton.minimizeButton.setAttribute("aria-label", skeleton.minimizeButton.title);
      skeleton.titleLabel.textContent = buildWidgetHeaderTitle(spaceRecord, widgetId);
      skeleton.card.style.removeProperty("transition");
      skeleton.card.style.removeProperty("transform");
    });

    if (!options.skipAnimation) {
      animateWidgetCardsFromRects(this.widgetCards, previousRects, this.motionQuery, {
        animateEntering: options.animateEntering
      });
    }

    toggleGridOverlay(this.refs.grid, shouldShowGridOverlay(this.layoutInteraction), metrics, this.cameraOffsetPx);
    syncSpacesRuntimeState();
  },

  cleanupLayoutInteraction(options = {}) {
    const interaction = this.layoutInteraction;

    if (this.layoutPointerMoveHandler) {
      window.removeEventListener("pointermove", this.layoutPointerMoveHandler);
      this.layoutPointerMoveHandler = null;
    }

    if (this.layoutPointerUpHandler) {
      window.removeEventListener("pointerup", this.layoutPointerUpHandler);
      window.removeEventListener("pointercancel", this.layoutPointerUpHandler);
      this.layoutPointerUpHandler = null;
    }

    toggleGridOverlay(this.refs.grid, false);
    this.refs.canvas?.classList.remove("is-panning");

    if (interaction?.widgetId && this.widgetCards[interaction.widgetId]) {
      this.widgetCards[interaction.widgetId].card.classList.remove("is-layout-active");

      if (options.clearPreview !== false) {
        this.widgetCards[interaction.widgetId].card.style.removeProperty("transform");
      }
    }

    this.layoutInteraction = null;

    if (options.restoreLayout !== false && this.currentResolvedLayout && this.currentSpace) {
      this.applyResolvedLayoutToCards(this.currentResolvedLayout, this.currentSpace);
    }
  },

  handleCanvasPointerDown(event) {
    if (event.button !== 0 || !this.currentSpace?.widgetIds?.length) {
      return;
    }

    if (event.target?.closest(".spaces-widget-card, .spaces-empty-canvas-example, .spaces-canvas-debug-button")) {
      return;
    }

    if (event.target !== this.refs.canvas && event.target !== this.refs.grid) {
      return;
    }

    this.beginCanvasPan(event);
  },

  panCameraByPixels(deltaX, deltaY, options = {}) {
    if (!this.currentResolvedLayout || !this.currentSpace || !this.refs.grid) {
      return false;
    }

    if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
      return false;
    }

    const metrics = readGridMetrics(this.refs.grid);
    const nextCameraOffset = clampCameraOffsetToContent(
      {
        x: this.cameraOffsetPx.x + deltaX,
        y: this.cameraOffsetPx.y + deltaY
      },
      this.currentResolvedLayout,
      metrics
    );
    const changed =
      Math.abs(nextCameraOffset.x - this.cameraOffsetPx.x) > 0.01 ||
      Math.abs(nextCameraOffset.y - this.cameraOffsetPx.y) > 0.01;

    this.cameraOffsetPx = nextCameraOffset;

    if (changed || options.forceRender) {
      this.applyResolvedLayoutToCards(this.currentResolvedLayout, this.currentSpace, {
        skipAnimation: true
      });
    }

    return changed;
  },

  handleCanvasWheel(event) {
    if (!this.currentSpace?.widgetIds?.length || !this.refs.canvas || !this.refs.grid) {
      return;
    }

    if (event.ctrlKey || this.layoutInteraction) {
      return;
    }

    const delta = resolveWheelDeltaPixels(event, this.refs.canvas, this.refs.canvas);

    if (shouldAllowNativeWheelScroll(event.target, this.refs.canvas, delta.x, delta.y)) {
      return;
    }

    event.preventDefault();
    this.panCameraByPixels(-delta.x, -delta.y, {
      forceRender: true
    });
  },

  beginCanvasPan(event) {
    if (!this.refs.canvas || !this.refs.grid) {
      return;
    }

    event.preventDefault();
    this.cleanupLayoutInteraction();

    this.refs.canvas.classList.add("is-panning");

    this.layoutInteraction = {
      pointerId: event.pointerId,
      startCameraOffset: { ...this.cameraOffsetPx },
      startX: event.clientX,
      startY: event.clientY,
      type: "pan"
    };

    this.layoutPointerMoveHandler = (nextEvent) => {
      this.handleLayoutPointerMove(nextEvent);
    };
    this.layoutPointerUpHandler = (nextEvent) => {
      void this.handleLayoutPointerUp(nextEvent);
    };
    window.addEventListener("pointermove", this.layoutPointerMoveHandler);
    window.addEventListener("pointerup", this.layoutPointerUpHandler);
    window.addEventListener("pointercancel", this.layoutPointerUpHandler);
  },

  nudgeCameraAtViewportEdge(event) {
    if (!this.refs.canvas || !this.refs.grid) {
      return;
    }

    const rect = this.refs.canvas.getBoundingClientRect();
    const computeDelta = (distancePastEdge) => {
      const ratio = Math.min(1, Math.max(0, distancePastEdge / GRID_EDGE_SCROLL_THRESHOLD));
      return Math.max(0, Math.round(ratio * ratio * GRID_EDGE_SCROLL_SPEED));
    };
    let deltaX = 0;
    let deltaY = 0;

    if (event.clientX < rect.left + GRID_EDGE_SCROLL_THRESHOLD) {
      deltaX = computeDelta(rect.left + GRID_EDGE_SCROLL_THRESHOLD - event.clientX);
    } else if (event.clientX > rect.right - GRID_EDGE_SCROLL_THRESHOLD) {
      deltaX = -computeDelta(event.clientX - (rect.right - GRID_EDGE_SCROLL_THRESHOLD));
    }

    if (event.clientY < rect.top + GRID_EDGE_SCROLL_THRESHOLD) {
      deltaY = computeDelta(rect.top + GRID_EDGE_SCROLL_THRESHOLD - event.clientY);
    } else if (event.clientY > rect.bottom - GRID_EDGE_SCROLL_THRESHOLD) {
      deltaY = -computeDelta(event.clientY - (rect.bottom - GRID_EDGE_SCROLL_THRESHOLD));
    }

    if (!deltaX && !deltaY) {
      return;
    }
    this.panCameraByPixels(deltaX, deltaY);
  },

  handleViewportResize() {
    if (!this.currentResolvedLayout || !this.currentSpace || !this.refs.grid) {
      return;
    }

    this.applyResolvedLayoutToCards(this.currentResolvedLayout, this.currentSpace, {
      skipAnimation: true
    });
  },

  beginWidgetMove(event, widgetId) {
    if (event.button !== 0 || !this.currentSpace || !this.refs.grid) {
      return;
    }

    const resolvedLayout = this.currentResolvedLayout || this.resolveCurrentSpaceLayout();
    const layoutPosition = resolvedLayout?.positions?.[widgetId];
    const layoutSize = resolvedLayout?.renderedSizes?.[widgetId];

    if (!layoutPosition || !layoutSize) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.cleanupLayoutInteraction();

    const gridMetrics = readGridMetrics(this.refs.grid);
    const skeleton = this.widgetCards[widgetId];

    if (!skeleton) {
      return;
    }

    skeleton.card.classList.add("is-layout-active");
    skeleton.card.style.removeProperty("transition");
    toggleGridOverlay(this.refs.grid, true, gridMetrics, this.cameraOffsetPx);

    this.layoutInteraction = {
      gridMetrics,
      originPosition: layoutPosition,
      pointerId: event.pointerId,
      previewPosition: layoutPosition,
      renderedSize: layoutSize,
      startCameraOffset: { ...this.cameraOffsetPx },
      startX: event.clientX,
      startY: event.clientY,
      type: "move",
      widgetId
    };

    this.layoutPointerMoveHandler = (nextEvent) => {
      this.handleLayoutPointerMove(nextEvent);
    };
    this.layoutPointerUpHandler = (nextEvent) => {
      void this.handleLayoutPointerUp(nextEvent);
    };
    window.addEventListener("pointermove", this.layoutPointerMoveHandler);
    window.addEventListener("pointerup", this.layoutPointerUpHandler);
    window.addEventListener("pointercancel", this.layoutPointerUpHandler);
  },

  beginWidgetResize(event, widgetId) {
    if (event.button !== 0 || !this.currentSpace || !this.refs.grid || this.currentSpace.minimizedWidgetIds.includes(widgetId)) {
      return;
    }

    const resolvedLayout = this.currentResolvedLayout || this.resolveCurrentSpaceLayout();
    const layoutPosition = resolvedLayout?.positions?.[widgetId];
    const storedSize = getEffectiveWidgetSize(this.currentSpace, widgetId);

    if (!layoutPosition || !storedSize) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.cleanupLayoutInteraction();

    const gridMetrics = readGridMetrics(this.refs.grid);
    const skeleton = this.widgetCards[widgetId];

    if (!skeleton) {
      return;
    }

    skeleton.card.classList.add("is-layout-active");
    skeleton.card.style.removeProperty("transition");
    toggleGridOverlay(this.refs.grid, true, gridMetrics, this.cameraOffsetPx);

    const originFrame = getWidgetCardFrame(layoutPosition, storedSize, this.currentCanvasBounds, gridMetrics);

    this.layoutInteraction = {
      gridMetrics,
      originFrame,
      originPosition: layoutPosition,
      originSize: normalizeWidgetSize(storedSize, DEFAULT_WIDGET_SIZE),
      pointerId: event.pointerId,
      previewSize: normalizeWidgetSize(storedSize, DEFAULT_WIDGET_SIZE),
      startCameraOffset: { ...this.cameraOffsetPx },
      startX: event.clientX,
      startY: event.clientY,
      type: "resize",
      widgetId
    };

    this.layoutPointerMoveHandler = (nextEvent) => {
      this.handleLayoutPointerMove(nextEvent);
    };
    this.layoutPointerUpHandler = (nextEvent) => {
      void this.handleLayoutPointerUp(nextEvent);
    };
    window.addEventListener("pointermove", this.layoutPointerMoveHandler);
    window.addEventListener("pointerup", this.layoutPointerUpHandler);
    window.addEventListener("pointercancel", this.layoutPointerUpHandler);
  },

  handleLayoutPointerMove(event) {
    const interaction = this.layoutInteraction;

    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }

    event.preventDefault();

    if (interaction.type === "pan") {
      this.panCameraByPixels(
        (interaction.startCameraOffset.x + (event.clientX - interaction.startX)) - this.cameraOffsetPx.x,
        (interaction.startCameraOffset.y + (event.clientY - interaction.startY)) - this.cameraOffsetPx.y
      );
      return;
    }

    autoScrollCanvas(this.refs.canvas, event);
    const skeleton = this.widgetCards[interaction.widgetId];

    if (!skeleton) {
      return;
    }

    const cameraDeltaX = this.cameraOffsetPx.x - interaction.startCameraOffset.x;
    const cameraDeltaY = this.cameraOffsetPx.y - interaction.startCameraOffset.y;
    const deltaX = (event.clientX - interaction.startX) - cameraDeltaX;
    const deltaY = (event.clientY - interaction.startY) - cameraDeltaY;

    if (interaction.type === "move") {
      const previewPosition = clampWidgetPosition(
        {
          col: interaction.originPosition.col + Math.round(deltaX / Math.max(interaction.gridMetrics.colStep, 1)),
          row: interaction.originPosition.row + Math.round(deltaY / Math.max(interaction.gridMetrics.rowStep, 1))
        },
        interaction.renderedSize
      );

      interaction.previewPosition = previewPosition;
      skeleton.card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      return;
    }

    const minWidth = interaction.gridMetrics.colWidth;
    const minHeight = interaction.gridMetrics.rowHeight;
    const maxWidth = (MAX_WIDGET_COLS * interaction.gridMetrics.colWidth) + (Math.max(0, MAX_WIDGET_COLS - 1) * interaction.gridMetrics.columnGap);
    const maxHeight = (MAX_WIDGET_ROWS * interaction.gridMetrics.rowHeight) + (Math.max(0, MAX_WIDGET_ROWS - 1) * interaction.gridMetrics.rowGap);
    const previewWidth = Math.min(maxWidth, Math.max(minWidth, interaction.originFrame.width + deltaX));
    const previewHeight = Math.min(maxHeight, Math.max(minHeight, interaction.originFrame.height + deltaY));
    const previewSize = normalizeWidgetSize(
      {
        cols: Math.min(MAX_WIDGET_COLS, Math.max(1, Math.round((previewWidth + interaction.gridMetrics.columnGap) / Math.max(interaction.gridMetrics.colStep, 1)))),
        rows: Math.min(MAX_WIDGET_ROWS, Math.max(1, Math.round((previewHeight + interaction.gridMetrics.rowGap) / Math.max(interaction.gridMetrics.rowStep, 1))))
      },
      interaction.originSize
    );

    interaction.previewSize = previewSize;
    skeleton.card.style.width = `${previewWidth}px`;
    skeleton.card.style.height = `${previewHeight}px`;
  },

  async handleLayoutPointerUp(event) {
    const interaction = this.layoutInteraction;

    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }

    if (interaction.type === "pan") {
      this.cleanupLayoutInteraction({
        restoreLayout: false
      });
      return;
    }

    const widgetId = interaction.widgetId;
    const positionChanged =
      interaction.type === "move" &&
      (interaction.previewPosition.col !== interaction.originPosition.col ||
        interaction.previewPosition.row !== interaction.originPosition.row);
    const sizeChanged =
      interaction.type === "resize" &&
      (interaction.previewSize.cols !== interaction.originSize.cols ||
        interaction.previewSize.rows !== interaction.originSize.rows);

    if (positionChanged) {
      const previousRects = captureWidgetCardRects(this.widgetCards);
      this.cleanupLayoutInteraction({
        clearPreview: false,
        restoreLayout: false
      });
      await this.commitWidgetLayout(widgetId, {
        position: interaction.previewPosition
      }, {
        previousRects
      });
      return;
    }

    if (sizeChanged) {
      const previousRects = captureWidgetCardRects(this.widgetCards);
      this.cleanupLayoutInteraction({
        clearPreview: false,
        restoreLayout: false
      });
      await this.commitWidgetLayout(widgetId, {
        size: interaction.previewSize
      }, {
        previousRects
      });
      return;
    }

    this.cleanupLayoutInteraction();
  },

  async commitWidgetLayout(widgetId, changes = {}, options = {}) {
    if (!this.currentSpace) {
      return;
    }

    const nextSpace = getSpaceCardClone(this.currentSpace);
    const previousRects = options.previousRects || captureWidgetCardRects(this.widgetCards);

    if (changes.position !== undefined) {
      nextSpace.widgetPositions[widgetId] = normalizeWidgetPosition(
        changes.position,
        nextSpace.widgetPositions[widgetId] || getWidgetDefaultPosition(nextSpace, widgetId)
      );
    }

    if (changes.size !== undefined) {
      nextSpace.widgetSizes[widgetId] = normalizeWidgetSize(
        changes.size,
        nextSpace.widgetSizes[widgetId] || getEffectiveWidgetSize(nextSpace, widgetId)
      );
    }

    if (changes.minimized !== undefined) {
      const nextMinimized = new Set(nextSpace.minimizedWidgetIds);

      if (changes.minimized) {
        nextMinimized.add(widgetId);
      } else {
        nextMinimized.delete(widgetId);
      }

      nextSpace.minimizedWidgetIds = [...nextMinimized];
    }

    const resolvedLayout = this.resolveCurrentSpaceLayout(nextSpace, {
      anchorMinimized: changes.minimized,
      anchorPosition: changes.position,
      anchorSize: changes.size,
      anchorWidgetId: widgetId,
      minimizedWidgetIds: nextSpace.minimizedWidgetIds,
      widgetPositions: nextSpace.widgetPositions,
      widgetSizes: nextSpace.widgetSizes
    });

    nextSpace.widgetPositions = { ...resolvedLayout.positions };
    nextSpace.minimizedWidgetIds = nextSpace.widgetIds.filter((entry) => resolvedLayout.minimizedMap[entry]);
    this.currentSpace = nextSpace;
    this.applyResolvedLayoutToCards(resolvedLayout, nextSpace, {
      previousRects
    });
    void this.persistLayoutSnapshot(nextSpace);
  },

  persistLayoutSnapshot(spaceSnapshot) {
    const snapshot = getSpaceCardClone(spaceSnapshot);
    const enqueue = this.layoutPersistPromise
      .catch(() => {})
      .then(async () => {
        const savedSpace = await saveSpaceLayout({
          id: snapshot.id,
          minimizedWidgetIds: snapshot.minimizedWidgetIds,
          widgetIds: snapshot.widgetIds,
          widgetPositions: snapshot.widgetPositions,
          widgetSizes: snapshot.widgetSizes
        });

        if (this.currentSpace?.id === savedSpace.id) {
          this.currentSpace.updatedAt = savedSpace.updatedAt;
          await this.loadSpacesList();
        }
      })
      .catch((error) => {
        logSpacesError("persistLayoutSnapshot failed", error, {
          spaceId: snapshot.id
        });
        this.setNotice(formatErrorMessage(error, "Unable to persist widget layout."), "error");

        if (this.currentSpace?.id === snapshot.id) {
          void this.loadCurrentSpace(snapshot.id);
        }
      });

    this.layoutPersistPromise = enqueue;
    return enqueue;
  },

  async toggleWidgetMinimized(widgetId) {
    if (!this.currentSpace) {
      return;
    }

    const isMinimized = this.currentSpace.minimizedWidgetIds.includes(widgetId);
    await this.commitWidgetLayout(widgetId, {
      minimized: !isMinimized
    });
  },

  async closeWidget(widgetId) {
    if (!this.currentSpace) {
      return;
    }

    try {
      await removeWidget({
        spaceId: this.currentSpace.id,
        widgetId
      });
      await this.handleExternalMutation(this.currentSpace.id);
    } catch (error) {
      logSpacesError("closeWidget failed", error, {
        spaceId: this.currentSpace.id,
        widgetId
      });
      this.setNotice(formatErrorMessage(error, `Unable to remove widget "${widgetId}".`), "error");
    }
  },

  async reloadWidget(widgetId, options = {}) {
    if (!this.currentSpace || !this.refs.grid) {
      return;
    }

    const skeleton = this.widgetCards[widgetId];
    const widgetRecord = getWidgetRecord(this.currentSpace, widgetId);

    if (!skeleton || !widgetRecord) {
      throw new Error(`Widget "${widgetId}" was not found in the current space.`);
    }

    const resolvedLayout = this.currentResolvedLayout || this.resolveCurrentSpaceLayout(this.currentSpace);
    const layoutEntry = {
      minimized: Boolean(resolvedLayout?.minimizedMap?.[widgetId]),
      position: resolvedLayout?.positions?.[widgetId],
      renderedSize: resolvedLayout?.renderedSizes?.[widgetId]
    };
    const loadToken = this.widgetLoadToken;

    skeleton.card.classList.remove("is-error");
    skeleton.renderTarget.replaceChildren(createWidgetPlaceholder("Reloading widget..."));

    try {
      await renderWidgetCard(this.currentSpace, widgetId, skeleton, loadToken, layoutEntry, "reload");
    } catch (error) {
      if (loadToken !== this.widgetLoadToken) {
        return;
      }

      this.recordWidgetRenderError(widgetId, error, "reload");
      logSpacesError("reloadWidget failed", error, {
        spaceId: this.currentSpace.id,
        widgetId
      });
      this.setNotice(formatErrorMessage(error, `Unable to reload widget "${widgetId}".`), "error");
      skeleton.renderTarget.replaceChildren(
        createWidgetPlaceholder(formatErrorMessage(error, `Unable to render widget "${widgetId}".`))
      );
      skeleton.card.classList.add("is-error");
    }

    if (options.silent === true) {
      return null;
    }

    return buildWidgetToolResult(
      {
        space: this.currentSpace
      },
      {
        operationLabel: "reloadWidget(...)",
        spaceId: this.currentSpace.id,
        widgetId
      }
    );
  },

  getWidgetRenderCheck(widgetId) {
    return cloneWidgetRenderCheck(this.widgetRenderChecks?.[normalizeOptionalWidgetId(widgetId)], widgetId);
  },

  setWidgetRenderCheck(widgetId, check) {
    const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);

    if (!normalizedWidgetId) {
      return createUncheckedWidgetRenderCheck("", "No widget id was provided for the live render check.");
    }

    const nextCheck = cloneWidgetRenderCheck(check, normalizedWidgetId);
    this.widgetRenderChecks = {
      ...this.widgetRenderChecks,
      [normalizedWidgetId]: nextCheck
    };

    return nextCheck;
  },

  recordWidgetRenderSuccess(widgetId, phase = "render") {
    return this.setWidgetRenderCheck(widgetId, createSuccessfulWidgetRenderCheck(widgetId, phase));
  },

  recordWidgetRenderError(widgetId, error, phase = "render") {
    return this.setWidgetRenderCheck(widgetId, createFailedWidgetRenderCheck(widgetId, error, phase));
  },

  resetWidgetRenderChecks(widgetIds = []) {
    this.widgetRenderChecks = Object.fromEntries(
      normalizeRuntimeWidgetIdList(widgetIds).map((nextWidgetId) => [
        nextWidgetId,
        createUncheckedWidgetRenderCheck(nextWidgetId, `Widget "${nextWidgetId}" has not been live-tested yet.`)
      ])
    );
  },

  syncWidgetRenderChecks(widgetIds = [], rerenderWidgetIds = []) {
    const normalizedWidgetIds = normalizeRuntimeWidgetIdList(widgetIds);
    const rerenderSet = new Set(normalizeRuntimeWidgetIdList(rerenderWidgetIds));

    this.widgetRenderChecks = Object.fromEntries(
      normalizedWidgetIds.map((nextWidgetId) => [
        nextWidgetId,
        rerenderSet.has(nextWidgetId)
          ? createUncheckedWidgetRenderCheck(nextWidgetId, `Widget "${nextWidgetId}" has not been live-tested yet.`)
          : this.getWidgetRenderCheck(nextWidgetId)
      ])
    );
  },

  async consolidateCurrentSpace() {
    return this.rearrangeCurrentSpace();
  },

  async rearrangeCurrentSpace() {
    if (!this.currentSpace?.widgetIds?.length) {
      return;
    }

    const previousRects = captureWidgetCardRects(this.widgetCards);
    const nextSpace = getSpaceCardClone(this.currentSpace);
    const viewportCols = resolveViewportCols(this.refs.grid);
    const positions = buildCenteredFirstFitLayout({
      viewportCols,
      widgetIds: nextSpace.widgetIds,
      widgetSizes: Object.fromEntries(
        nextSpace.widgetIds.map((widgetId) => [
          widgetId,
          getRenderedWidgetSize(
            getEffectiveWidgetSize(nextSpace, widgetId),
            nextSpace.minimizedWidgetIds.includes(widgetId)
          )
        ])
      )
    }).positions;

    nextSpace.widgetPositions = positions;
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };

    const resolvedLayout = this.resolveCurrentSpaceLayout(nextSpace, {
      minimizedWidgetIds: nextSpace.minimizedWidgetIds,
      widgetPositions: nextSpace.widgetPositions,
      widgetSizes: nextSpace.widgetSizes
    });

    nextSpace.widgetPositions = { ...resolvedLayout.positions };
    nextSpace.minimizedWidgetIds = nextSpace.widgetIds.filter((widgetId) => resolvedLayout.minimizedMap[widgetId]);
    this.currentSpace = nextSpace;
    this.applyResolvedLayoutToCards(resolvedLayout, nextSpace, {
      previousRects
    });
    void this.persistLayoutSnapshot(nextSpace);
  },

  async loadSpacesList() {
    this.loadingList = true;

    try {
      this.spaceList = await listSpaces();
      this.loaded = true;
      syncSpacesRuntimeState();
    } finally {
      this.loadingList = false;
    }
  },

  async refreshFromRoute() {
    try {
      await this.loadSpacesList();

      const routeId = normalizeOptionalSpaceId(globalThis.space.router?.getParam("id", "") || "");
      const wantsNewSpace = isTruthyRouteParam(globalThis.space.router?.getParam("new", ""));

      if (wantsNewSpace) {
        await this.createSpaceFromRoute();
        return;
      }

      if (routeId) {
        await this.loadCurrentSpace(routeId);
        return;
      }

      if (this.spaceList.length > 0) {
        await spacesRuntime.openSpace(this.spaceList[0].id, { replace: true });
        return;
      }

      this.currentSpace = null;
      this.currentSpaceIconColorDraft = "";
      this.currentSpaceIconDraft = "";
      this.currentSpaceId = "";
      this.currentSpaceInstructionsDraft = "";
      this.currentSpaceTitleDraft = "";
      this.isConfigPanelOpen = false;
      syncSpacesRuntimeState();
      this.renderGridState("No spaces yet.", "Create a space to start building persisted widgets.");
    } catch (error) {
      logSpacesError("refreshFromRoute failed", error);
      this.currentSpace = null;
      this.currentSpaceIconColorDraft = "";
      this.currentSpaceIconDraft = "";
      this.currentSpaceId = "";
      this.currentSpaceInstructionsDraft = "";
      this.currentSpaceTitleDraft = "";
      this.isConfigPanelOpen = false;
      syncSpacesRuntimeState();
      this.renderGridState("Unable to load spaces.", formatErrorMessage(error, "Unknown spaces error."), "error");
      this.setNotice(formatErrorMessage(error, "Unable to load spaces."), "error");
    }
  },

  async createSpaceFromRoute() {
    if (this.creatingSpace) {
      return;
    }

    this.creatingSpace = true;

    try {
      const createdSpace = await createSpace();

      await this.loadSpacesList();
      await spacesRuntime.openSpace(createdSpace.id, { replace: true });
    } catch (error) {
      logSpacesError("createSpaceFromRoute failed", error);
      this.setNotice(formatErrorMessage(error, "Unable to create a new space."), "error");
      this.renderGridState("Unable to create space.", formatErrorMessage(error, "Unknown create error."), "error");
    } finally {
      this.creatingSpace = false;
    }
  },

  async createSpaceFromUi() {
    if (this.creatingSpace) {
      return;
    }

    this.creatingSpace = true;

    try {
      const createdSpace = await createSpace();

      await spacesRuntime.openSpace(createdSpace.id);
    } catch (error) {
      logSpacesError("createSpaceFromUi failed", error);
      this.setNotice(formatErrorMessage(error, "Unable to create a new space."), "error");
    } finally {
      this.creatingSpace = false;
    }
  },

  async selectSpace(spaceId) {
    if (!spaceId || spaceId === this.currentSpaceId) {
      return;
    }

    await spacesRuntime.openSpace(spaceId);
  },

  renderGridState(titleValue, bodyValue, tone = "info") {
    const grid = this.prepareGridForStandaloneState();

    if (!grid) {
      return;
    }

    grid.replaceChildren(createGridStateCard(titleValue, bodyValue, tone));
    syncSpacesRuntimeState();
  },

  prepareGridForStandaloneState() {
    if (!this.refs.grid) {
      return null;
    }

    this.cleanupEmptyCanvas();
    this.cleanupRenderFade();
    cleanupWidgetCards(this.widgetCards);
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.widgetCards = {};
    this.widgetRenderChecks = {};
    this.currentCanvasBounds = null;
    this.currentResolvedLayout = null;
    this.hasCenteredCurrentSpace = false;
    this.refs.grid.style.removeProperty("width");
    this.refs.grid.style.removeProperty("height");
    this.refs.grid.replaceChildren();

    return this.refs.grid;
  },

  renderLoadingSpaceState() {
    const grid = this.prepareGridForStandaloneState();

    if (!grid) {
      return;
    }

    const loadingCanvas = createLoadingCanvasState();
    grid.appendChild(loadingCanvas.root);
    this.emptyCanvasCleanup = startFloatingTitleAnimation(loadingCanvas.title, this.motionQuery);
    syncSpacesRuntimeState();
  },

  async loadCurrentSpace(spaceId) {
    await this.flushCurrentSpaceMetaSave({
      suppressErrors: true
    });
    this.loadingSpace = true;
    this.widgetLoadToken += 1;
    const loadToken = this.widgetLoadToken;
    cleanupWidgetCards(this.widgetCards);
    this.currentSpaceId = spaceId;
    this.currentSpace = null;
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.currentCanvasBounds = null;
    this.currentResolvedLayout = null;
    this.currentSpaceIconColorDraft = "";
    this.currentSpaceIconDraft = "";
    this.currentSpaceInstructionsDraft = "";
    this.currentSpaceTitleDraft = "";
    this.hasCenteredCurrentSpace = false;
    this.widgetCards = {};
    this.widgetErrorCount = 0;
    this.widgetRenderChecks = {};
    this.renderLoadingSpaceState();

    try {
      const spaceRecord = await readSpace(spaceId);

      if (loadToken !== this.widgetLoadToken) {
        return;
      }

      this.applyCurrentSpaceSnapshot(spaceRecord);
      await this.renderCurrentSpace(spaceRecord, loadToken);
    } catch (error) {
      if (loadToken !== this.widgetLoadToken) {
        return;
      }

      this.currentSpace = null;
      this.currentSpaceIconColorDraft = "";
      this.currentSpaceIconDraft = "";
      this.currentSpaceInstructionsDraft = "";
      this.currentSpaceTitleDraft = "";
      this.isConfigPanelOpen = false;
      syncSpacesRuntimeState();
      this.renderGridState(
        "Unable to open this space.",
        formatErrorMessage(error, "The requested space could not be loaded."),
        "error"
      );
      logSpacesError("loadCurrentSpace failed", error, { spaceId });
      this.setNotice(formatErrorMessage(error, "Unable to open this space."), "error");
    } finally {
      if (loadToken === this.widgetLoadToken) {
        this.loadingSpace = false;
      }
    }
  },

  async renderCurrentSpace(spaceRecord, loadToken, options = {}) {
    const grid = this.refs.grid;

    if (!grid) {
      return;
    }

    this.cleanupEmptyCanvas();
    this.cleanupRenderFade();
    cleanupWidgetCards(this.widgetCards);
    this.widgetCards = {};
    grid.replaceChildren();

    if (!spaceRecord.widgetIds.length) {
      let exampleDefinitions = [];

      try {
        exampleDefinitions = await loadEmptyCanvasExamples();
      } catch (error) {
        logSpacesError("loadEmptyCanvasExamples failed", error, {
          spaceId: spaceRecord.id
        });
      }

      const emptyCanvas = createEmptyCanvasState(exampleDefinitions);

      this.currentCanvasBounds = null;
      this.currentResolvedLayout = null;
      this.hasCenteredCurrentSpace = false;
      this.resetWidgetRenderChecks();
      grid.style.removeProperty("width");
      grid.style.removeProperty("height");
      grid.appendChild(emptyCanvas.root);
      const floatingCleanup = startEmptyCanvasTextFloatAnimation(emptyCanvas.floaters, this.motionQuery);
      const sequenceCleanup = startEmptyCanvasSequenceAnimation(emptyCanvas, this.motionQuery);
      this.emptyCanvasCleanup = combineCleanupFunctions(floatingCleanup, sequenceCleanup);
      this.renderFadeCleanup = playGridFadeIn(grid, this.motionQuery);
      syncSpacesRuntimeState();
      return;
    }

    const resolvedLayout = this.resolveCurrentSpaceLayout(spaceRecord);
    this.resetWidgetRenderChecks(spaceRecord.widgetIds);
    const renderJobs = spaceRecord.widgetIds.map(async (widgetId) => {
      const layoutEntry = buildWidgetLayoutEntry(resolvedLayout, widgetId);
      const skeleton = createWidgetCardSkeleton(spaceRecord, widgetId, layoutEntry);
      this.widgetCards[widgetId] = skeleton;
      grid.appendChild(skeleton.card);

      try {
        await renderWidgetCard(spaceRecord, widgetId, skeleton, loadToken, layoutEntry, "render");
      } catch (error) {
        if (loadToken !== this.widgetLoadToken) {
          return;
        }

        this.recordWidgetRenderError(widgetId, error, "render");
        logSpacesError("renderWidgetCard failed", error, {
          spaceId: spaceRecord.id,
          widgetId
        });
        this.widgetErrorCount += 1;
        skeleton.renderTarget.replaceChildren(
          createWidgetPlaceholder(formatErrorMessage(error, `Unable to render widget "${widgetId}".`))
        );
        skeleton.card.classList.add("is-error");
      }
    });

    this.applyResolvedLayoutToCards(resolvedLayout, spaceRecord, {
      animateEntering: options.animateEntering,
      centerOrigin: options.centerOrigin !== false,
      previousRects: options.previousRects || null
    });
    this.renderFadeCleanup = playGridFadeIn(grid, this.motionQuery);
    await Promise.allSettled(renderJobs);
  },

  async reconcileCurrentSpace(spaceRecord, loadToken, options = {}) {
    const grid = this.refs.grid;

    if (!grid) {
      return;
    }

    if (!spaceRecord.widgetIds.length || !Object.keys(this.widgetCards).length) {
      await this.renderCurrentSpace(spaceRecord, loadToken, options);
      return;
    }

    this.cleanupEmptyCanvas();
    this.cleanupRenderFade();

    const previousSpace = options.previousSpace || this.currentSpace;
    const previousRects = options.previousRects || captureWidgetCardRects(this.widgetCards);
    const targetWidgetId = normalizeOptionalWidgetId(options.widgetId);
    const addedWidgetIds = [];
    const rerenderWidgetIds = [];

    Object.keys(this.widgetCards).forEach((widgetId) => {
      if (!spaceRecord.widgetIds.includes(widgetId)) {
        removeWidgetCard(this.widgetCards, widgetId);
      }
    });

    const resolvedLayout = this.resolveCurrentSpaceLayout(spaceRecord);
    spaceRecord.widgetIds.forEach((widgetId) => {
      const layoutEntry = buildWidgetLayoutEntry(resolvedLayout, widgetId);

      if (!this.widgetCards[widgetId]) {
        this.widgetCards[widgetId] = createWidgetCardSkeleton(spaceRecord, widgetId, layoutEntry);
        addedWidgetIds.push(widgetId);
        rerenderWidgetIds.push(widgetId);
        return;
      }

      if (widgetId === targetWidgetId || widgetRecordNeedsRender(previousSpace, spaceRecord, widgetId)) {
        rerenderWidgetIds.push(widgetId);
      }
    });

    syncWidgetCardOrder(grid, spaceRecord.widgetIds, this.widgetCards);
    this.syncWidgetRenderChecks(spaceRecord.widgetIds, rerenderWidgetIds);
    this.applyResolvedLayoutToCards(resolvedLayout, spaceRecord, {
      animateEntering: options.animateEntering !== false && addedWidgetIds.length > 0,
      centerOrigin: options.centerOrigin === true,
      previousRects
    });

    const renderJobs = rerenderWidgetIds.map(async (widgetId) => {
      const skeleton = this.widgetCards[widgetId];

      if (!skeleton) {
        return;
      }

      try {
        await renderWidgetCard(
          spaceRecord,
          widgetId,
          skeleton,
          loadToken,
          buildWidgetLayoutEntry(resolvedLayout, widgetId),
          addedWidgetIds.includes(widgetId) ? "render" : "reload"
        );
      } catch (error) {
        if (loadToken !== this.widgetLoadToken) {
          return;
        }

        this.recordWidgetRenderError(widgetId, error, "reload");
        logSpacesError("reconcileCurrentSpace renderWidgetCard failed", error, {
          spaceId: spaceRecord.id,
          widgetId
        });
        this.widgetErrorCount += 1;
        skeleton.renderTarget.replaceChildren(
          createWidgetPlaceholder(formatErrorMessage(error, `Unable to render widget "${widgetId}".`))
        );
        skeleton.card.classList.add("is-error");
      }
    });

    await Promise.allSettled(renderJobs);
  },

  async reloadCurrentSpace() {
    await this.handleExternalMutation(this.currentSpaceId);
  },

  async refreshCurrentSpaceFromStorage(spaceId, options = {}) {
    if (!spaceId || !this.currentSpace || this.currentSpaceId !== spaceId) {
      await this.loadCurrentSpace(spaceId);
      return;
    }

    this.widgetLoadToken += 1;
    const loadToken = this.widgetLoadToken;
    const previousRects = options.previousRects || captureWidgetCardRects(this.widgetCards);
    const preservedCameraOffset = options.preserveCamera === false
      ? { x: 0, y: 0 }
      : { ...this.cameraOffsetPx };
    const previousSpace = this.currentSpace;

    try {
      const spaceRecord = await readSpace(spaceId);

      if (loadToken !== this.widgetLoadToken) {
        return;
      }

      this.applyCurrentSpaceSnapshot(spaceRecord, {
        cameraOffset: preservedCameraOffset
      });
      await this.reconcileCurrentSpace(spaceRecord, loadToken, {
        animateEntering: options.animateEntering !== false,
        centerOrigin: options.centerOrigin === true,
        previousRects,
        previousSpace,
        widgetId: options.widgetId
      });
    } catch (error) {
      if (loadToken !== this.widgetLoadToken) {
        return;
      }

      logSpacesError("refreshCurrentSpaceFromStorage failed", error, { spaceId });
      this.setNotice(formatErrorMessage(error, "Unable to refresh the current space."), "error");
    }
  },

  async handleRemovedSpace(spaceId) {
    await this.loadSpacesList();

    if (!spaceId || this.currentSpaceId !== spaceId) {
      return;
    }

    this.currentSpace = null;
    this.currentSpaceIconColorDraft = "";
    this.currentSpaceIconDraft = "";
    this.currentSpaceId = "";
    this.currentSpaceInstructionsDraft = "";
    this.currentSpaceTitleDraft = "";
    this.isConfigPanelOpen = false;
    syncSpacesRuntimeState();

    if (this.spaceList.length > 0) {
      await globalThis.space.router?.replaceTo(SPACES_ROUTE_PATH, {
        params: {
          id: this.spaceList[0].id
        }
      });
      return;
    }

    if (globalThis.space.router) {
      await globalThis.space.router.replaceTo(SPACES_ROUTE_PATH);
      return;
    }

    this.renderGridState("No spaces yet.", "Create a space to start building persisted widgets.");
  },

  async handleExternalMutation(spaceId, options = {}) {
    await this.loadSpacesList();

    if (spaceId && this.currentSpaceId === spaceId) {
      await this.refreshCurrentSpaceFromStorage(spaceId, {
        animateEntering: true,
        preserveCamera: true,
        widgetId: options.widgetId
      });
      return;
    }

    syncSpacesRuntimeState();
  },

  async refreshFromUi() {
    this.clearNotice();
    await this.reloadCurrentSpace();
  }
};

space.fw.createStore(SPACES_STORE_NAME, spacesModel);
