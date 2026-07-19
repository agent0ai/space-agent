import { createHash } from "node:crypto";

import { createAppAccessController, createHttpError, toAppRelativePath } from "../lib/customware/file_access.js";
import { normalizeAppProjectPath } from "../lib/customware/layout.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function readPayload(context) {
  return isPlainObject(context.body) ? context.body : {};
}

function resolveUserShorthandPath(rawPath, username) {
  const inputPath = String(rawPath || "").trim();

  if (!inputPath.startsWith("~")) {
    return inputPath;
  }

  if (!username) {
    throw createHttpError("User-relative paths require an authenticated user.", 400);
  }

  if (inputPath === "~" || inputPath === "~/") {
    return `L2/${username}/`;
  }

  if (inputPath.startsWith("~/")) {
    return `L2/${username}/${inputPath.slice(2)}`;
  }

  throw createHttpError(`Invalid user-relative path: ${inputPath}`, 400);
}

function normalizeRequestedProjectPath(rawPath, username) {
  const normalizedInputPath = resolveUserShorthandPath(rawPath, username);

  if (!normalizedInputPath) {
    throw createHttpError("Path must not be empty.", 400);
  }

  const normalizedProjectPath = normalizeAppProjectPath(normalizedInputPath, {
    allowAppRoot: true,
    isDirectory: String(rawPath || "").trim().endsWith("/")
  });

  if (!normalizedProjectPath) {
    throw createHttpError(`Invalid path: ${String(rawPath || "")}`, 400);
  }

  return normalizedProjectPath;
}

function listRequestedProjectPaths(payload, username) {
  const rawPaths = [];

  if (typeof payload.path === "string" && payload.path.trim()) {
    rawPaths.push(payload.path);
  }

  if (Array.isArray(payload.paths)) {
    rawPaths.push(...payload.paths);
  }

  const requestedPaths = [];
  const seenProjectPaths = new Set();

  for (const rawPath of rawPaths) {
    const normalizedProjectPath = normalizeRequestedProjectPath(rawPath, username);

    if (seenProjectPaths.has(normalizedProjectPath)) {
      continue;
    }

    seenProjectPaths.add(normalizedProjectPath);
    requestedPaths.push(normalizedProjectPath);
  }

  return requestedPaths;
}

function listRequestedPrefixes(payload, username) {
  const rawPrefixes = [];

  if (typeof payload.prefix === "string" && payload.prefix.trim()) {
    rawPrefixes.push(payload.prefix);
  }

  if (Array.isArray(payload.prefixes)) {
    rawPrefixes.push(...payload.prefixes);
  }

  const requestedPrefixes = [];
  const seenPrefixes = new Set();

  for (const rawPrefix of rawPrefixes) {
    const normalizedPrefix = normalizeRequestedProjectPath(rawPrefix, username);
    const directoryPrefix = normalizedPrefix.endsWith("/") ? normalizedPrefix : `${normalizedPrefix}/`;

    if (seenPrefixes.has(directoryPrefix)) {
      continue;
    }

    seenPrefixes.add(directoryPrefix);
    requestedPrefixes.push(directoryPrefix);
  }

  return requestedPrefixes;
}

function ensureReadableProjectPath(projectPath, accessController) {
  if (!accessController.canReadProjectPath(projectPath)) {
    throw createHttpError(`Read access denied for ${toAppRelativePath(projectPath) || projectPath}`, 403);
  }
}

function buildEntries(pathIndex, requestedPaths, requestedPrefixes) {
  const outputEntries = [];
  const addedProjectPaths = new Set();

  for (const projectPath of requestedPaths) {
    addedProjectPaths.add(projectPath);
    outputEntries.push([toAppRelativePath(projectPath), pathIndex[projectPath] || null]);
  }

  const sortedProjectPaths = Object.keys(pathIndex).sort((left, right) => left.localeCompare(right));

  for (const prefix of requestedPrefixes) {
    for (const projectPath of sortedProjectPaths) {
      if (!projectPath.startsWith(prefix) || addedProjectPaths.has(projectPath)) {
        continue;
      }

      addedProjectPaths.add(projectPath);
      outputEntries.push([toAppRelativePath(projectPath), pathIndex[projectPath]]);
    }
  }

  outputEntries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(outputEntries);
}

function createEntriesHash(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function handleDebugPathIndex(context) {
  const payload = readPayload(context);
  const requestedPaths = listRequestedProjectPaths(payload, context.user?.username);
  const requestedPrefixes = listRequestedPrefixes(payload, context.user?.username);

  if (requestedPaths.length === 0 && requestedPrefixes.length === 0) {
    throw createHttpError("Provide at least one path or prefix.", 400);
  }

  const accessController = createAppAccessController({
    runtimeParams: context.runtimeParams,
    username: context.user?.username,
    watchdog: context.watchdog
  });

  for (const projectPath of requestedPaths) {
    ensureReadableProjectPath(projectPath, accessController);
  }

  for (const projectPath of requestedPrefixes) {
    ensureReadableProjectPath(projectPath, accessController);
  }

  await context.ensureUserFileIndex?.(context.user?.username);

  const pathIndex =
    context.watchdog && typeof context.watchdog.getIndex === "function"
      ? context.watchdog.getIndex("path_index") || Object.create(null)
      : Object.create(null);
  const entries = buildEntries(pathIndex, requestedPaths, requestedPrefixes);

  return {
    entries,
    hash: createEntriesHash(entries),
    indexSize: Object.keys(pathIndex).length,
    requestedPaths: requestedPaths.map((projectPath) => toAppRelativePath(projectPath)),
    requestedPrefixes: requestedPrefixes.map((projectPath) => toAppRelativePath(projectPath))
  };
}

export async function get(context) {
  return handleDebugPathIndex(context);
}

export async function post(context) {
  return handleDebugPathIndex(context);
}
