import { createHttpError, getAppPathInfo } from "../lib/customware/file_access.js";
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

function handleInfo(context) {
  const maxLayer = resolveRequestMaxLayer({
    body: readPayload(context),
    headers: context.headers,
    requestUrl: context.requestUrl
  });

  try {
    return getAppPathInfo({
      maxLayer,
      path: readPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username: context.user?.username,
      watchdog: context.watchdog
    });
  } catch (error) {
    throw createHttpError(error.message || "File info failed.", Number(error.statusCode) || 500);
  }
}

export function get(context) {
  return handleInfo(context);
}

export function post(context) {
  return handleInfo(context);
}
