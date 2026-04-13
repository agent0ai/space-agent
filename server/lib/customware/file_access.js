import fs from "node:fs";
import path from "node:path";

import { createRuntimeGroupIndex, getRuntimeGroupIndex } from "./group_runtime.js";
import {
  isReservedAppProjectPath,
  listLayerHistoryRepositories,
  recordAppPathMutations
} from "./git_history.js";
import {
  normalizeAppProjectPath,
  normalizeEntityId,
  parseAppProjectPath,
  resolveProjectAbsolutePath
} from "./layout.js";
import {
  applyUserFolderQuotaPlan,
  createUserFolderQuotaPlan,
  invalidateUserFolderSizeCacheForProjectPaths,
  readAbsolutePathSize
} from "./user_quota.js";
import { createEmptyGroupIndex } from "./overrides.js";
import { globToRegExp, normalizePathSegment } from "../utils/app_files.js";
import { isProjectPathWithinMaxLayer, normalizeMaxLayer } from "./layer_limit.js";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function stripTrailingSlash(value) {
  const text = String(value || "");
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

function resolveUserShorthandPath(inputPath, username) {
  const rawPath = String(inputPath || "").trim();

  if (!rawPath.startsWith("~")) {
    return rawPath;
  }

  if (!username) {
    throw createHttpError("User-relative paths require an authenticated user.", 400);
  }

  if (rawPath === "~") {
    return `L2/${username}/`;
  }

  if (rawPath.startsWith("~/")) {
    return `L2/${username}/${rawPath.slice(2)}`;
  }

  throw createHttpError(`Invalid user-relative path: ${rawPath}`, 400);
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

function getGroupIndex(watchdog, runtimeParams) {
  return getRuntimeGroupIndex(watchdog, runtimeParams);
}

function getPathIndex(watchdog) {
  if (!watchdog || typeof watchdog.getIndex !== "function") {
    return Object.create(null);
  }

  return watchdog.getIndex("path_index") || Object.create(null);
}

function getSortedProjectPaths(watchdog) {
  if (watchdog && typeof watchdog.getPaths === "function") {
    return watchdog.getPaths();
  }

  return Object.keys(getPathIndex(watchdog)).sort((left, right) => left.localeCompare(right));
}

function hasPath(pathIndex, projectPath) {
  return Boolean(pathIndex && projectPath && pathIndex[projectPath]);
}

function hasExistingProjectPathConflict(pathIndex, projectPath) {
  const baseProjectPath = stripTrailingSlash(projectPath);

  return Boolean(
    baseProjectPath && (hasPath(pathIndex, baseProjectPath) || hasPath(pathIndex, `${baseProjectPath}/`))
  );
}

function normalizeFilePathPattern(value) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    throw createHttpError("File pattern must not be empty.", 400);
  }

  try {
    const normalizedPattern = normalizePathSegment(rawValue);

    if (!normalizedPattern) {
      throw new Error("Empty file pattern.");
    }

    return normalizedPattern;
  } catch {
    throw createHttpError(`Invalid file pattern: ${rawValue}`, 400);
  }
}

function compileFilePathPatterns(patterns) {
  const compiledPatterns = [];
  const seenPatterns = new Set();

  for (const value of Array.isArray(patterns) ? patterns : []) {
    const sourcePattern = String(value ?? "").trim();
    const normalizedPattern = normalizeFilePathPattern(sourcePattern);

    if (seenPatterns.has(sourcePattern)) {
      continue;
    }

    seenPatterns.add(sourcePattern);
    compiledPatterns.push({
      matcher: globToRegExp(normalizedPattern),
      sourcePattern
    });
  }

  return compiledPatterns;
}

function normalizeAccessMode(value = "read") {
  const rawValue = String(value || "read").trim().toLowerCase();

  if (!rawValue || rawValue === "read" || rawValue === "readable") {
    return "read";
  }

  if (rawValue === "write" || rawValue === "writable") {
    return "write";
  }

  throw createHttpError(`Unsupported access mode: ${String(value || "")}`, 400);
}

function ensureProjectPathAccess(projectPath, accessController, accessMode = "read") {
  if (accessMode === "write") {
    ensureWritableProjectPath(projectPath, accessController);
    return;
  }

  ensureReadableProjectPath(projectPath, accessController);
}

function canAccessProjectPath(projectPath, accessController, accessMode = "read") {
  if (accessMode === "write") {
    return accessController.canWriteProjectPath(projectPath);
  }

  return accessController.canReadProjectPath(projectPath);
}

function listReadableGroupIds(username, groupIndex) {
  const normalizedUsername = normalizeEntityId(username);
  const orderedGroups =
    groupIndex && typeof groupIndex.getOrderedGroupsForUser === "function"
      ? groupIndex.getOrderedGroupsForUser(normalizedUsername)
      : [];
  const groupIds = [];

  if (
    groupIndex &&
    typeof groupIndex.isUserInGroup === "function" &&
    groupIndex.isUserInGroup(normalizedUsername, "_all")
  ) {
    groupIds.push("_all");
  }

  for (const groupId of orderedGroups) {
    if (groupId && groupId !== "_all") {
      groupIds.push(groupId);
    }
  }

  return groupIds;
}

