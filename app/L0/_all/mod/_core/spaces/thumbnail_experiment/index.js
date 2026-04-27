import { SPACES_ROOT_PATH } from "/mod/_core/spaces/constants.js";
import { renderScreenshotCanvas } from "/mod/_core/skillset/ext/skills/screenshots/screenshots.js";

export const SPACE_THUMBNAIL_TARGET_SIZE = 200;
export const SPACE_THUMBNAIL_WEBP_FILE = "thumbnail.webp";
export const SPACE_THUMBNAIL_JPEG_FILE = "thumbnail.jpg";

const CAPTURE_DEBOUNCE_MS = 520;
const CAPTURE_SETTLE_MS = 140;
const CAPTURE_BACKGROUND = "#09121d";
const CAPTURE_WIDGET_SELECTOR = ".spaces-widget-card";
const CAPTURE_WIDGET_MIN_SIZE = 18;
const CAPTURE_PADDING_MIN = 14;
const CAPTURE_PADDING_MAX = 40;
const CAPTURE_SCALE_MAX = 2;
const THUMBNAIL_FILE_NAMES = Object.freeze([
  SPACE_THUMBNAIL_WEBP_FILE,
  SPACE_THUMBNAIL_JPEG_FILE
]);
const queuedCaptures = new Map();

function normalizeSpaceThumbnailId(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/gu, "");
}

function ensureThumbnailRuntime() {
  if (!globalThis.space?.api?.fileDelete || !globalThis.space?.api?.fileWrite) {
    throw new Error("Space thumbnail capture requires the authenticated app-file runtime.");
  }

  return globalThis.space;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(resolve);
  });
}

async function waitForCaptureSettle() {
  await waitForAnimationFrame();
  await waitForAnimationFrame();
  await wait(CAPTURE_SETTLE_MS);
  await waitForAnimationFrame();
}

