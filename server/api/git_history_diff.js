import { createHttpError } from "../lib/customware/file_access.js";
import { getLayerHistoryCommitDiff } from "../lib/customware/git_history.js";

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

function readCommitHash(context) {
  const payload = readPayload(context);

  return String(
    payload.commitHash ||
      payload.commit ||
      payload.hash ||
      context.params.commitHash ||
      context.params.commit ||
      context.params.hash ||
      ""
  );
}

function readFilePath(context) {
  const payload = readPayload(context);

  return String(
    payload.filePath ||
      payload.file ||
      payload.pathWithinCommit ||
      context.params.filePath ||
      context.params.file ||
      context.params.pathWithinCommit ||
      ""
  );
}

async function handleDiff(context) {
  try {
    await context.ensureUserFileIndex?.(context.user?.username);
    return await getLayerHistoryCommitDiff({
      commitHash: readCommitHash(context),
      filePath: readFilePath(context),
      path: readPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username: context.user?.username,
      watchdog: context.watchdog
    });
  } catch (error) {
    rethrowGitHistoryHttpError(error, "Git history diff failed.");
  }
}

export async function get(context) {
  return handleDiff(context);
}

export async function post(context) {
  return handleDiff(context);
}