function createReadableOwnerScopes(options = {}) {
  const normalizedUsername = normalizeEntityId(options.username);
  const groupIds = listReadableGroupIds(
    normalizedUsername,
    createRuntimeGroupIndex(options.groupIndex || createEmptyGroupIndex(), options.runtimeParams)
  );
  const ownerScopes = [];
  let rank = 0;

  for (const groupId of groupIds) {
    ownerScopes.push({
      rank,
      rootPath: `/app/L0/${groupId}/`
    });
    rank += 1;
  }

  for (const groupId of groupIds) {
    ownerScopes.push({
      rank,
      rootPath: `/app/L1/${groupId}/`
    });
    rank += 1;
  }

  if (normalizedUsername) {
    ownerScopes.push({
      rank,
      rootPath: `/app/L2/${normalizedUsername}/`
    });
  }

  return ownerScopes;
}

function createWritableOwnerScopes(options = {}) {
  const accessController = createAppAccessController({
    groupIndex: options.groupIndex,
    runtimeParams: options.runtimeParams,
    username: options.username
  });
  const ownerRootPaths = new Set();

  for (const projectPath of getSortedProjectPaths(options.watchdog)) {
    const pathInfo = parseAppProjectPath(projectPath);

    if (!pathInfo || pathInfo.kind !== "owner-path" || !["L1", "L2"].includes(pathInfo.layer)) {
      continue;
    }

    const ownerProjectPath = `/app/${pathInfo.layer}/${pathInfo.ownerId}/`;

    if (accessController.canWriteProjectPath(ownerProjectPath)) {
      ownerRootPaths.add(ownerProjectPath);
    }
  }

  return [...ownerRootPaths]
    .sort((left, right) => left.localeCompare(right))
    .map((rootPath, rank) => ({
      rank,
      rootPath
    }));
}

function findOwnerScope(projectPath, ownerScopes) {
  return ownerScopes.find((ownerScope) => projectPath.startsWith(ownerScope.rootPath)) || null;
}

function createAppAccessController(options = {}) {
  const groupIndex = createRuntimeGroupIndex(
    options.groupIndex || createEmptyGroupIndex(),
    options.runtimeParams
  );
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
    canWriteProjectPath,
    isAdmin,
    managedGroups,
    username
  };
}

function ensureReadableProjectPath(projectPath, accessController) {
  if (!accessController.canReadProjectPath(projectPath)) {
    throw createHttpError("Read access denied.", 403);
  }
}

function ensureWritableProjectPath(projectPath, accessController) {
  if (isReservedAppProjectPath(projectPath)) {
    throw createHttpError("App-file access to Git metadata is not allowed.", 403);
  }

  if (!accessController.canWriteProjectPath(projectPath)) {
    throw createHttpError("Write access denied.", 403);
  }
}

function ensurePublicAppProjectPath(projectPath) {
  if (isReservedAppProjectPath(projectPath)) {
    throw createHttpError("App-file access to Git metadata is not allowed.", 403);
  }
}

function resolveExistingProjectPath(pathIndex, inputPath) {
  const rawInput = String(inputPath || "").trim();
  const fileProjectPath = normalizeAppProjectPath(rawInput);
  const directoryProjectPath = normalizeAppProjectPath(rawInput, {
    allowAppRoot: true,
    isDirectory: true
  });
  const prefersDirectory = rawInput.endsWith("/");

  if (prefersDirectory && directoryProjectPath && hasPath(pathIndex, directoryProjectPath)) {
    return {
      exists: true,
      isDirectory: true,
      projectPath: directoryProjectPath
    };
  }

  if (fileProjectPath && hasPath(pathIndex, fileProjectPath)) {
    return {
      exists: true,
      isDirectory: false,
      projectPath: fileProjectPath
    };
  }

  if (directoryProjectPath && hasPath(pathIndex, directoryProjectPath)) {
    return {
      exists: true,
      isDirectory: true,
      projectPath: directoryProjectPath
    };
  }

  return {
    exists: false,
    isDirectory: prefersDirectory,
    projectPath: prefersDirectory ? directoryProjectPath : fileProjectPath
  };
}

function createAbsolutePath(projectRoot, projectPath, runtimeParams) {
  return resolveProjectAbsolutePath(projectRoot, projectPath, runtimeParams);
}

function createQuotaPlan(options = {}, deltas = []) {
  return createUserFolderQuotaPlan(
    {
      projectRoot: options.projectRoot,
      runtimeParams: options.runtimeParams
    },
    deltas
  );
}

function invalidateQuotaDeltas(options = {}, deltas = []) {
  invalidateUserFolderSizeCacheForProjectPaths(
    {
      projectRoot: options.projectRoot,
      runtimeParams: options.runtimeParams
    },
    deltas.map((delta) => delta.projectPath)
  );
}

function getWriteQuotaDeltas(requests) {
  return requests.map((request) => ({
    deltaBytes: request.isDirectory
      ? 0
      : request.buffer.length - readAbsolutePathSize(request.absolutePath),
    projectPath: request.projectPath
  }));
}

function getCopyQuotaDeltas(requests) {
  return requests.map((request) => ({
    deltaBytes: readAbsolutePathSize(request.sourceAbsolutePath),
    projectPath: request.destinationProjectPath
  }));
}

