const DEFAULT_MAX_LAYER = 2;
const MIN_MAX_LAYER = 0;
const MAX_MAX_LAYER = 2;
const LAYER_ORDER = Object.freeze({
  L0: 0,
  L1: 1,
  L2: 2
});

function parseOptionalMaxLayer(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue)) {
    return null;
  }

  return Math.min(MAX_MAX_LAYER, Math.max(MIN_MAX_LAYER, numericValue));
}

function normalizeMaxLayer(value, fallback = DEFAULT_MAX_LAYER) {
  const parsedMaxLayer = parseOptionalMaxLayer(value);
  return parsedMaxLayer === null ? fallback : parsedMaxLayer;
}

function getLayerOrder(layer) {
  return LAYER_ORDER[layer] ?? null;
}

function isProjectPathWithinMaxLayer(projectPath, maxLayer = DEFAULT_MAX_LAYER) {
  const normalizedMaxLayer = normalizeMaxLayer(maxLayer);
  const normalizedProjectPath = String(projectPath || "");

  if (normalizedProjectPath.startsWith("/app/L0/")) {
    return true;
  }

  if (normalizedProjectPath.startsWith("/app/L1/")) {
    return normalizedMaxLayer >= 1;
  }

  if (normalizedProjectPath.startsWith("/app/L2/")) {
    return normalizedMaxLayer >= 2;
  }

  return true;
}

function parseUrlLike(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(String(value), "http://localhost");
  } catch {
    return null;
  }
}

function resolveRequestMaxLayer(options = {}) {
  const {
    body,
    fallback = DEFAULT_MAX_LAYER,
    headers,
    requestUrl
  } = options;

  const explicitBodyMaxLayer =
    body && typeof body === "object" && !Buffer.isBuffer(body)
      ? parseOptionalMaxLayer(body.maxLayer)
      : null;

  if (explicitBodyMaxLayer !== null) {
    return explicitBodyMaxLayer;
  }

  const explicitQueryMaxLayer = parseOptionalMaxLayer(
    requestUrl?.searchParams?.get("maxLayer")
  );

  if (explicitQueryMaxLayer !== null) {
    return explicitQueryMaxLayer;
  }

  const explicitHeaderMaxLayer = parseOptionalMaxLayer(
    headers?.["x-space-max-layer"] ??
      headers?.["X-Space-Max-Layer"] ??
      (typeof headers?.get === "function" ? headers.get("x-space-max-layer") : undefined)
  );

  if (explicitHeaderMaxLayer !== null) {
    return explicitHeaderMaxLayer;
  }

  const refererUrl = parseUrlLike(headers?.referer || headers?.referrer || "");

  if (!refererUrl) {
    return fallback;
  }

  const refererQueryMaxLayer = parseOptionalMaxLayer(
    refererUrl.searchParams.get("maxLayer")
  );

  if (refererQueryMaxLayer !== null) {
    return refererQueryMaxLayer;
  }

  if (refererUrl.pathname === "/admin" || refererUrl.pathname === "/admin.html") {
    return 0;
  }

  return fallback;
}

export {
  DEFAULT_MAX_LAYER,
  MAX_MAX_LAYER,
  MIN_MAX_LAYER,
  getLayerOrder,
  isProjectPathWithinMaxLayer,
  normalizeMaxLayer,
  parseOptionalMaxLayer,
  resolveRequestMaxLayer
};
