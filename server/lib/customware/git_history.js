import fs from "node:fs";
import path from "node:path";

import {
  createLocalGitHistoryClient,
  normalizeCommitHash,
  normalizeHistoryLimit,
  normalizeHistoryOffset
} from "../git/local_history.js";
import { handleRuntimeAppPathMutations } from "../../runtime/app_path_mutations.js";
import { recordCapturedProjectPathMutations } from "../../runtime/mutation_capture.js";
import { getRuntimeGroupIndex } from "./group_runtime.js";
import {
  normalizeAppProjectPath,
  normalizeEntityId,
  parseAppProjectPath,
  resolveProjectAbsolutePath
} from "./layout.js";
import { invalidateUserFolderSizeCacheForProjectPaths } from "./user_quota.js";

const GIT_HISTORY_PARAM = "CUSTOMWARE_GIT_HISTORY";
const DEFAULT_COMMIT_DEBOUNCE_MS = 10_000;
const LONG_WAIT_DEBOUNCE_MS = 5_000;
const EXTENDED_WAIT_DEBOUNCE_MS = 1_000;
const LONG_WAIT_THRESHOLD_MS = 60_000;
const EXTENDED_WAIT_THRESHOLD_MS = 5 * 60_000;
const IMMEDIATE_WAIT_THRESHOLD_MS = 10 * 60_000;
const DEFAULT_AUTHOR_NAME = "Space Agent";
const DEFAULT_AUTHOR_EMAIL = "space-agent@local";
const USER_HISTORY_IGNORED_PATHS = [
  "meta/password.json",
  "meta/logins.json"
];
const pendingCommits = new Map();
let suppressionDepth = 0;