function getMoveQuotaDeltas(requests) {
  return requests.flatMap((request) => {
    const movedBytes = readAbsolutePathSize(request.sourceAbsolutePath);

    if (request.sourceProjectPath === request.destinationProjectPath) {
      return [
        {
          deltaBytes: 0,
          projectPath: request.sourceProjectPath
        }
      ];
    }

    return [
      {
        deltaBytes: -movedBytes,
        projectPath: request.sourceProjectPath
      },
      {
        deltaBytes: movedBytes,
        projectPath: request.destinationProjectPath
      }
    ];
  });
}

function getDeleteQuotaDeltas(requests) {
  return requests.map((request) => ({
    deltaBytes: -readAbsolutePathSize(request.absolutePath),
    projectPath: request.projectPath
  }));
}

function getParentDirectoryProjectPath(projectPath) {
  const normalizedProjectPath = stripTrailingSlash(String(projectPath || ""));

  if (!normalizedProjectPath || normalizedProjectPath === "/app") {
    return "";
  }

  const lastSlashIndex = normalizedProjectPath.lastIndexOf("/");

  if (lastSlashIndex <= 0) {
    return "";
  }

  return `${normalizedProjectPath.slice(0, lastSlashIndex)}/`;
}

function ensureValidReadEncoding(encoding) {
  if (encoding === "utf8" || encoding === "base64") {
    return encoding;
  }

  throw createHttpError(`Unsupported read encoding: ${String(encoding || "")}`, 400);
}

function ensureValidWriteEncoding(encoding) {
  if (encoding === "utf8" || encoding === "base64") {
    return encoding;
  }

  throw createHttpError(`Unsupported write encoding: ${String(encoding || "")}`, 400);
}

function normalizeReadEntries(options = {}) {
  if (Array.isArray(options.files)) {
    if (options.files.length === 0) {
      throw createHttpError("File read batch must not be empty.", 400);
    }

    return options.files;
  }

  if ("files" in options) {
    throw createHttpError("File read batch must provide a files array.", 400);
  }

  return [
    {
      encoding: options.encoding,
      path: options.path
    }
  ];
}

function normalizeReadRequests(options = {}) {
  const pathIndex = getPathIndex(options.watchdog);
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });
  const entries = normalizeReadEntries(options);

  return entries.map((entry) => {
    const request = isPlainObject(entry) ? entry : { path: entry };
    const requestedPath = String(request.path || "").trim();

    if (!requestedPath) {
      throw createHttpError("File path must not be empty.", 400);
    }

    const resolvedPath = resolveExistingProjectPath(
      pathIndex,
      resolveUserShorthandPath(requestedPath, accessController.username)
    );

    if (!resolvedPath.projectPath || !resolvedPath.exists) {
      throw createHttpError(`File not found: ${requestedPath}`, 404);
    }

    if (resolvedPath.isDirectory) {
      throw createHttpError(`Expected a file path: ${requestedPath}`, 400);
    }

    ensurePublicAppProjectPath(resolvedPath.projectPath);
    ensureReadableProjectPath(resolvedPath.projectPath, accessController);

    return {
      absolutePath: createAbsolutePath(
        String(options.projectRoot || ""),
        resolvedPath.projectPath,
        options.runtimeParams
      ),
      encoding: ensureValidReadEncoding(String(request.encoding || options.encoding || "utf8").toLowerCase()),
      path: toAppRelativePath(resolvedPath.projectPath)
    };
  });
}

function readAppFiles(options = {}) {
  const requests = normalizeReadRequests(options);
  const files = requests.map((request) => {
    const buffer = fs.readFileSync(request.absolutePath);

    return {
      content: request.encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf8"),
      encoding: request.encoding,
      path: request.path
    };
  });

  return {
    count: files.length,
    files
  };
}

function readAppFile(options = {}) {
  return readAppFiles(options).files[0];
}

function resolveReadableExistingAppPath(options = {}) {
  const pathIndex = getPathIndex(options.watchdog);
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });
  const requestedPath = String(options.path || "").trim();

  if (!requestedPath) {
    throw createHttpError("Path must not be empty.", 400);
  }

  const resolvedPath = resolveExistingProjectPath(
    pathIndex,
    resolveUserShorthandPath(requestedPath, accessController.username)
  );

  if (!resolvedPath.projectPath || !resolvedPath.exists) {
    throw createHttpError(`Path not found: ${requestedPath}`, 404);
  }

  if (options.expectedKind === "directory" && !resolvedPath.isDirectory) {
    throw createHttpError(`Expected a folder path: ${requestedPath}`, 400);
  }

  if (options.expectedKind === "file" && resolvedPath.isDirectory) {
    throw createHttpError(`Expected a file path: ${requestedPath}`, 400);
  }

  ensurePublicAppProjectPath(resolvedPath.projectPath);
  ensureReadableProjectPath(resolvedPath.projectPath, accessController);

  return {
    absolutePath: createAbsolutePath(
      String(options.projectRoot || ""),
      resolvedPath.projectPath,
      options.runtimeParams
    ),
    isDirectory: resolvedPath.isDirectory,
    path: toAppRelativePath(resolvedPath.projectPath),
    projectPath: resolvedPath.projectPath,
    requestedPath
  };
}

