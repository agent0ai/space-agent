import { createHttpError, moveAppPath, moveAppPaths } from "../lib/customware/file_access.js";
import { resolveRequestMaxLayer } from "../lib/customware/layer_limit.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function hasBatchMove(payload) {
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
      if (hasBatchMove(payload)) {
        options.entries = payload.entries;
      }

      return hasBatchMove(payload) ? moveAppPaths(options) : moveAppPath(options);
    });
  } catch (error) {
    throw createHttpError(error.message || "File move failed.", Number(error.statusCode) || 500);
  }
}
