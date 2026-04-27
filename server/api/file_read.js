import { createHttpError, readAppFile, readAppFiles } from "../lib/customware/file_access.js";
import { resolveRequestMaxLayer } from "../lib/customware/layer_limit.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readPath(context) {
  const payload = readPayload(context);
  return String(payload.path || context.params.path || "");
}

function readEncoding(context) {
  const payload = readPayload(context);
  return String(payload.encoding || context.params.encoding || "utf8");
}

function hasBatchRead(payload) {
  return Boolean(payload) && typeof payload === "object" && Array.isArray(payload.files);
}

function readIfExistsFlag(context) {
  const payload = readPayload(context);
  if (payload.ifExists === true) {
    return true;
  }
  // GET requests carry the option as a query parameter so the helper
  // signature `fileRead(path, encoding, { ifExists: true })` keeps its
  // single-path GET form without forcing every idempotent read into POST.
  const queryValue = context.params?.ifExists ?? context.params?.if_exists;
  if (queryValue === undefined || queryValue === null) {
    return false;
  }
  const normalizedQueryValue = String(queryValue).trim().toLowerCase();
  return normalizedQueryValue === "1" || normalizedQueryValue === "true";
}

async function handleRead(context) {
  const payload = readPayload(context);
  const maxLayer = resolveRequestMaxLayer({
    body: payload,
    headers: context.headers,
    requestUrl: context.requestUrl
  });
  // `ifExists: true` opts into idempotent read semantics: missing paths
  // resolve to a 200 response with the path listed under `skipped`
  // (singular form returns `content: null`) instead of throwing 404.
  // Strict callers (default) keep their authoritative 404 so user-facing
  // reads can still surface a real "this resource is gone" diagnostic.
  const ifExists = readIfExistsFlag(context);

  try {
    await context.ensureUserFileIndex?.(context.user?.username);
    const options = {
      encoding: readEncoding(context),
      ifExists,
      maxLayer,
      path: readPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username: context.user?.username,
      watchdog: context.watchdog
    };

    if (hasBatchRead(payload)) {
      return readAppFiles({
        ...options,
        files: payload.files
      });
    }

    return readAppFile(options);
  } catch (error) {
    throw createHttpError(error.message || "File read failed.", Number(error.statusCode) || 500);
  }
}

export async function get(context) {
  return handleRead(context);
}

export async function post(context) {
  return handleRead(context);
}
