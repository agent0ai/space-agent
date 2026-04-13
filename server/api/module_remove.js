import { createHttpError, deleteAppPath } from "../lib/customware/file_access.js";
import { normalizeMaxLayer } from "../lib/customware/layer_limit.js";
import { normalizeModuleTargetPath, readModuleInfo } from "../lib/customware/module_manage.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readTargetPath(context) {
  const payload = readPayload(context);

  return String(payload.path || context.params.path || "");
}

function readMaxLayer(context) {
  const payload = readPayload(context);

  return normalizeMaxLayer(payload.maxLayer ?? context.params.maxLayer);
}

export async function post(context) {
  try {
    const targetPathInfo = normalizeModuleTargetPath(readTargetPath(context), {
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      stateSystem: context.stateSystem,
      username: context.user?.username
    });
    const result = await runTrackedMutation(context, async () =>
      deleteAppPath({
        path: targetPathInfo.projectPath,
        projectRoot: context.projectRoot,
        runtimeParams: context.runtimeParams,
        username: context.user?.username,
        watchdog: context.watchdog
      })
    );

    return {
      action: "deleted",
      path: result.path,
      requestPath: targetPathInfo.requestPath,
      module: await readModuleInfo({
        maxLayer: readMaxLayer(context),
        path: targetPathInfo.requestPath,
        projectRoot: context.projectRoot,
        runtimeParams: context.runtimeParams,
        stateSystem: context.stateSystem,
        username: context.user?.username
      })
    };
  } catch (error) {
    throw createHttpError(error.message || "Module remove failed.", Number(error.statusCode) || 500);
  }
}
