import { createHttpError } from "../lib/customware/file_access.js";
import { normalizeMaxLayer } from "../lib/customware/layer_limit.js";
import { readBundleInfo } from "../lib/customware/module_manage.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readInfoPath(context) {
  const payload = readPayload(context);

  return String(
    context.params.path ||
      context.params.modulePath ||
      context.params.module_path ||
      payload.path ||
      payload.modulePath ||
      payload.module_path ||
      ""
  );
}

function readMaxLayer(context) {
  const payload = readPayload(context);

  return normalizeMaxLayer(payload.maxLayer ?? context.params.maxLayer);
}

function readOwnerId(context) {
  const payload = readPayload(context);

  return String(
    payload.ownerId ||
      payload.owner_id ||
      payload.username ||
      context.params.ownerId ||
      context.params.owner_id ||
      context.params.username ||
      ""
  ).trim();
}

async function read(context) {
  try {
    return await readBundleInfo({
      maxLayer: readMaxLayer(context),
      ownerId: readOwnerId(context),
      path: readInfoPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      stateSystem: context.stateSystem,
      username: context.user?.username,
    });
  } catch (error) {
    throw createHttpError(error.message || "Bundle info lookup failed.", Number(error.statusCode) || 500);
  }
}

export async function get(context) {
  return read(context);
}

export async function post(context) {
  return read(context);
}
