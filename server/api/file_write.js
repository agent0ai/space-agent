import { createHttpError, writeAppFile, writeAppFiles } from "../lib/customware/file_access.js";
import { resolveRequestMaxLayer } from "../lib/customware/layer_limit.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function hasBatchWrite(payload) {
  return Boolean(payload) && typeof payload === "object" && Array.isArray(payload.files);
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
        content: payload.content,
        encoding: String(payload.encoding || "utf8"),
        maxLayer,
        path: String(payload.path || context.params.path || ""),
        projectRoot: context.projectRoot,
        runtimeParams: context.runtimeParams,
        username: context.user?.username,
        watchdog: context.watchdog
      };

      return hasBatchWrite(payload)
        ? writeAppFiles({
            ...options,
            files: payload.files
          })
        : writeAppFile(options);
    });
  } catch (error) {
    throw createHttpError(error.message || "File write failed.", Number(error.statusCode) || 500);
  }
}
