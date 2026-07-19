import { createHttpError } from "../lib/customware/file_access.js";
import { listLayerHistoryCommits } from "../lib/customware/git_history.js";

function rethrowGitHistoryHttpError(error, fallbackMessage) {
  const httpError = createHttpError(error.message || fallbackMessage, Number(error.statusCode) || 500);
  httpError.cause = error;
  throw httpError;
}

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readPath(context) {
  const payload = readPayload(context);
  return String(payload.path || context.params.path || "~");
}

function readLimit(context) {
  const payload = readPayload(context);
  return payload.limit ?? context.params.limit;
}

function readOffset(context) {
  const payload = readPayload(context);
  return payload.offset ?? context.params.offset;
}

function readFileFilter(context) {
  const payload = readPayload(context);
  return String(payload.fileFilter || payload.filter || context.params.fileFilter || context.params.filter || "");
}

async function handleList(context) {
  try {
    await context.ensureUserFileIndex?.(context.user?.username);
    return await listLayerHistoryCommits({
      fileFilter: readFileFilter(context),
      limit: readLimit(context),
      offset: readOffset(context),
      path: readPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username: context.user?.username,
      watchdog: context.watchdog
    });
  } catch (error) {
    rethrowGitHistoryHttpError(error, "Git history list failed.");
  }
}

export async function get(context) {
  return handleList(context);
}

export async function post(context) {
  return handleList(context);
}