function isUsableElement(value) {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function intersectRects(leftRect, rightRect) {
  const left = Math.max(leftRect.left, rightRect.left);
  const top = Math.max(leftRect.top, rightRect.top);
  const right = Math.min(leftRect.right, rightRect.right);
  const bottom = Math.min(leftRect.bottom, rightRect.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    bottom,
    height,
    left,
    right,
    top,
    width
  };
}

function measureVisibleWidgetRects(canvasElement, gridElement) {
  const canvasRect = canvasElement.getBoundingClientRect();

  if (canvasRect.width < CAPTURE_WIDGET_MIN_SIZE || canvasRect.height < CAPTURE_WIDGET_MIN_SIZE) {
    return {
      canvasRect,
      widgetRects: []
    };
  }

  const widgetRects = Array.from(gridElement.querySelectorAll(CAPTURE_WIDGET_SELECTOR))
    .filter((element) => isUsableElement(element))
    .map((element) => intersectRects(element.getBoundingClientRect(), canvasRect))
    .filter((rect) => rect && rect.width >= CAPTURE_WIDGET_MIN_SIZE && rect.height >= CAPTURE_WIDGET_MIN_SIZE)
    .map((rect) => ({
      height: rect.height,
      left: rect.left - canvasRect.left,
      top: rect.top - canvasRect.top,
      width: rect.width
    }));

  return {
    canvasRect,
    widgetRects
  };
}

function buildUnionRect(rects = []) {
  if (!rects.length) {
    return null;
  }

  const bounds = rects.reduce(
    (current, rect) => ({
      bottom: Math.max(current.bottom, rect.top + rect.height),
      left: Math.min(current.left, rect.left),
      right: Math.max(current.right, rect.left + rect.width),
      top: Math.min(current.top, rect.top)
    }),
    {
      bottom: Number.NEGATIVE_INFINITY,
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      top: Number.POSITIVE_INFINITY
    }
  );

  return {
    height: bounds.bottom - bounds.top,
    left: bounds.left,
    top: bounds.top,
    width: bounds.right - bounds.left
  };
}

function expandRect(rect, padding, containerWidth, containerHeight) {
  const left = clampNumber(rect.left - padding, 0, containerWidth);
  const top = clampNumber(rect.top - padding, 0, containerHeight);
  const right = clampNumber(rect.left + rect.width + padding, 0, containerWidth);
  const bottom = clampNumber(rect.top + rect.height + padding, 0, containerHeight);

  return {
    height: Math.max(CAPTURE_WIDGET_MIN_SIZE, bottom - top),
    left,
    top,
    width: Math.max(CAPTURE_WIDGET_MIN_SIZE, right - left)
  };
}

function buildSquareCropRect(rect, containerWidth, containerHeight) {
  const containerSide = Math.max(1, Math.min(containerWidth, containerHeight));
  const preferredSide = Math.max(rect.width, rect.height);
  const side = clampNumber(preferredSide, CAPTURE_WIDGET_MIN_SIZE, containerSide);
  const centerX = rect.left + (rect.width / 2);
  const centerY = rect.top + (rect.height / 2);
  const left = clampNumber(centerX - (side / 2), 0, Math.max(0, containerWidth - side));
  const top = clampNumber(centerY - (side / 2), 0, Math.max(0, containerHeight - side));

  return {
    height: side,
    left,
    top,
    width: side
  };
}

function buildThumbnailCropRect(canvasRect, widgetRects = []) {
  const containerWidth = Math.max(1, canvasRect.width);
  const containerHeight = Math.max(1, canvasRect.height);

  if (!widgetRects.length) {
    const side = Math.max(1, Math.min(containerWidth, containerHeight));
    return {
      height: side,
      left: (containerWidth - side) / 2,
      top: (containerHeight - side) / 2,
      width: side
    };
  }

  const unionRect = buildUnionRect(widgetRects);
  const padding = clampNumber(
    Math.max(unionRect.width, unionRect.height) * 0.075,
    CAPTURE_PADDING_MIN,
    CAPTURE_PADDING_MAX
  );

  return buildSquareCropRect(
    expandRect(unionRect, padding, containerWidth, containerHeight),
    containerWidth,
    containerHeight
  );
}

function renderThumbnailCanvas(sourceCanvas, cropRect, canvasRect) {
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = SPACE_THUMBNAIL_TARGET_SIZE;
  outputCanvas.height = SPACE_THUMBNAIL_TARGET_SIZE;

  const context = outputCanvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to render the space thumbnail canvas.");
  }

  const scaleX = sourceCanvas.width / Math.max(1, canvasRect.width);
  const scaleY = sourceCanvas.height / Math.max(1, canvasRect.height);
  const sx = Math.round(cropRect.left * scaleX);
  const sy = Math.round(cropRect.top * scaleY);
  const sw = Math.max(1, Math.round(cropRect.width * scaleX));
  const sh = Math.max(1, Math.round(cropRect.height * scaleY));

  context.fillStyle = CAPTURE_BACKGROUND;
  context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, outputCanvas.width, outputCanvas.height);

  return outputCanvas;
}

async function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`Unable to encode the thumbnail as ${type}.`));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

async function createThumbnailBlob(canvas) {
  try {
    const webpBlob = await canvasToBlob(canvas, "image/webp", 0.86);

    if (webpBlob.type === "image/webp") {
      return {
        blob: webpBlob,
        fileName: SPACE_THUMBNAIL_WEBP_FILE,
        type: "image/webp"
      };
    }
  } catch {
    // Fall through to JPEG.
  }

  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.9);

  return {
    blob: jpegBlob,
    fileName: SPACE_THUMBNAIL_JPEG_FILE,
    type: "image/jpeg"
  };
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const separatorIndex = result.indexOf(",");
      resolve(separatorIndex >= 0 ? result.slice(separatorIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read the thumbnail blob."));
    reader.readAsDataURL(blob);
  });
}

