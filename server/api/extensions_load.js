import { normalizePathSegment } from "../lib/utils/app_files.js";
import {
  listResolvedExtensionRequests,
  listResolvedExtensionRequestPaths
} from "../lib/customware/extension_overrides.js";
import { resolveRequestMaxLayer } from "../lib/customware/layer_limit.js";

function readPayload(context) {
  if (!context.body || typeof context.body !== "object" || Buffer.isBuffer(context.body)) {
    return {};
  }

  return context.body;
}

function createNormalizePattern() {
  const normalizePattern = (value) => {
    try {
      return normalizePathSegment(value);
    } catch {
      return "";
    }
  };

  return normalizePattern;
}

function readRequestedPatterns(input, normalizePattern = createNormalizePattern()) {
  if (!input || typeof input !== "object" || Buffer.isBuffer(input)) {
    return [];
  }

  if (Array.isArray(input.patterns)) {
    return input.patterns
      .filter((value) => typeof value === "string")
      .map((value) => normalizePattern(value))
      .filter(Boolean);
  }

  const extensionPoint = normalizePattern(input.extension_point || "");
  const filters = Array.isArray(input.filters)
    ? input.filters.filter((value) => typeof value === "string" && value.trim())
    : [];

  if (!extensionPoint) {
    return [];
  }

  return (filters.length > 0 ? filters : ["*"]).map((filter) =>
    normalizePattern(extensionPoint + "/" + filter)
  ).filter(Boolean);
}

function readRequestedGroups(context) {
  const payload = readPayload(context);
  const normalizePattern = createNormalizePattern();

  if (Array.isArray(payload.requests)) {
    return payload.requests
      .map((request) => {
        const patterns = readRequestedPatterns(request, normalizePattern);

        if (patterns.length === 0) {
          return null;
        }

        return { patterns };
      })
      .filter(Boolean);
  }

  const patterns = readRequestedPatterns(payload, normalizePattern);
  if (patterns.length === 0) {
    return [];
  }

  return [
    {
      patterns
    }
  ];
}

export async function post(context) {
  const payload = readPayload(context);
  const requests = readRequestedGroups(context);
  const maxLayer = resolveRequestMaxLayer({
    body: payload,
    headers: context.headers,
    requestUrl: context.requestUrl
  });
  const username = context.user && context.user.username;
  const stateSystem = context.stateSystem;

  await context.ensureUserFileIndex?.(username);

  if (Array.isArray(payload.requests)) {
    return {
      results: listResolvedExtensionRequests({
        maxLayer,
        requests,
        runtimeParams: context.runtimeParams,
        stateSystem,
        username,
      })
    };
  }

  const patterns = requests[0]?.patterns || [];
  const extensions = listResolvedExtensionRequestPaths({
    maxLayer,
    patterns,
    runtimeParams: context.runtimeParams,
    stateSystem,
    username,
  });

  return {
    extensions
  };
}
