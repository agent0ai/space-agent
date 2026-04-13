import { createHttpError } from "../lib/customware/file_access.js";
import { normalizeMaxLayer } from "../lib/customware/layer_limit.js";
import { readModuleInfo } from "../lib/customware/module_manage.js";

function readOptionalBoolean(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();

  if (!normalizedValue) {
    return false;
  }

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  throw createHttpError(`Invalid boolean value: ${String(value || "")}`, 400);
}

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

function readIncludeOtherUsers(context) {
  const payload = readPayload(context);

  return readOptionalBoolean(
    payload.includeOtherUsers ??
      payload.include_other_users ??
      context.params.includeOtherUsers ??
      context.params.include_other_users
  );
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

export async function get(context) {
  try {
    return await readModuleInfo({
      includeOtherUsers: readIncludeOtherUsers(context),
      maxLayer: readMaxLayer(context),
      ownerId: readOwnerId(context),
      path: readInfoPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      stateSystem: context.stateSystem,
      username: context.user?.username,
    });
  } catch (error) {
    throw createHttpError(error.message || "Module info lookup failed.", Number(error.statusCode) || 500);
  }
}