function createHistoryError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function stripTrailingSlash(value) {
  const text = String(value || "");
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

function isCustomwareGitHistoryEnabled(runtimeParams) {
  return Boolean(
    runtimeParams &&
      typeof runtimeParams.get === "function" &&
      runtimeParams.get(GIT_HISTORY_PARAM, false)
  );
}

function ensureCustomwareGitHistoryEnabled(runtimeParams) {
  if (!isCustomwareGitHistoryEnabled(runtimeParams)) {
    throw createHistoryError("Customware Git history is disabled.", 409);
  }
}

function resolveUserShorthandPath(inputPath, username) {
  const rawPath = String(inputPath || "").trim();

  if (!rawPath.startsWith("~")) {
    return rawPath;
  }

  if (!username) {
    throw createHistoryError("User-relative paths require an authenticated user.", 400);
  }

  if (rawPath === "~") {
    return `L2/${username}/`;
  }

  if (rawPath.startsWith("~/")) {
    return `L2/${username}/${rawPath.slice(2)}`;
  }

  throw createHistoryError(`Invalid user-relative path: ${rawPath}`, 400);
}

function toAppRelativePath(projectPath) {
  const normalizedProjectPath = normalizeAppProjectPath(projectPath, {
    allowAppRoot: true,
    isDirectory: String(projectPath || "").endsWith("/")
  });

  if (!normalizedProjectPath.startsWith("/app/")) {
    return "";
  }

  return normalizedProjectPath.slice("/app/".length);
}

function createHistoryAccessController(options = {}) {
  const groupIndex = getRuntimeGroupIndex(options.watchdog, options.runtimeParams);
  const username = normalizeEntityId(options.username);
  const managedGroups = new Set(
    groupIndex && typeof groupIndex.getManagedGroupsForUser === "function"
      ? groupIndex.getManagedGroupsForUser(username)
      : []
  );
  const isAdmin = Boolean(
    username &&
      groupIndex &&
      typeof groupIndex.isUserInGroup === "function" &&
      groupIndex.isUserInGroup(username, "_admin")
  );

  function canReadProjectPath(projectPath) {
    const pathInfo = parseAppProjectPath(projectPath);

    if (!pathInfo || pathInfo.kind !== "owner-path") {
      return false;
    }

    if (pathInfo.ownerType === "user") {
      return Boolean(username && pathInfo.ownerId === username);
    }

    return Boolean(
      groupIndex &&
        typeof groupIndex.isUserInGroup === "function" &&
        groupIndex.isUserInGroup(username, pathInfo.ownerId)
    );
  }

  function canWriteProjectPath(projectPath) {
    const pathInfo = parseAppProjectPath(projectPath);

    if (!pathInfo || pathInfo.kind !== "owner-path") {
      return false;
    }

    if (pathInfo.layer === "L0") {
      return false;
    }

    if (isAdmin && (pathInfo.layer === "L1" || pathInfo.layer === "L2")) {
      return true;
    }

    if (pathInfo.ownerType === "user") {
      return Boolean(pathInfo.layer === "L2" && username && pathInfo.ownerId === username);
    }

    return Boolean(pathInfo.layer === "L1" && managedGroups.has(pathInfo.ownerId));
  }

  return {
    canReadProjectPath,
    canWriteProjectPath
  };
}

function isReservedAppProjectPath(projectPath) {
  const pathInfo = parseAppProjectPath(projectPath);

  if (!pathInfo || pathInfo.kind !== "owner-path") {
    return false;
  }

  return pathInfo.pathWithinOwner
    .split("/")
    .filter(Boolean)
    .includes(".git");
}

function resolveLayerHistoryTargetFromProjectPath(options = {}) {
  const projectPath = normalizeAppProjectPath(options.projectPath, {
    allowAppRoot: true,
    isDirectory: String(options.projectPath || "").endsWith("/")
  });
  const pathInfo = parseAppProjectPath(projectPath);

  if (
    !pathInfo ||
    pathInfo.kind !== "owner-path" ||
    !["L1", "L2"].includes(pathInfo.layer) ||
    isReservedAppProjectPath(projectPath)
  ) {
    return null;
  }

  const ownerProjectPath = `/app/${pathInfo.layer}/${pathInfo.ownerId}/`;
  const repoRoot = resolveProjectAbsolutePath(options.projectRoot, ownerProjectPath, options.runtimeParams);

  if (!repoRoot) {
    return null;
  }

  return {
    appPath: toAppRelativePath(ownerProjectPath),
    key: `${pathInfo.layer}:${pathInfo.ownerId}:${path.resolve(repoRoot)}`,
    layer: pathInfo.layer,
    ownerId: pathInfo.ownerId,
    ownerProjectPath,
    ownerType: pathInfo.ownerType,
    repoRoot: path.resolve(repoRoot),
    runtimeParams: options.runtimeParams,
    projectRoot: options.projectRoot
  };
}

function collectLayerHistoryTargets(options = {}, projectPaths = []) {
  const targetsByKey = new Map();

  for (const projectPath of Array.isArray(projectPaths) ? projectPaths : []) {
    const target = resolveLayerHistoryTargetFromProjectPath({
      projectPath,
      projectRoot: options.projectRoot,
      runtimeParams: options.runtimeParams
    });

    if (target) {
      targetsByKey.set(target.key, target);
    }
  }

  return [...targetsByKey.values()];
}

function getSortedWatchdogProjectPaths(watchdog) {
  if (watchdog && typeof watchdog.getPaths === "function") {
    return watchdog.getPaths();
  }

  if (watchdog && typeof watchdog.getIndex === "function") {
    return Object.keys(watchdog.getIndex("path_index") || Object.create(null))
      .sort((left, right) => left.localeCompare(right));
  }

  return [];
}

function canAccessLayerHistoryTarget(target, accessController, access = "read") {
  if (!target?.ownerProjectPath) {
    return false;
  }

  if (access === "write") {
    return accessController.canWriteProjectPath(target.ownerProjectPath);
  }

  return (
    accessController.canReadProjectPath(target.ownerProjectPath) ||
    accessController.canWriteProjectPath(target.ownerProjectPath)
  );
}

function listLayerHistoryRepositories(options = {}) {
  const username = normalizeEntityId(options.username);
  const access = String(options.access || "read").trim().toLowerCase() === "write" ? "write" : "read";
  const accessController = createHistoryAccessController({
    runtimeParams: options.runtimeParams,
    username,
    watchdog: options.watchdog
  });
  const targets = collectLayerHistoryTargets(
    {
      projectRoot: options.projectRoot,
      runtimeParams: options.runtimeParams
    },
    getSortedWatchdogProjectPaths(options.watchdog)
  );

  return targets
    .filter((target) => canAccessLayerHistoryTarget(target, accessController, access))
    .filter((target) => hasHistoryRepository(target))
    .sort((left, right) => left.appPath.localeCompare(right.appPath))
    .map((target) => ({
      layer: target.layer,
      ownerId: target.ownerId,
      ownerType: target.ownerType,
      path: target.appPath
    }));
}

function resolveLayerHistoryTargetForRequest(options = {}) {
  const username = normalizeEntityId(options.username);
  const requestedPath = String(options.path || "~").trim() || "~";
  const projectPath = normalizeAppProjectPath(resolveUserShorthandPath(requestedPath, username), {
    isDirectory: requestedPath.endsWith("/")
  });
  const target = resolveLayerHistoryTargetFromProjectPath({
    projectPath,
    projectRoot: options.projectRoot,
    runtimeParams: options.runtimeParams
  });

  if (!target) {
    throw createHistoryError("Git history is available only for writable L1 group and L2 user roots.", 400);
  }

  const accessController = createHistoryAccessController({
    runtimeParams: options.runtimeParams,
    username,
    watchdog: options.watchdog
  });
  const accessProjectPath = target.ownerProjectPath;

  if (options.access === "write") {
    if (!accessController.canWriteProjectPath(accessProjectPath)) {
      throw createHistoryError("Write access denied.", 403);
    }
  } else if (!accessController.canReadProjectPath(accessProjectPath) && !accessController.canWriteProjectPath(accessProjectPath)) {
    throw createHistoryError("Read access denied.", 403);
  }

  return target;
}

function getHistoryCommitMessage(target) {
  return `Update ${target.layer}/${target.ownerId}`;
}

function hasHistoryRepository(target) {
  return Boolean(target && target.repoRoot && fs.existsSync(path.join(target.repoRoot, ".git")));
}

function normalizeHistoryListResult(result, options = {}) {
  const commits = Array.isArray(result) ? result : Array.isArray(result?.commits) ? result.commits : [];
  const limit = normalizeHistoryLimit(options.limit);
  const offset = normalizeHistoryOffset(options.offset);

  return {
    commits,
    currentHash: String(result?.currentHash || commits[0]?.hash || ""),
    hasMore: Boolean(result?.hasMore),
    limit: Number.isFinite(Number(result?.limit)) ? Number(result.limit) : limit,
    offset: Number.isFinite(Number(result?.offset)) ? Number(result.offset) : offset,
    total: Number.isFinite(Number(result?.total)) ? Number(result.total) : null
  };
}

function resolveGitHistoryDebounceMs(waitingMs = 0, defaultDebounceMs = DEFAULT_COMMIT_DEBOUNCE_MS) {
  const baseDebounceMs = Math.max(0, Number(defaultDebounceMs) || 0);
  const normalizedWaitingMs = Math.max(0, Number(waitingMs) || 0);

  if (baseDebounceMs === 0 || normalizedWaitingMs >= IMMEDIATE_WAIT_THRESHOLD_MS) {
    return 0;
  }

  if (normalizedWaitingMs >= EXTENDED_WAIT_THRESHOLD_MS) {
    return Math.min(baseDebounceMs, EXTENDED_WAIT_DEBOUNCE_MS);
  }

  if (normalizedWaitingMs >= LONG_WAIT_THRESHOLD_MS) {
    return Math.min(baseDebounceMs, LONG_WAIT_DEBOUNCE_MS);
  }

  return baseDebounceMs;
}

function getHistoryIgnoredPaths(target) {
  if (target?.layer !== "L2") {
    return [];
  }

  return USER_HISTORY_IGNORED_PATHS;
}

function mergeGitignoreContent(currentContent, requiredEntries) {
  if (requiredEntries.length === 0) {
    return currentContent;
  }

  const currentLines = String(currentContent || "").split(/\r?\n/u);
  const currentEntries = new Set(currentLines.map((line) => line.trim()).filter(Boolean));
  const missingEntries = requiredEntries.filter((entry) => !currentEntries.has(entry));

  if (missingEntries.length === 0) {
    return currentContent;
  }

  const baseContent = String(currentContent || "");
  const prefix = baseContent && !baseContent.endsWith("\n") ? `${baseContent}\n` : baseContent;

  return `${prefix}${missingEntries.join("\n")}\n`;
}

function ensureHistoryIgnoreFile(target) {
  if (!target?.repoRoot) {
    return;
  }

  fs.mkdirSync(target.repoRoot, { recursive: true });

  const ignorePath = path.join(target.repoRoot, ".gitignore");
  const requiredEntries = getHistoryIgnoredPaths(target);

  if (target.layer === "L1" && requiredEntries.length === 0) {
    if (!fs.existsSync(ignorePath)) {
      fs.writeFileSync(ignorePath, "");
    }
    return;
  }

  const currentContent = fs.existsSync(ignorePath)
    ? fs.readFileSync(ignorePath, "utf8")
    : "";
  const nextContent = mergeGitignoreContent(currentContent, requiredEntries);

  if (nextContent !== currentContent || !fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, nextContent);
  }
}