function getAppPathInfo(options = {}) {
  const resolvedPath = resolveReadableExistingAppPath(options);
  const stats = fs.statSync(resolvedPath.absolutePath);

  return {
    isDirectory: stats.isDirectory(),
    modifiedAt: stats.mtime.toISOString(),
    path: resolvedPath.path,
    size: Number(stats.size) || 0
  };
}

function getAppFolderDownloadInfo(options = {}) {
  const resolvedPath = resolveReadableExistingAppPath({
    ...options,
    expectedKind: "directory"
  });

  return {
    absolutePath: resolvedPath.absolutePath,
    directoryName:
      path.basename(stripTrailingSlash(resolvedPath.absolutePath)) ||
      path.basename(stripTrailingSlash(resolvedPath.path)) ||
      "download",
    path: resolvedPath.path
  };
}

function normalizeWriteEntries(options = {}) {
  if (Array.isArray(options.files)) {
    if (options.files.length === 0) {
      throw createHttpError("File write batch must not be empty.", 400);
    }

    return options.files;
  }

  if ("files" in options) {
    throw createHttpError("File write batch must provide a files array.", 400);
  }

  return [
    {
      content: options.content,
      encoding: options.encoding,
      path: options.path
    }
  ];
}

function normalizeWriteRequests(options = {}) {
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });
  const entries = normalizeWriteEntries(options);
  const seenProjectPaths = new Set();

  return entries.map((entry) => {
    if (!isPlainObject(entry)) {
      throw createHttpError("Each file write entry must be an object.", 400);
    }

    const requestedPath = String(entry.path || "").trim();
    const isDirectory = requestedPath.endsWith("/");
    const normalizedProjectPath = normalizeAppProjectPath(
      resolveUserShorthandPath(requestedPath, accessController.username),
      {
        isDirectory
      }
    );

    if (!normalizedProjectPath) {
      throw createHttpError(`Expected a writable path: ${requestedPath || "(empty)"}`, 400);
    }

    if (seenProjectPaths.has(normalizedProjectPath)) {
      throw createHttpError(`Duplicate file write path: ${toAppRelativePath(normalizedProjectPath)}`, 400);
    }

    seenProjectPaths.add(normalizedProjectPath);
    ensurePublicAppProjectPath(normalizedProjectPath);
    ensureWritableProjectPath(normalizedProjectPath, accessController);

    if (isDirectory) {
      const content = entry.content;

      if (content !== undefined && content !== null && content !== "") {
        throw createHttpError(`Directory writes do not accept content: ${requestedPath}`, 400);
      }

      return {
        absolutePath: createAbsolutePath(
          String(options.projectRoot || ""),
          normalizedProjectPath,
          options.runtimeParams
        ),
        isDirectory: true,
        path: toAppRelativePath(normalizedProjectPath),
        projectPath: normalizedProjectPath
      };
    }

    const encoding = ensureValidWriteEncoding(String(entry.encoding || options.encoding || "utf8").toLowerCase());
    const buffer =
      encoding === "base64"
        ? Buffer.from(String(entry.content ?? ""), "base64")
        : Buffer.from(String(entry.content ?? ""), "utf8");

    return {
      absolutePath: createAbsolutePath(
        String(options.projectRoot || ""),
        normalizedProjectPath,
        options.runtimeParams
      ),
      buffer,
      encoding,
      isDirectory: false,
      path: toAppRelativePath(normalizedProjectPath),
      projectPath: normalizedProjectPath
    };
  });
}

function writeAppFiles(options = {}) {
  const requests = normalizeWriteRequests(options);
  const quotaDeltas = getWriteQuotaDeltas(requests);
  const quotaPlan = createQuotaPlan(options, quotaDeltas);
  let totalBytesWritten = 0;

  let files;

  try {
    files = requests.map((request) => {
      if (request.isDirectory) {
        fs.mkdirSync(request.absolutePath, { recursive: true });

        return {
          path: request.path
        };
      }

      fs.mkdirSync(path.dirname(request.absolutePath), { recursive: true });
      fs.writeFileSync(request.absolutePath, request.buffer);
      totalBytesWritten += request.buffer.length;

      return {
        bytesWritten: request.buffer.length,
        encoding: request.encoding,
        path: request.path
      };
    });
  } catch (error) {
    invalidateQuotaDeltas(options, quotaDeltas);
    throw error;
  }

  applyUserFolderQuotaPlan(quotaPlan);

  recordAppPathMutations(
    {
      projectRoot: options.projectRoot,
      quotaCacheUpdated: true,
      runtimeParams: options.runtimeParams
    },
    requests.map((request) => request.projectPath)
  );

  return {
    bytesWritten: totalBytesWritten,
    count: files.length,
    files
  };
}

function writeAppFile(options = {}) {
  return writeAppFiles(options).files[0];
}

function normalizeTransferEntries(options = {}, actionLabel) {
  if (Array.isArray(options.entries)) {
    if (options.entries.length === 0) {
      throw createHttpError(`File ${actionLabel} batch must not be empty.`, 400);
    }

    return options.entries;
  }

  if ("entries" in options) {
    throw createHttpError(`File ${actionLabel} batch must provide an entries array.`, 400);
  }

  return [
    {
      fromPath: options.fromPath ?? options.path,
      toPath: options.toPath ?? options.targetPath ?? options.destinationPath
    }
  ];
}

