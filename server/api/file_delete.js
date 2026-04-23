import { createHttpError, deleteAppPath, deleteAppPaths } from "../lib/customware/file_access.js";
import { resolveRequestMaxLayer } from "../lib/customware/layer_limit.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readPath(context) {
  const payload = readPayload(context);
  return String(payload.path || context.params.path || "");
}

function hasBatchDelete(payload) {
  return Boolean(payload) && typeof payload === "object" && Array.isArray(payload.paths);
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

async function handleDelete(context) {
  const payload = readPayload(context);
  const allowMissing = readAllowMissing(context);
  const maxLayer = resolveRequestMaxLayer({
    body: payload,
    headers: context.headers,
    requestUrl: context.requestUrl
  });

  try {
    return await runTrackedMutation(context, async () => {
      const options = {
        maxLayer,
        path: readPath(context),
        paths: payload.paths,
        projectRoot: context.projectRoot,
        runtimeParams: context.runtimeParams,
        username: context.user?.username,
        watchdog: context.watchdog
      };

      try {
        return hasBatchDelete(payload) ? deleteAppPaths(options) : deleteAppPath(options);
      } catch (error) {
        if (allowMissing && isMissingPathError(error)) {
          return { deleted: false, exists: false, path: options.path || "" };
        }
        throw error;
      }
    });
  } catch (error) {
    throw createHttpError(error.message || "File delete failed.", Number(error.statusCode) || 500);
  }
}

export function post(context) {
  return handleDelete(context);
}

export { handleDelete as delete };