function readIgnoredPathSnapshots(target) {
  const snapshots = [];

  for (const ignoredPath of getHistoryIgnoredPaths(target)) {
    const absolutePath = path.join(target.repoRoot, ignoredPath);

    if (!fs.existsSync(absolutePath)) {
      snapshots.push({
        absolutePath,
        exists: false
      });
      continue;
    }

    const stats = fs.statSync(absolutePath);
    snapshots.push({
      absolutePath,
      content: stats.isDirectory() ? null : fs.readFileSync(absolutePath),
      exists: true,
      isDirectory: stats.isDirectory(),
      mode: stats.mode
    });
  }

  return snapshots;
}

function restoreIgnoredPathSnapshots(snapshots) {
  for (const snapshot of snapshots) {
    if (!snapshot.exists) {
      fs.rmSync(snapshot.absolutePath, {
        force: true,
        recursive: true
      });
      continue;
    }

    if (snapshot.isDirectory) {
      fs.mkdirSync(snapshot.absolutePath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(snapshot.absolutePath), { recursive: true });
    fs.writeFileSync(snapshot.absolutePath, snapshot.content);
    fs.chmodSync(snapshot.absolutePath, snapshot.mode);
  }
}

async function commitLayerHistoryTarget(target) {
  try {
    ensureHistoryIgnoreFile(target);

    const client = await createLocalGitHistoryClient({
      repoRoot: target.repoRoot
    });
    const result = await client.commitAll({
      authorEmail: DEFAULT_AUTHOR_EMAIL,
      authorName: DEFAULT_AUTHOR_NAME,
      ignoredPaths: getHistoryIgnoredPaths(target),
      message: getHistoryCommitMessage(target)
    });

    return {
      ...result,
      path: target.appPath
    };
  } finally {
    invalidateUserFolderSizeCacheForProjectPaths(
      {
        projectRoot: target.projectRoot,
        runtimeParams: target.runtimeParams
      },
      [target.ownerProjectPath]
    );
  }
}

function scheduleLayerHistoryTarget(target, options = {}) {
  const now = Date.now();
  const currentEntry = pendingCommits.get(target.key);
  const firstScheduledAt = currentEntry?.firstScheduledAt || now;
  const debounceMs = resolveGitHistoryDebounceMs(
    now - firstScheduledAt,
    options.debounceMs ?? DEFAULT_COMMIT_DEBOUNCE_MS
  );

  if (currentEntry?.timer) {
    clearTimeout(currentEntry.timer);
  }

  const entry = {
    firstScheduledAt,
    target,
    timer: null
  };

  if (debounceMs === 0) {
    pendingCommits.delete(target.key);
    void commitLayerHistoryTarget(target).catch((error) => {
      console.error(`Failed to commit Git history for ${target.appPath}.`);
      console.error(error);
    });
    return;
  }

  entry.timer = setTimeout(() => {
    pendingCommits.delete(target.key);
    void commitLayerHistoryTarget(target).catch((error) => {
      console.error(`Failed to commit Git history for ${target.appPath}.`);
      console.error(error);
    });
  }, debounceMs);

  if (typeof entry.timer.unref === "function") {
    entry.timer.unref();
  }

  pendingCommits.set(target.key, entry);
}

function scheduleGitHistoryCommitsForProjectPaths(options = {}, projectPaths = []) {
  if (suppressionDepth > 0 || !isCustomwareGitHistoryEnabled(options.runtimeParams)) {
    return [];
  }

  const targets = collectLayerHistoryTargets(options, projectPaths);

  for (const target of targets) {
    scheduleLayerHistoryTarget(target, {
      debounceMs: options.debounceMs
    });
  }

  return targets;
}

function recordAppPathMutations(options = {}, projectPaths = []) {
  recordCapturedProjectPathMutations(projectPaths);

  if (!options.quotaCacheUpdated) {
    invalidateUserFolderSizeCacheForProjectPaths(
      {
        projectRoot: options.projectRoot,
        runtimeParams: options.runtimeParams
      },
      projectPaths
    );
  }

  if (handleRuntimeAppPathMutations(options, projectPaths)) {
    return [];
  }

  return scheduleGitHistoryCommitsForProjectPaths(options, projectPaths);
}

function clearPendingEntry(entry) {
  if (entry?.timer) {
    clearTimeout(entry.timer);
  }
}

async function flushGitHistoryTarget(target, options = {}) {
  const entry = pendingCommits.get(target.key);

  if (!entry) {
    return null;
  }

  clearPendingEntry(entry);
  pendingCommits.delete(target.key);

  try {
    return await commitLayerHistoryTarget(entry.target);
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }

    console.error(`Failed to flush Git history for ${entry.target.appPath}.`);
    console.error(error);
    return {
      error: error.message || "Git history flush failed.",
      path: entry.target.appPath
    };
  }
}

