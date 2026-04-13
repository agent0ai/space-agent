import { createHttpError, listAppPathsByPatterns } from "../lib/customware/file_access.js";
import { parseOptionalMaxLayer } from "../lib/customware/layer_limit.js";

function readPatternValues(context) {
  const body = context.body;

  if (Array.isArray(body)) {
    return body;
  }

  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    if (body.patterns !== undefined) {
      return Array.isArray(body.patterns) ? body.patterns : [body.patterns];
    }

    if (body.pattern !== undefined) {
      return Array.isArray(body.pattern) ? body.pattern : [body.pattern];
    }
  }

  const queryValue =
    context.params.patterns !== undefined
      ? context.params.patterns
      : context.params.pattern !== undefined
        ? context.params.pattern
        : [];

  return Array.isArray(queryValue) ? queryValue : queryValue !== undefined ? [queryValue] : [];
}

function readPatterns(context) {
  return readPatternValues(context).map((value) => {
    if (typeof value !== "string") {
      throw createHttpError("File patterns must be strings.", 400);
    }

    return value;
  });
}

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readAccess(context) {
  const payload = readPayload(context);
  return String(payload.access || context.params.access || "");
}

function readBooleanOption(context, name) {
  const payload = readPayload(context);
  const rawValue = payload[name] !== undefined ? payload[name] : context.params[name];

  if (typeof rawValue === "boolean") {
    return rawValue;
  }

  return ["1", "true", "yes", "on"].includes(String(rawValue || "").trim().toLowerCase());
}

function handleFilePaths(context) {
  const payload = readPayload(context);
  const maxLayer = parseOptionalMaxLayer(payload.maxLayer ?? context.params.maxLayer);

  try {
    return listAppPathsByPatterns({
      access: readAccess(context),
      gitRepositories: readBooleanOption(context, "gitRepositories"),
      ...(maxLayer === null ? {} : { maxLayer }),
      patterns: readPatterns(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      writableOnly: readBooleanOption(context, "writableOnly"),
      username: context.user?.username,
      watchdog: context.watchdog
    });
  } catch (error) {
    throw createHttpError(error.message || "File path lookup failed.", Number(error.statusCode) || 500);
  }
}

export function get(context) {
  return handleFilePaths(context);
}

export function post(context) {
  return handleFilePaths(context);
}