function normalizeTransferRequests(options = {}, actionType) {
  const actionLabel = actionType === "copy" ? "copy" : "move";
  const pathIndex = getPathIndex(options.watchdog);
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });
  const entries = normalizeTransferEntries(options, actionLabel);
  const requests = entries.map((entry) => {
    if (!isPlainObject(entry)) {
      throw createHttpError(`Each file ${actionLabel} entry must be an object.`, 400);
    }

    const requestedFromPath = String(entry.fromPath || entry.path || entry.sourcePath || "").trim();
    const requestedToPath = String(entry.toPath || entry.targetPath || entry.destinationPath || "").trim();

    if (!requestedFromPath) {
      throw createHttpError(`File ${actionLabel} source path must not be empty.`, 400);
    }

    if (!requestedToPath) {
      throw createHttpError(`File ${actionLabel} destination path must not be empty.`, 400);
    }

    const resolvedSourcePath = resolveExistingProjectPath(
      pathIndex,
      resolveUserShorthandPath(requestedFromPath, accessController.username)
    );

    if (!resolvedSourcePath.projectPath || !resolvedSourcePath.exists) {
      throw createHttpError(`Path not found: ${requestedFromPath}`, 404);
    }

    ensurePublicAppProjectPath(resolvedSourcePath.projectPath);
    if (actionType === "copy") {
      ensureReadableProjectPath(resolvedSourcePath.projectPath, accessController);
    } else {
      ensureWritableProjectPath(resolvedSourcePath.projectPath, accessController);
    }

    const destinationProjectPath = normalizeAppProjectPath(
      resolveUserShorthandPath(requestedToPath, accessController.username),
      {
        isDirectory: resolvedSourcePath.isDirectory
      }
    );

    if (!destinationProjectPath) {
      throw createHttpError(`Expected a writable destination path: ${requestedToPath}`, 400);
    }

    ensurePublicAppProjectPath(destinationProjectPath);
    if (destinationProjectPath === resolvedSourcePath.projectPath) {
      throw createHttpError(`Source and destination must differ: ${requestedFromPath}`, 400);
    }

    const destinationParentProjectPath = getParentDirectoryProjectPath(destinationProjectPath);

    if (!destinationParentProjectPath || !hasPath(pathIndex, destinationParentProjectPath)) {
      throw createHttpError(`Destination parent folder not found: ${requestedToPath}`, 404);
    }

    ensureWritableProjectPath(destinationProjectPath, accessController);
    ensureWritableProjectPath(destinationParentProjectPath, accessController);

    if (hasExistingProjectPathConflict(pathIndex, destinationProjectPath)) {
      throw createHttpError(`Destination already exists: ${toAppRelativePath(destinationProjectPath)}`, 400);
    }

    if (resolvedSourcePath.isDirectory && isDescendantPath(resolvedSourcePath.projectPath, destinationProjectPath)) {
      throw createHttpError(`Cannot ${actionLabel} a folder into itself: ${requestedFromPath}`, 400);
    }

    return {
      fromPath: toAppRelativePath(resolvedSourcePath.projectPath),
      isDirectory: resolvedSourcePath.isDirectory,
      sourceAbsolutePath: createAbsolutePath(
        String(options.projectRoot || ""),
        resolvedSourcePath.projectPath,
        options.runtimeParams
      ),
      sourceProjectPath: resolvedSourcePath.projectPath,
      toPath: toAppRelativePath(destinationProjectPath),
      destinationAbsolutePath: createAbsolutePath(
        String(options.projectRoot || ""),
        destinationProjectPath,
        options.runtimeParams
      ),
      destinationProjectPath
    };
  });

  requests.forEach((request, index) => {
    requests.slice(0, index).forEach((previousRequest) => {
      if (request.sourceProjectPath === previousRequest.sourceProjectPath) {
        throw createHttpError(`Duplicate file ${actionLabel} source path: ${request.fromPath}`, 400);
      }

      if (request.destinationProjectPath === previousRequest.destinationProjectPath) {
        throw createHttpError(`Duplicate file ${actionLabel} destination path: ${request.toPath}`, 400);
      }

      if (
        isDescendantPath(request.sourceProjectPath, previousRequest.sourceProjectPath) ||
        isDescendantPath(previousRequest.sourceProjectPath, request.sourceProjectPath)
      ) {
        throw createHttpError(
          `Overlapping file ${actionLabel} source paths are not allowed: ${previousRequest.fromPath} and ${request.fromPath}`,
          400
        );
      }

      if (
        isDescendantPath(request.destinationProjectPath, previousRequest.destinationProjectPath) ||
        isDescendantPath(previousRequest.destinationProjectPath, request.destinationProjectPath)
      ) {
        throw createHttpError(
          `Overlapping file ${actionLabel} destination paths are not allowed: ${previousRequest.toPath} and ${request.toPath}`,
          400
        );
      }
    });
  });

  return requests;
}

