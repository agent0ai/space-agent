import { isGuestUsername } from "../lib/auth/user_manage.js";

function getPathIndex(watchdog) {
  return watchdog && typeof watchdog.getIndex === "function"
    ? watchdog.getIndex("path_index") || Object.create(null)
    : Object.create(null);
}

function getUserIndex(watchdog) {
  return watchdog && typeof watchdog.getIndex === "function"
    ? watchdog.getIndex("user_index") || null
    : null;
}

function listGuestUsernames(watchdog) {
  const userIndex = getUserIndex(watchdog);
  const usernames = Object.keys(userIndex?.users || Object.create(null)).filter(isGuestUsername);
  usernames.sort((left, right) => left.localeCompare(right));
  return usernames;
}

function collectGuestFileStats(watchdog, username) {
  const normalizedUsername = String(username || "").trim();
  const pathIndex = getPathIndex(watchdog);
  const userRoot = `/app/L2/${normalizedUsername}/`;
  let fileCount = 0;
  let latestAnyMtimeMs = 0;
  let latestFileMtimeMs = 0;
  let totalSizeBytes = 0;

  Object.entries(pathIndex).forEach(([projectPath, metadata]) => {
    if (!String(projectPath || "").startsWith(userRoot)) {
      return;
    }

    const entry = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    const mtimeMs = Math.trunc(Number(entry.mtimeMs) || 0);

    if (mtimeMs > latestAnyMtimeMs) {
      latestAnyMtimeMs = mtimeMs;
    }

    if (entry.isDirectory) {
      return;
    }

    fileCount += 1;
    totalSizeBytes += Number(entry.sizeBytes) || 0;

    if (mtimeMs > latestFileMtimeMs) {
      latestFileMtimeMs = mtimeMs;
    }
  });

  return {
    fileCount,
    latestChangeMs: latestFileMtimeMs || latestAnyMtimeMs,
    latestFileMtimeMs,
    totalSizeBytes,
    username: normalizedUsername
  };
}

export { collectGuestFileStats, listGuestUsernames };