async function flushGitHistoryCommits(options = {}) {
  const entries = [...pendingCommits.values()];
  const results = [];

  for (const entry of entries) {
    results.push(await flushGitHistoryTarget(entry.target, options));
  }

  return results.filter(Boolean);
}

async function withGitHistorySuppressed(callback) {
  suppressionDepth += 1;

  try {
    return await callback();
  } finally {
    suppressionDepth -= 1;
  }
}

async function listLayerHistoryCommits(options = {}) {
  ensureCustomwareGitHistoryEnabled(options.runtimeParams);
  const target = resolveLayerHistoryTargetForRequest({
    ...options,
    access: "read"
  });

  if (!hasHistoryRepository(target)) {
    return {
      backend: "",
      commits: [],
      currentHash: "",
      enabled: true,
      hasMore: false,
      limit: normalizeHistoryLimit(options.limit),
      offset: normalizeHistoryOffset(options.offset),
      path: target.appPath
    };
  }

  const client = await createLocalGitHistoryClient({
    repoRoot: target.repoRoot
  });
  const listResult = normalizeHistoryListResult(
    await client.listCommits({
      fileFilter: options.fileFilter,
      ignoredPaths: getHistoryIgnoredPaths(target),
      limit: normalizeHistoryLimit(options.limit),
      offset: normalizeHistoryOffset(options.offset)
    }),
    options
  );

  return {
    backend: client.name,
    commits: listResult.commits,
    currentHash: listResult.currentHash,
    enabled: true,
    hasMore: listResult.hasMore,
    limit: listResult.limit,
    offset: listResult.offset,
    total: listResult.total,
    path: target.appPath
  };
}