function copyAbsolutePath(sourceAbsolutePath, destinationAbsolutePath, isDirectory) {
  fs.cpSync(sourceAbsolutePath, destinationAbsolutePath, {
    errorOnExist: true,
    force: false,
    recursive: isDirectory
  });
}

function moveAbsolutePath(sourceAbsolutePath, destinationAbsolutePath, isDirectory) {
  try {
    fs.renameSync(sourceAbsolutePath, destinationAbsolutePath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }

    copyAbsolutePath(sourceAbsolutePath, destinationAbsolutePath, isDirectory);
    fs.rmSync(sourceAbsolutePath, {
      force: false,
      recursive: isDirectory
    });
  }
}

function copyAppPaths(options = {}) {
  const requests = normalizeTransferRequests(options, "copy");
  const quotaDeltas = getCopyQuotaDeltas(requests);
  const quotaPlan = createQuotaPlan(options, quotaDeltas);
  let entries;

  try {
    entries = requests.map((request) => {
      copyAbsolutePath(request.sourceAbsolutePath, request.destinationAbsolutePath, request.isDirectory);

      return {
        fromPath: request.fromPath,
        toPath: request.toPath
      };
    });
  } catch (error) {
    invalidateQuotaDeltas(options, quotaDeltas);
    throw error;
  }

  applyUserFolderQuotaPlan(quotaPlan);

  recordAppPathMutations(
    {
      projectRoot: options.projectRoot,
      quotaCacheUpdated: true,
      runtimeParams: options.runtimeParams
    },
    requests.map((request) => request.destinationProjectPath)
  );

  return {
    count: entries.length,
    entries
  };
}

function copyAppPath(options = {}) {
  return copyAppPaths(options).entries[0];
}

function moveAppPaths(options = {}) {
  const requests = normalizeTransferRequests(options, "move");
  const quotaDeltas = getMoveQuotaDeltas(requests);
  const quotaPlan = createQuotaPlan(options, quotaDeltas);
  let entries;

  try {
    entries = requests.map((request) => {
      moveAbsolutePath(request.sourceAbsolutePath, request.destinationAbsolutePath, request.isDirectory);

      return {
        fromPath: request.fromPath,
        toPath: request.toPath
      };
    });
  } catch (error) {
    invalidateQuotaDeltas(options, quotaDeltas);
    throw error;
  }

  applyUserFolderQuotaPlan(quotaPlan);

  recordAppPathMutations(
    {
      projectRoot: options.projectRoot,
      quotaCacheUpdated: true,
      runtimeParams: options.runtimeParams
    },
    requests.flatMap((request) => [request.sourceProjectPath, request.destinationProjectPath])
  );

  return {
    count: entries.length,
    entries
  };
}

function moveAppPath(options = {}) {
  return moveAppPaths(options).entries[0];
}

function normalizeDeleteEntries(options = {}) {
  if (Array.isArray(options.paths)) {
    if (options.paths.length === 0) {
      throw createHttpError("File delete batch must not be empty.", 400);
    }

    return options.paths;
  }

  if (options.paths !== undefined) {
    throw createHttpError("File delete batch must provide a paths array.", 400);
  }

  return [options.path];
}

function normalizeDeleteRequests(options = {}) {
  const pathIndex = getPathIndex(options.watchdog);
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });
  const entries = normalizeDeleteEntries(options);
  const requests = entries.map((entry) => {
    const request = isPlainObject(entry) ? entry : { path: entry };
    const requestedPath = String(request.path || "").trim();

    if (!requestedPath) {
      throw createHttpError("File path must not be empty.", 400);
    }

    const resolvedPath = resolveExistingProjectPath(
      pathIndex,
      resolveUserShorthandPath(requestedPath, accessController.username)
    );

    if (!resolvedPath.projectPath || !resolvedPath.exists) {
      throw createHttpError(`Path not found: ${requestedPath}`, 404);
    }

    ensurePublicAppProjectPath(resolvedPath.projectPath);
    ensureWritableProjectPath(resolvedPath.projectPath, accessController);

    return {
      absolutePath: createAbsolutePath(
        String(options.projectRoot || ""),
        resolvedPath.projectPath,
        options.runtimeParams
      ),
      isDirectory: resolvedPath.isDirectory,
      path: toAppRelativePath(resolvedPath.projectPath),
      projectPath: resolvedPath.projectPath
    };
  });

  requests.forEach((request, index) => {
    requests.slice(0, index).forEach((previousRequest) => {
      if (request.projectPath === previousRequest.projectPath) {
        throw createHttpError(`Duplicate file delete path: ${request.path}`, 400);
      }

      if (
        isDescendantPath(request.projectPath, previousRequest.projectPath) ||
        isDescendantPath(previousRequest.projectPath, request.projectPath)
      ) {
        throw createHttpError(
          `Overlapping file delete paths are not allowed: ${previousRequest.path} and ${request.path}`,
          400
        );
      }
    });
  });

  return requests;
}

