import { copyAppPath, copyAppPaths, createHttpError } from "../lib/customware/file_access.js";
import { resolveRequestMaxLayer } from "../lib/customware/layer_limit.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function hasBatchCopy(payload) {
  return Boolean(payload) && typeof payload === "object" && Array.isArray(payload.entries);
}

export async function post(context) {
  const payload = readPayload(context);
  const maxLayer = resolveRequestMaxLayer({
    body: payload,
    headers: context.headers,
    requestUrl: context.requestUrl
  });

  try {
    return await runTrackedMutation(context, async () => {
      const options = {
        fromPath: String(payload.fromPath || context.params.fromPath || ""),
        maxLayer,
        projectRoot: context.projectRoot,
        runtimeParams: context.runtimeParams,
        toPath: String(payload.toPath || context.params.toPath || ""),
        username: context.user?.username,
        watchdog: context.watchdog
      };
      if (hasBatchCopy(payload)) {
        options.entries = payload.entries;
      }

      return hasBatchCopy(payload) ? copyAppPaths(options) : copyAppPath(options);
    });
  } catch (error) {
    throw createHttpError(error.message || "File copy failed.", Number(error.statusCode) || 500);
  }
}
