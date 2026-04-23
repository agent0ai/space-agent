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

function readAllowMissing(context) {
  const payload = readPayload(context);
  const raw =
    payload.allowMissing ??
    payload.allow_missing ??
    context.params.allowMissing ??
    context.params.allow_missing;
  return raw === true || raw === "true" || raw === "1" || raw === 1;
}

function isMissingPathError(error) {
  const status = Number(error?.statusCode);
  if (status === 404) return true;
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  return code === "ENOENT" || /path not found|not found/iu.test(String(error?.message || ""));
}

function hasBatchRead(payload) {
  return Boolean(payload) && typeof payload === "object" && Array.isArray(payload.files);
}

function buildMissingFileResult(path, encoding) {
  return {
    content: encoding === "base64" ? "" : "",
    encoding,
    exists: false,
    path: String(path || "")
  };
}

function handleRead(context) {
  const payload = readPayload(context);
  const allowMissing = readAllowMissing(context);
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
      if (allowMissing) {
        const files = payload.files.map((entry) => {
          try {
            return readAppFile({ ...options, path: entry.path, encoding: entry.encoding || options.encoding });
          } catch (error) {
            if (isMissingPathError(error)) {
              return buildMissingFileResult(entry.path, entry.encoding || options.encoding);
            }
            throw error;
          }
        });
        return { files };
      }
      return readAppFiles({
        ...options,
        files: payload.files
      });
    }

    try {
      return readAppFile(options);
    } catch (error) {
      if (allowMissing && isMissingPathError(error)) {
        return buildMissingFileResult(options.path, options.encoding);
      }
      throw error;
    }
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