function deleteAppPaths(options = {}) {
  const requests = normalizeDeleteRequests(options);
  const quotaDeltas = getDeleteQuotaDeltas(requests);
  const quotaPlan = createQuotaPlan(options, quotaDeltas);
  let paths;

  try {
    paths = requests.map((request) => {
      fs.rmSync(request.absolutePath, {
        force: false,
        recursive: request.isDirectory
      });
      return request.path;
    });
  } catch (error) {
    invalidateQuotaDeltas(options, quotaDeltas);
    throw error;
  }

  applyUserFolderQuotaPlan(quotaPlan);

  recordAppPathMutations(
    {
      projectRoot: options.projectRoot,
      quotaCacheUpdated: true,
      runtimeParams: options.runtimeParams
    },
    requests.map((request) => request.projectPath)
  );

  return {
    count: paths.length,
    paths
  };
}

function deleteAppPath(options = {}) {
  return {
    path: deleteAppPaths(options).paths[0]
  };
}

function isDescendantPath(ancestorDirectoryPath, candidatePath) {
  const ancestorBase = stripTrailingSlash(ancestorDirectoryPath);
  const candidateBase = stripTrailingSlash(candidatePath);

  return Boolean(
    ancestorBase &&
      candidateBase &&
      candidateBase !== ancestorBase &&
      candidateBase.startsWith(`${ancestorBase}/`)
  );
}

function isSameOrDescendantPath(ancestorDirectoryPath, candidatePath) {
  return (
    stripTrailingSlash(ancestorDirectoryPath) === stripTrailingSlash(candidatePath) ||
    isDescendantPath(ancestorDirectoryPath, candidatePath)
  );
}

function getDirectChildPath(directoryPath, descendantPath, pathIndex) {
  const directorySegments = stripTrailingSlash(directoryPath).split("/").filter(Boolean);
  const descendantSegments = stripTrailingSlash(descendantPath).split("/").filter(Boolean);

  if (descendantSegments.length <= directorySegments.length) {
    return "";
  }

  const childBasePath = `/${descendantSegments.slice(0, directorySegments.length + 1).join("/")}`;
  const childDirectoryPath = `${childBasePath}/`;

  return hasPath(pathIndex, childDirectoryPath) ? childDirectoryPath : childBasePath;
}

function collectAncestorDirectories(targetDirectoryPath, descendantPath, pathIndex) {
  const targetSegments = stripTrailingSlash(targetDirectoryPath).split("/").filter(Boolean);
  const descendantSegments = stripTrailingSlash(descendantPath).split("/").filter(Boolean);
  const output = [];

  for (let length = targetSegments.length + 1; length < descendantSegments.length; length += 1) {
    const candidatePath = `/${descendantSegments.slice(0, length).join("/")}/`;

    if (hasPath(pathIndex, candidatePath)) {
      output.push(candidatePath);
    }
  }

  return output;
}

function listAppPaths(options = {}) {
  const pathIndex = getPathIndex(options.watchdog);
  const accessMode = normalizeAccessMode(options.access || (options.writableOnly ? "write" : "read"));
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });

  if (options.gitRepositories) {
    const baseProjectPath = normalizeAppProjectPath(
      resolveUserShorthandPath(options.path || "/app/", accessController.username),
      {
        allowAppRoot: true,
        isDirectory: true
      }
    );
    const targetPathInfo = parseAppProjectPath(baseProjectPath);

    if (!baseProjectPath) {
      throw createHttpError("Path not found.", 404);
    }

    if (targetPathInfo && targetPathInfo.kind === "owner-path") {
      ensureProjectPathAccess(baseProjectPath, accessController, accessMode);
    }
    const repositoryPaths = listLayerHistoryRepositories({
      access: accessMode,
      projectRoot: options.projectRoot,
      runtimeParams: options.runtimeParams,
      username: options.username,
      watchdog: options.watchdog
    })
      .map((repository) => normalizeAppProjectPath(repository.path, { isDirectory: true }))
      .filter((projectPath) => projectPath && isSameOrDescendantPath(baseProjectPath, projectPath))
      .sort((left, right) => left.localeCompare(right))
      .map((projectPath) => toAppRelativePath(projectPath));

    return {
      access: accessMode,
      gitRepositories: true,
      path: toAppRelativePath(baseProjectPath),
      paths: repositoryPaths,
      recursive: true
    };
  }

  const resolvedPath = resolveExistingProjectPath(
    pathIndex,
    resolveUserShorthandPath(options.path || "/app/", accessController.username)
  );

  if (!resolvedPath.projectPath || !resolvedPath.exists) {
    throw createHttpError("Path not found.", 404);
  }

  ensurePublicAppProjectPath(resolvedPath.projectPath);
  if (!resolvedPath.isDirectory) {
    ensureProjectPathAccess(resolvedPath.projectPath, accessController, accessMode);

    return {
      access: accessMode,
      path: toAppRelativePath(resolvedPath.projectPath),
      paths: [toAppRelativePath(resolvedPath.projectPath)],
      recursive: false
    };
  }

  const targetPathInfo = parseAppProjectPath(resolvedPath.projectPath);

  if (targetPathInfo && targetPathInfo.kind === "owner-path") {
    ensureProjectPathAccess(resolvedPath.projectPath, accessController, accessMode);
  }

  const recursive = Boolean(options.recursive);
  const allPaths = Object.keys(pathIndex).sort((left, right) => left.localeCompare(right));
  const accessibleDescendants = allPaths.filter((projectPath) => {
    if (isReservedAppProjectPath(projectPath)) {
      return false;
    }

    if (!isDescendantPath(resolvedPath.projectPath, projectPath)) {
      return false;
    }

    const pathInfo = parseAppProjectPath(projectPath);

    if (!pathInfo || pathInfo.kind !== "owner-path") {
      return false;
    }

    return canAccessProjectPath(projectPath, accessController, accessMode);
  });
  const outputPaths = new Set();

  if (recursive) {
    for (const projectPath of accessibleDescendants) {
      outputPaths.add(projectPath);

      for (const ancestorPath of collectAncestorDirectories(resolvedPath.projectPath, projectPath, pathIndex)) {
        if (accessMode === "read" || canAccessProjectPath(ancestorPath, accessController, accessMode)) {
          outputPaths.add(ancestorPath);
        }
      }
    }
  } else {
    for (const projectPath of accessibleDescendants) {
      const directChildPath = getDirectChildPath(resolvedPath.projectPath, projectPath, pathIndex);

      if (
        directChildPath &&
        (accessMode === "read" || canAccessProjectPath(directChildPath, accessController, accessMode))
      ) {
        outputPaths.add(directChildPath);
      }
    }
  }

  return {
    access: accessMode,
    path: toAppRelativePath(resolvedPath.projectPath),
    paths: [...outputPaths]
      .sort((left, right) => left.localeCompare(right))
      .map((projectPath) => toAppRelativePath(projectPath)),
    recursive
  };
}