async function getLayerHistoryCommitDiff(options = {}) {
  ensureCustomwareGitHistoryEnabled(options.runtimeParams);
  const target = resolveLayerHistoryTargetForRequest({
    ...options,
    access: "read"
  });

  if (!hasHistoryRepository(target)) {
    throw createHistoryError(`Git history repository not found for ${stripTrailingSlash(target.appPath)}.`, 404);
  }

  const commitHash = normalizeCommitHash(options.commitHash);
  const client = await createLocalGitHistoryClient({
    repoRoot: target.repoRoot
  });

  return {
    ...(await client.getCommitDiff({
      commitHash,
      filePath: options.filePath || options.pathWithinCommit || options.file,
      ignoredPaths: getHistoryIgnoredPaths(target)
    })),
    path: target.appPath
  };
}

async function getLayerHistoryOperationPreview(options = {}) {
  ensureCustomwareGitHistoryEnabled(options.runtimeParams);
  const target = resolveLayerHistoryTargetForRequest({
    ...options,
    access: "write"
  });

  if (!hasHistoryRepository(target)) {
    throw createHistoryError(`Git history repository not found for ${stripTrailingSlash(target.appPath)}.`, 404);
  }

  const commitHash = normalizeCommitHash(options.commitHash);
  await flushGitHistoryTarget(target, {
    throwOnError: true
  });

  const client = await createLocalGitHistoryClient({
    repoRoot: target.repoRoot
  });

  return {
    ...(await client.previewOperation({
      commitHash,
      filePath: options.filePath || options.pathWithinCommit || options.file,
      ignoredPaths: getHistoryIgnoredPaths(target),
      operation: options.operation
    })),
    path: target.appPath
  };
}

