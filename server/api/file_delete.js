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

async function handleDelete(context) {
  const payload = readPayload(context);
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

      return hasBatchDelete(payload) ? deleteAppPaths(options) : deleteAppPath(options);
    });
  } catch (error) {
    throw createHttpError(error.message || "File delete failed.", Number(error.statusCode) || 500);
  }
}

export function post(context) {
  return handleDelete(context);
}

export { handleDelete as delete };