async function deleteThumbnailPathIfExists(path) {
  const runtime = ensureThumbnailRuntime();
  // Idempotent delete: pass `ifExists: true` so the server returns 200
  // and lists the path under `skipped` instead of throwing 404 when the
  // alternative-format thumbnail file (e.g. the `thumbnail.jpg` sibling
  // of a `thumbnail.webp` that has always existed alone) was never on
  // disk. Without this, every widget move generates a 404 entry in the
  // DevTools console because the browser logs failed responses before
  // JavaScript can suppress them, and triggers the fetch-proxy retry
  // path which is what surfaces as a UI hitch during rapid moves.
  await runtime.api.fileDelete(path, { ifExists: true });
}

export function buildSpaceThumbnailPath(spaceId, fileName = SPACE_THUMBNAIL_WEBP_FILE) {
  const normalizedSpaceId = normalizeSpaceThumbnailId(spaceId);
  const normalizedFileName = String(fileName || "").trim();

  if (!normalizedSpaceId) {
    throw new Error("A spaceId is required to build a space thumbnail path.");
  }

  if (!normalizedFileName) {
    throw new Error("A thumbnail file name is required.");
  }

  return `${SPACES_ROOT_PATH}${normalizedSpaceId}/${normalizedFileName}`;
}

export function listSpaceThumbnailPaths(spaceId) {
  return THUMBNAIL_FILE_NAMES.map((fileName) => buildSpaceThumbnailPath(spaceId, fileName));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function resolveListedSpaceThumbnailPath(spaceId, listedPaths = []) {
  const normalizedSpaceId = normalizeSpaceThumbnailId(spaceId);
  const normalizedListedPaths = (Array.isArray(listedPaths) ? listedPaths : [])
    .map((path) => String(path || "").trim())
    .filter(Boolean);

  if (!normalizedSpaceId || !normalizedListedPaths.length) {
    return "";
  }

  for (const fileName of THUMBNAIL_FILE_NAMES) {
    const pathPattern = new RegExp(`(?:^|/)spaces/${escapeRegExp(normalizedSpaceId)}/${escapeRegExp(fileName)}$`, "u");
    const matchedPath = normalizedListedPaths.find((path) => pathPattern.test(path));

    if (matchedPath) {
      return matchedPath;
    }
  }

  return "";
}

export function buildSpaceThumbnailUrlFromPath(path, updatedAt = "") {
  const normalizedPath = String(path || "").trim();

  if (!normalizedPath) {
    return "";
  }

  const publicPath = normalizedPath.startsWith("/")
    ? normalizedPath
    : normalizedPath.startsWith("~/")
      ? `/${normalizedPath}`
      : `/${normalizedPath}`;
  const version = String(updatedAt || "").trim();

  return version ? `${publicPath}?v=${encodeURIComponent(version)}` : publicPath;
}

export async function clearSpaceThumbnailFiles(spaceId) {
  const normalizedSpaceId = normalizeSpaceThumbnailId(spaceId);

  if (!normalizedSpaceId) {
    return {
      deleted: false,
      path: "",
      spaceId: ""
    };
  }

  await Promise.all(listSpaceThumbnailPaths(normalizedSpaceId).map((path) => deleteThumbnailPathIfExists(path)));

  return {
    deleted: true,
    path: "",
    spaceId: normalizedSpaceId,
    url: ""
  };
}

export async function captureSpaceThumbnailNow(options = {}) {
  const normalizedSpaceId = normalizeSpaceThumbnailId(options.spaceId);
  const canvasElement = options.canvasElement;
  const gridElement = options.gridElement;
  const widgetCount = Math.max(0, Number.parseInt(options.widgetCount, 10) || 0);

  if (!normalizedSpaceId) {
    throw new Error("A spaceId is required to capture a space thumbnail.");
  }

  if (!isUsableElement(canvasElement) || !isUsableElement(gridElement)) {
    return {
      deleted: false,
      path: "",
      skipped: true,
      spaceId: normalizedSpaceId,
      url: ""
    };
  }

  if (!canvasElement.isConnected || !gridElement.isConnected) {
    return {
      deleted: false,
      path: "",
      skipped: true,
      spaceId: normalizedSpaceId,
      url: ""
    };
  }

  await waitForCaptureSettle();

  if (!canvasElement.isConnected || !gridElement.isConnected) {
    return {
      deleted: false,
      path: "",
      skipped: true,
      spaceId: normalizedSpaceId,
      url: ""
    };
  }

  const { canvasRect, widgetRects } = measureVisibleWidgetRects(canvasElement, gridElement);

  if (!widgetRects.length) {
    if (widgetCount > 0) {
      return {
        deleted: false,
        path: "",
        skipped: true,
        spaceId: normalizedSpaceId,
        url: ""
      };
    }

    return clearSpaceThumbnailFiles(normalizedSpaceId);
  }

  const sourceCanvas = await renderScreenshotCanvas({
    html2canvasOptions: {
      backgroundColor: CAPTURE_BACKGROUND,
      scale: Math.min(CAPTURE_SCALE_MAX, Math.max(1, Number(window.devicePixelRatio) || 1)),
      useCORS: true
    },
    target: canvasElement
  });
  const cropRect = buildThumbnailCropRect(canvasRect, widgetRects);
  const thumbnailCanvas = renderThumbnailCanvas(sourceCanvas, cropRect, canvasRect);
  const { blob, fileName, type } = await createThumbnailBlob(thumbnailCanvas);
  const path = buildSpaceThumbnailPath(normalizedSpaceId, fileName);
  const content = await blobToBase64(blob);
  const runtime = ensureThumbnailRuntime();

  await runtime.api.fileWrite({
    content,
    encoding: "base64",
    path
  });

  await Promise.all(
    listSpaceThumbnailPaths(normalizedSpaceId)
      .filter((candidatePath) => candidatePath !== path)
      .map((candidatePath) => deleteThumbnailPathIfExists(candidatePath))
  );

  return {
    deleted: false,
    fileName,
    path,
    spaceId: normalizedSpaceId,
    type,
    url: buildSpaceThumbnailUrlFromPath(path, options.updatedAt)
  };
}

async function runQueuedSpaceThumbnailCapture(spaceId) {
  const state = queuedCaptures.get(spaceId);

  if (!state) {
    return;
  }

  if (state.inFlight) {
    return;
  }

  const nextOptions = state.options;

  if (!nextOptions) {
    queuedCaptures.delete(spaceId);
    return;
  }

  state.inFlight = true;
  state.options = null;

  try {
    const result = await captureSpaceThumbnailNow(nextOptions);
    nextOptions.onComplete?.(result);
  } catch (error) {
    console.error("[spaces-thumbnail-experiment] capture failed", {
      spaceId
    }, error);
    nextOptions.onError?.(error);
  } finally {
    state.inFlight = false;

    if (state.options) {
      const delayMs = Number.isFinite(state.options.delayMs) ? Math.max(0, Number(state.options.delayMs)) : CAPTURE_DEBOUNCE_MS;
      state.timer = window.setTimeout(() => {
        state.timer = 0;
        void runQueuedSpaceThumbnailCapture(spaceId);
      }, delayMs);
      return;
    }

    if (!state.timer) {
      queuedCaptures.delete(spaceId);
    }
  }
}

export function queueSpaceThumbnailCapture(options = {}) {
  const normalizedSpaceId = normalizeSpaceThumbnailId(options.spaceId);

  if (!normalizedSpaceId || typeof window === "undefined") {
    return;
  }

  const existingState = queuedCaptures.get(normalizedSpaceId) || {
    inFlight: false,
    options: null,
    timer: 0
  };
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Number(options.delayMs)) : CAPTURE_DEBOUNCE_MS;

  existingState.options = {
    ...options,
    spaceId: normalizedSpaceId
  };

  if (existingState.timer) {
    window.clearTimeout(existingState.timer);
  }

  existingState.timer = window.setTimeout(() => {
    existingState.timer = 0;
    void runQueuedSpaceThumbnailCapture(normalizedSpaceId);
  }, delayMs);

  queuedCaptures.set(normalizedSpaceId, existingState);
}