async function rollbackLayerHistory(options = {}) {
  ensureCustomwareGitHistoryEnabled(options.runtimeParams);
  const target = resolveLayerHistoryTargetForRequest({
    ...options,
    access: "write"
  });

  if (!hasHistoryRepository(target)) {
    throw createHistoryError(`Git history repository not found for ${stripTrailingSlash(target.appPath)}.`, 404);
  }

  const commitHash = normalizeCommitHash(options.commitHash);
  await flushGitHistoryTarget(target, {
    throwOnError: true
  });

  const ignoredPathSnapshots = readIgnoredPathSnapshots(target);

  const result = await withGitHistorySuppressed(async () => {
    const client = await createLocalGitHistoryClient({
      repoRoot: target.repoRoot
    });

    try {
      return await client.rollbackToCommit({
        commitHash
      });
    } finally {
      restoreIgnoredPathSnapshots(ignoredPathSnapshots);
      ensureHistoryIgnoreFile(target);
    }
  });
  invalidateUserFolderSizeCacheForProjectPaths(
    {
      projectRoot: target.projectRoot,
      runtimeParams: target.runtimeParams
    },
    [target.ownerProjectPath]
  );
  recordAppPathMutations(
    {
      projectRoot: target.projectRoot,
      runtimeParams: target.runtimeParams
    },
    [target.ownerProjectPath]
  );

  return {
    ...result,
    path: target.appPath
  };
}

async function revertLayerHistoryCommit(options = {}) {
  ensureCustomwareGitHistoryEnabled(options.runtimeParams);
  const target = resolveLayerHistoryTargetForRequest({
    ...options,
    access: "write"
  });

  if (!hasHistoryRepository(target)) {
    throw createHistoryError(`Git history repository not found for ${stripTrailingSlash(target.appPath)}.`, 404);
  }

  const commitHash = normalizeCommitHash(options.commitHash);
  await flushGitHistoryTarget(target, {
    throwOnError: true
  });

  const ignoredPathSnapshots = readIgnoredPathSnapshots(target);

  const result = await withGitHistorySuppressed(async () => {
    const client = await createLocalGitHistoryClient({
      repoRoot: target.repoRoot
    });

    try {
      return await client.revertCommit({
        authorEmail: DEFAULT_AUTHOR_EMAIL,
        authorName: DEFAULT_AUTHOR_NAME,
        commitHash
      });
    } finally {
      restoreIgnoredPathSnapshots(ignoredPathSnapshots);
      ensureHistoryIgnoreFile(target);
    }
  });
  invalidateUserFolderSizeCacheForProjectPaths(
    {
      projectRoot: target.projectRoot,
      runtimeParams: target.runtimeParams
    },
    [target.ownerProjectPath]
  );
  recordAppPathMutations(
    {
      projectRoot: target.projectRoot,
      runtimeParams: target.runtimeParams
    },
    [target.ownerProjectPath]
  );

  return {
    ...result,
    path: target.appPath
  };
}

export {
  DEFAULT_COMMIT_DEBOUNCE_MS,
  ensureCustomwareGitHistoryEnabled,
  flushGitHistoryCommits,
  getLayerHistoryCommitDiff,
  getLayerHistoryOperationPreview,
  isCustomwareGitHistoryEnabled,
  isReservedAppProjectPath,
  listLayerHistoryRepositories,
  listLayerHistoryCommits,
  recordAppPathMutations,
  scheduleGitHistoryCommitsForProjectPaths,
  revertLayerHistoryCommit,
  resolveLayerHistoryTargetForRequest,
  resolveGitHistoryDebounceMs,
  rollbackLayerHistory,
  withGitHistorySuppressed
};
