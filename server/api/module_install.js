import { createHttpError } from "../lib/customware/file_access.js";
import { normalizeMaxLayer } from "../lib/customware/layer_limit.js";
import { installModule, readModuleInfo } from "../lib/customware/module_manage.js";
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

function readRepositoryUrl(context) {
  const payload = readPayload(context);

  return String(
    payload.repoUrl ||
      payload.repo_url ||
      payload.repositoryUrl ||
      payload.repository_url ||
      ""
  ).trim();
}

function readRevision(value) {
  return String(value || "").trim();
}

function readMaxLayer(context) {
  const payload = readPayload(context);

  return normalizeMaxLayer(payload.maxLayer ?? context.params.maxLayer);
}

export async function post(context) {
  const payload = readPayload(context);

  try {
    const result = await runTrackedMutation(context, async () =>
      installModule({
        commit: readRevision(payload.commit),
        path: readTargetPath(context),
        projectRoot: context.projectRoot,
        repoUrl: readRepositoryUrl(context),
        runtimeParams: context.runtimeParams,
        stateSystem: context.stateSystem,
        tag: readRevision(payload.tag),
        token: readRevision(payload.token),
        username: context.user?.username
      })
    );

    return {
      ...result,
      module: await readModuleInfo({
        maxLayer: readMaxLayer(context),
        path: result.requestPath,
        projectRoot: context.projectRoot,
        runtimeParams: context.runtimeParams,
        stateSystem: context.stateSystem,
        username: context.user?.username
      })
    };
  } catch (error) {
    throw createHttpError(error.message || "Module install failed.", Number(error.statusCode) || 500);
  }
}
