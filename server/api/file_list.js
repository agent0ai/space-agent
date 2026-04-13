import { createHttpError, listAppPaths } from "../lib/customware/file_access.js";
import { resolveRequestMaxLayer } from "../lib/customware/layer_limit.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readPath(context) {
  const payload = readPayload(context);
  return String(payload.path || context.params.path || "");
}

function readRecursive(context) {
  const payload = readPayload(context);
  const rawValue =
    payload.recursive !== undefined ? payload.recursive : context.params.recursive !== undefined ? context.params.recursive : false;

  if (typeof rawValue === "boolean") {
    return rawValue;
  }

  return ["1", "true", "yes", "on"].includes(String(rawValue || "").trim().toLowerCase());
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

function handleList(context) {
  const maxLayer = resolveRequestMaxLayer({
    body: readPayload(context),
    headers: context.headers,
    requestUrl: context.requestUrl
  });

  try {
    return listAppPaths({
      access: readAccess(context),
      gitRepositories: readBooleanOption(context, "gitRepositories"),
      maxLayer,
      path: readPath(context),
      projectRoot: context.projectRoot,
      recursive: readRecursive(context),
      runtimeParams: context.runtimeParams,
      writableOnly: readBooleanOption(context, "writableOnly"),
      username: context.user?.username,
      watchdog: context.watchdog
    });
  } catch (error) {
    throw createHttpError(error.message || "File list failed.", Number(error.statusCode) || 500);
  }
}

export function get(context) {
  return handleList(context);
}

export function post(context) {
  return handleList(context);
}
