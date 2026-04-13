import { createHttpError } from "../lib/customware/file_access.js";
import { listInstalledModules } from "../lib/customware/module_manage.js";

function readListArea(context) {
  return String(context.params.area || "").trim();
}

function readListOwnerId(context) {
  return String(
    context.params.ownerId ||
      context.params.owner_id ||
      context.params.username ||
      ""
  ).trim();
}

function readListSearch(context) {
  return String(context.params.search || "").trim();
}

export async function get(context) {
  try {
    return await listInstalledModules({
      area: readListArea(context),
      ownerId: readListOwnerId(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      search: readListSearch(context),
      stateSystem: context.stateSystem,
      username: context.user?.username,
    });
  } catch (error) {
    throw createHttpError(error.message || "Module list failed.", Number(error.statusCode) || 500);
  }
}