function listAppPathsByPatterns(options = {}) {
  const compiledPatterns = compileFilePathPatterns(options.patterns);
  const accessMode = normalizeAccessMode(options.access || (options.writableOnly ? "write" : "read"));
  const maxLayer = normalizeMaxLayer(options.maxLayer);
  const output = Object.create(null);

  for (const { sourcePattern } of compiledPatterns) {
    output[sourcePattern] = [];
  }

  if (compiledPatterns.length === 0) {
    return output;
  }

  if (options.gitRepositories) {
    const repositories = listLayerHistoryRepositories({
      access: accessMode,
      projectRoot: options.projectRoot,
      runtimeParams: options.runtimeParams,
      username: options.username,
      watchdog: options.watchdog
    });

    for (const repository of repositories) {
      const repositoryPath = normalizePathSegment(repository.path);
      const repositoryProjectPath = normalizeAppProjectPath(repository.path, { isDirectory: true });

      if (!repositoryProjectPath || !isProjectPathWithinMaxLayer(repositoryProjectPath, maxLayer)) {
        continue;
      }

      const syntheticGitPaths = [
        ".git/",
        `${stripTrailingSlash(repositoryPath)}/.git/`,
        `app/${stripTrailingSlash(repositoryPath)}/.git/`
      ];

      for (const compiledPattern of compiledPatterns) {
        if (syntheticGitPaths.some((gitPath) => compiledPattern.matcher.test(gitPath))) {
          output[compiledPattern.sourcePattern].push(repository.path);
        }
      }
    }

    for (const sourcePattern of Object.keys(output)) {
      output[sourcePattern] = [...new Set(output[sourcePattern])].sort((left, right) => left.localeCompare(right));
    }

    return output;
  }

  const ownerScopes = accessMode === "write" ? createWritableOwnerScopes({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username,
    watchdog: options.watchdog
  }) : createReadableOwnerScopes({
    groupIndex: getGroupIndex(options.watchdog, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });

  if (ownerScopes.length === 0) {
    return output;
  }

  const pathBuckets = new Map();

  for (const projectPath of getSortedProjectPaths(options.watchdog)) {
    if (isReservedAppProjectPath(projectPath)) {
      continue;
    }

    if (!isProjectPathWithinMaxLayer(projectPath, maxLayer)) {
      continue;
    }

    const ownerScope = findOwnerScope(projectPath, ownerScopes);

    if (!ownerScope) {
      continue;
    }

    const relativePath = projectPath.slice(ownerScope.rootPath.length);

    if (!relativePath) {
      continue;
    }

    if (!pathBuckets.has(ownerScope.rank)) {
      pathBuckets.set(ownerScope.rank, []);
    }

    pathBuckets.get(ownerScope.rank).push({
      projectPath,
      relativePath
    });
  }

  for (const ownerScope of ownerScopes) {
    const pathEntries = pathBuckets.get(ownerScope.rank) || [];

    for (const pathEntry of pathEntries) {
      const appRelativePath = toAppRelativePath(pathEntry.projectPath);

      for (const compiledPattern of compiledPatterns) {
        if (compiledPattern.matcher.test(pathEntry.relativePath)) {
          output[compiledPattern.sourcePattern].push(appRelativePath);
        }
      }
    }
  }

  return output;
}

export {
  copyAppPath,
  copyAppPaths,
  createAppAccessController,
  createHttpError,
  deleteAppPath,
  deleteAppPaths,
  getAppFolderDownloadInfo,
  getAppPathInfo,
  listAppPaths,
  listAppPathsByPatterns,
  moveAppPath,
  moveAppPaths,
  readAppFile,
  readAppFiles,
  toAppRelativePath,
  writeAppFile,
  writeAppFiles
};
