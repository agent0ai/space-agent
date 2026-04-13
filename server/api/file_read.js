import { createHttpError, readAppFile, readAppFiles } from "../lib/customware/file_access.js";
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

function readEncoding(context) {
  const payload = readPayload(context);
  return String(payload.encoding || context.params.encoding || "utf8");
}

function hasBatchRead(payload) {
  return Boolean(payload) && typeof payload === "object" && Array.isArray(payload.files);
}

function handleRead(context) {
  const payload = readPayload(context);
  const maxLayer = resolveRequestMaxLayer({
    body: payload,
    headers: context.headers,
    requestUrl: context.requestUrl
  });

  try {
    const options = {
      encoding: readEncoding(context),
      maxLayer,
      path: readPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username: context.user?.username,
      watchdog: context.watchdog
    };

    if (hasBatchRead(payload)) {
      return readAppFiles({
        ...options,
        files: payload.files
      });
    }

    return readAppFile(options);
  } catch (error) {
    throw createHttpError(error.message || "File read failed.", Number(error.statusCode) || 500);
  }
}

export function get(context) {
  return handleRead(context);
}

export function post(context) {
  return handleRead(context);
}
