import path from "node:path";

import { createAppAccessController } from "../lib/customware/file_access.js";
import { isReservedAppProjectPath } from "../lib/customware/git_history.js";
import { getRuntimeGroupIndex } from "../lib/customware/group_runtime.js";
import {
  normalizeAppProjectPath,
  resolveProjectAbsolutePath
} from "../lib/customware/layout.js";
import { sendFile, sendJson, sendNotFound } from "./responses.js";

function decodeAppFetchPathSegment(segment) {
  const normalizedSegment = String(segment ?? "").replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  let decodedSegment;

  try {
    decodedSegment = decodeURIComponent(normalizedSegment);
  } catch {
    return null;
  }

  // Preserve URL path segment boundaries instead of letting encoded separators
  // turn into filesystem path separators during later normalization.
  if (
    decodedSegment.includes("/") ||
    decodedSegment.includes("\\") ||
    decodedSegment.includes("\0")
  ) {
    return null;
  }

  return decodedSegment;
}

function decodeAppFetchRequestPath(requestPath) {
  const rawPath = String(requestPath || "/");
  const decodedSegments = rawPath
    .split("/")
    .map((segment) => decodeAppFetchPathSegment(segment));

  return decodedSegments.includes(null) ? null : decodedSegments.join("/") || "/";
}

function resolveAppFetchProjectPath(requestPath, username) {
  const decodedRequestPath = decodeAppFetchRequestPath(requestPath);

  if (!decodedRequestPath) {
    return null;
  }

  const normalizedPath = path.posix.normalize(decodedRequestPath || "/");
  let appRelativePath;

  if (normalizedPath.startsWith("/~/")) {
    if (!username) return null;
    appRelativePath = `L2/${username}/${normalizedPath.slice(3)}`;
  } else if (/^\/(L0|L1|L2)\//.test(normalizedPath)) {
    appRelativePath = normalizedPath.slice(1);
  } else {
    return null;
  }

  const projectPath = normalizeAppProjectPath(appRelativePath);
  return projectPath && projectPath.startsWith("/app/") ? projectPath : null;
}

async function handleAppFetchRequest(res, requestPath, options = {}) {
  const { ensureUserFileIndex, projectRoot, runtimeParams, username, watchdog } = options;
  const projectPath = resolveAppFetchProjectPath(requestPath, username);

  if (!projectPath) {
    sendNotFound(res);
    return;
  }

  if (typeof ensureUserFileIndex === "function") {
    await ensureUserFileIndex(username);
  }

  if (isReservedAppProjectPath(projectPath)) {
    sendJson(res, 403, { error: "Access denied" });
    return;
  }

  const accessController = createAppAccessController({
    groupIndex: getRuntimeGroupIndex(watchdog, runtimeParams),
    runtimeParams,
    username
  });

  if (!accessController.canReadProjectPath(projectPath)) {
    sendJson(res, 403, { error: "Access denied" });
    return;
  }

  const absolutePath = resolveProjectAbsolutePath(projectRoot, projectPath, runtimeParams);
  sendFile(res, absolutePath);
}

export { handleAppFetchRequest };
