const fs = require("node:fs");
const path = require("node:path");
const { globToRegExp, normalizePathSegment } = require("../app-files.cjs");

const REFRESH_DEBOUNCE_MS = 75;
const RECONCILE_INTERVAL_MS = 1_000;

function tryReadTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function tryStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function normalizeProjectPath(input) {
  const normalized = normalizePathSegment(input);
  return normalized ? `/${normalized}` : "";
}

function toProjectPath(projectRoot, absolutePath) {
  return normalizeProjectPath(path.relative(projectRoot, absolutePath));
}

function getStatsSignature(stats) {
  if (!stats) {
    return "";
  }

  return `${Math.trunc(stats.mtimeMs)}:${stats.size}`;
}

function parseScalar(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseFileWatchYaml(sourceText) {
  const result = {};
  let currentKey = null;

  String(sourceText || "")
    .split(/\r?\n/u)
    .forEach((rawLine) => {
      const line = rawLine.replace(/\s+#.*$/u, "").trimEnd();

      if (!line.trim()) {
        return;
      }

      const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/u);
      if (keyMatch) {
        const [, key, value] = keyMatch;
        currentKey = key;

        if (value === undefined || value === "") {
          result[key] = [];
          return;
        }

        result[key] = parseScalar(value);
        return;
      }

      const listMatch = line.match(/^\s*-\s+(.*)$/u);
      if (listMatch && currentKey) {
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
        }

        result[currentKey].push(parseScalar(listMatch[1]));
      }
    });

  return result;
}

function loadFileWatchConfig(configPath) {
  const sourceText = tryReadTextFile(configPath);

  if (sourceText === null) {
    throw new Error(`File watch config not found: ${configPath}`);
  }

  const parsed = parseFileWatchYaml(sourceText);
  const rawPaths = Array.isArray(parsed.paths) ? parsed.paths : [];
  const patterns = rawPaths
    .filter((value) => typeof value === "string")
    .map((value) => normalizeProjectPath(value))
    .filter(Boolean);

  if (patterns.length === 0) {
    throw new Error(`File watch config must define at least one path under "paths": ${configPath}`);
  }

  return {
    configPath,
    patterns
  };
}

function getFixedPatternPrefix(pattern) {
  const relativePattern = normalizePathSegment(pattern);
  const segments = relativePattern ? relativePattern.split("/") : [];
  const prefixSegments = [];

  for (const segment of segments) {
    if (/[*?[\]{}]/u.test(segment)) {
      break;
    }

    prefixSegments.push(segment);
  }

  return prefixSegments.join("/");
}

function getExistingWatchBase(projectRoot, relativePath) {
  let currentPath = relativePath ? path.join(projectRoot, relativePath) : projectRoot;

  while (true) {
    const stats = tryStat(currentPath);
    if (stats && stats.isDirectory()) {
      return currentPath;
    }

    if (currentPath === projectRoot) {
      return projectRoot;
    }

    currentPath = path.dirname(currentPath);
  }
}

function walkDirectories(startDir, output) {
  const stats = tryStat(startDir);
  if (!stats || !stats.isDirectory()) {
    return;
  }

  output.add(startDir);

  const entries = fs.readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    walkDirectories(path.join(startDir, entry.name), output);
  }
}

function walkFiles(startDir, callback) {
  const stats = tryStat(startDir);
  if (!stats || !stats.isDirectory()) {
    return;
  }

  const entries = fs.readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);

    if (entry.isDirectory()) {
      walkFiles(fullPath, callback);
      continue;
    }

    if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

function createCompiledPatterns(patterns) {
  return patterns.map((pattern) => {
    const normalized = normalizePathSegment(pattern);

    return {
      pattern: normalizeProjectPath(pattern),
      matcher: globToRegExp(normalized)
    };
  });
}

function createFileAggregateStore(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, "..", "..", ".."));
  const configPath = path.resolve(options.configPath || path.join(__dirname, "config.yaml"));
  const reconcileIntervalMs = Number(options.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS);
  const watchConfig = options.watchConfig !== false;
  let compiledPatterns = [];
  let matchedPathIndex = Object.create(null);
  let lastConfigSignature = "";
  let started = false;
  let refreshInProgress = false;
  let pendingRefresh = false;
  let refreshTimer = null;
  let pathSyncInProgress = false;
  let pathSyncTimer = null;
  let reconcileTimer = null;
  let configWatcher = null;
  const pendingChangedPaths = new Set();
  const directoryWatchers = new Map();
  const aggregateBuilders = new Map();
  const aggregateValues = new Map();

  function matchesProjectPath(projectPath) {
    const normalized = normalizePathSegment(projectPath);
    return Boolean(normalized && compiledPatterns.some(({ matcher }) => matcher.test(normalized)));
  }

  function coversPath(projectPath) {
    return matchesProjectPath(projectPath);
  }

  function hasPath(projectPath) {
    const normalized = normalizeProjectPath(projectPath);
    return Boolean(normalized && matchedPathIndex[normalized]);
  }

  function getMatchedPathIndex() {
    return { ...matchedPathIndex };
  }

  function getMatchedPaths() {
    return Object.keys(matchedPathIndex).sort((left, right) => left.localeCompare(right));
  }

  function rebuildAggregates() {
    const aggregateContext = {
      coversPath,
      getMatchedPathIndex,
      getMatchedPaths,
      matchedPathIndex: getMatchedPathIndex(),
      matchedPaths: getMatchedPaths(),
      projectRoot
    };

    for (const [name, buildAggregate] of aggregateBuilders.entries()) {
      aggregateValues.set(name, buildAggregate(aggregateContext));
    }
  }

  function registerAggregate(name, buildAggregate) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Aggregate name must be a non-empty string.");
    }

    if (typeof buildAggregate !== "function") {
      throw new Error(`Aggregate builder for ${name} must be a function.`);
    }

    aggregateBuilders.set(name, buildAggregate);
    rebuildAggregates();
  }

  function getAggregate(name) {
    return aggregateValues.get(name);
  }

  function removeMatchedEntries(projectPath) {
    if (!projectPath) {
      return false;
    }

    const prefix = `${projectPath}/`;
    let changed = false;

    for (const existingPath of Object.keys(matchedPathIndex)) {
      if (existingPath === projectPath || existingPath.startsWith(prefix)) {
        delete matchedPathIndex[existingPath];
        changed = true;
      }
    }

    return changed;
  }

  function upsertMatchedFileEntry(filePath) {
    const projectPath = toProjectPath(projectRoot, filePath);

    if (!projectPath) {
      return false;
    }

    if (!matchesProjectPath(projectPath)) {
      return removeMatchedEntries(projectPath);
    }

    if (matchedPathIndex[projectPath] === true) {
      return false;
    }

    matchedPathIndex[projectPath] = true;
    return true;
  }

  function rebuildMatchedPathIndex() {
    const nextMatchedPathIndex = Object.create(null);
    const scanRoots = new Set();

    for (const { pattern } of compiledPatterns) {
      const fixedPrefix = getFixedPatternPrefix(pattern);
      scanRoots.add(fixedPrefix ? path.join(projectRoot, fixedPrefix) : projectRoot);
    }

    for (const scanRoot of scanRoots) {
      walkFiles(scanRoot, (filePath) => {
        const projectPath = toProjectPath(projectRoot, filePath);
        if (!projectPath) {
          return;
        }

        if (!matchesProjectPath(projectPath)) {
          return;
        }

        nextMatchedPathIndex[projectPath] = true;
      });
    }

    matchedPathIndex = nextMatchedPathIndex;
  }

  function removeDirectoryWatchersUnder(directoryPath) {
    const prefix = `${directoryPath}${path.sep}`;

    for (const [watchedPath, watcher] of directoryWatchers.entries()) {
      if (watchedPath === directoryPath || watchedPath.startsWith(prefix)) {
        watcher.close();
        directoryWatchers.delete(watchedPath);
      }
    }
  }

  function schedulePathSync(targetPath) {
    if (targetPath) {
      pendingChangedPaths.add(targetPath);
    }

    if (pathSyncTimer) {
      clearTimeout(pathSyncTimer);
    }

    pathSyncTimer = setTimeout(() => {
      pathSyncTimer = null;
      void processPendingPathChangesSafely();
    }, REFRESH_DEBOUNCE_MS);
  }

  function watchDirectory(directoryPath) {
    if (directoryWatchers.has(directoryPath)) {
      return;
    }

    try {
      const watcher = fs.watch(directoryPath, (eventType, fileName) => {
        if (!fileName) {
          schedulePathSync(directoryPath);
          return;
        }

        schedulePathSync(path.join(directoryPath, String(fileName)));
      });

      watcher.on("error", () => {
        watcher.close();
        directoryWatchers.delete(directoryPath);
        schedulePathSync(directoryPath);
      });

      directoryWatchers.set(directoryPath, watcher);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  function watchDirectoryTree(startDir) {
    const nextDirectories = new Set();
    walkDirectories(startDir, nextDirectories);

    for (const directoryPath of nextDirectories) {
      watchDirectory(directoryPath);
    }
  }

  function closeRemovedWatchers(nextDirectorySet) {
    for (const [directoryPath, watcher] of directoryWatchers.entries()) {
      if (nextDirectorySet.has(directoryPath)) {
        continue;
      }

      watcher.close();
      directoryWatchers.delete(directoryPath);
    }
  }

  function syncAbsolutePath(targetPath) {
    const projectPath = toProjectPath(projectRoot, targetPath);
    if (!projectPath) {
      return false;
    }

    const stats = tryStat(targetPath);

    if (!stats) {
      removeDirectoryWatchersUnder(targetPath);
      return removeMatchedEntries(projectPath);
    }

    if (stats.isDirectory()) {
      let changed = removeMatchedEntries(projectPath);

      watchDirectoryTree(targetPath);
      walkFiles(targetPath, (filePath) => {
        if (upsertMatchedFileEntry(filePath)) {
          changed = true;
        }
      });

      return changed;
    }

    removeDirectoryWatchersUnder(targetPath);
    return upsertMatchedFileEntry(targetPath);
  }

  async function refresh() {
    if (refreshInProgress || pathSyncInProgress) {
      pendingRefresh = true;
      return;
    }

    refreshInProgress = true;

    try {
      const nextConfig = loadFileWatchConfig(configPath);
      const configStats = tryStat(configPath);
      compiledPatterns = createCompiledPatterns(nextConfig.patterns);
      lastConfigSignature = getStatsSignature(configStats);
      rebuildMatchedPathIndex();

      const nextDirectories = new Set();

      for (const { pattern } of compiledPatterns) {
        const fixedPrefix = getFixedPatternPrefix(pattern);
        const baseDirectory = getExistingWatchBase(projectRoot, fixedPrefix);
        walkDirectories(baseDirectory, nextDirectories);
      }

      closeRemovedWatchers(nextDirectories);

      for (const directoryPath of nextDirectories) {
        watchDirectory(directoryPath);
      }

      rebuildAggregates();
    } finally {
      refreshInProgress = false;

      if (pendingRefresh) {
        pendingRefresh = false;
        await refresh();
      }
    }
  }

  async function refreshSafely() {
    try {
      await refresh();
    } catch (error) {
      console.error("Failed to refresh watched file aggregates.");
      console.error(error);
    }
  }

  async function processPendingPathChanges() {
    if (pathSyncInProgress || refreshInProgress) {
      if (refreshInProgress) {
        schedulePathSync();
      }

      return;
    }

    pathSyncInProgress = true;

    try {
      const pathsToSync = [...pendingChangedPaths];
      pendingChangedPaths.clear();

      if (pathsToSync.length === 0) {
        return;
      }

      let changed = false;

      for (const targetPath of pathsToSync) {
        if (syncAbsolutePath(targetPath)) {
          changed = true;
        }
      }

      if (changed) {
        rebuildAggregates();
      }
    } finally {
      pathSyncInProgress = false;

      if (pendingRefresh) {
        pendingRefresh = false;
        await refresh();
        return;
      }

      if (pendingChangedPaths.size > 0) {
        schedulePathSync();
      }
    }
  }

  async function processPendingPathChangesSafely() {
    try {
      await processPendingPathChanges();
    } catch (error) {
      console.error("Failed to apply watched file changes incrementally.");
      console.error(error);
      scheduleRefresh();
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshSafely();
    }, REFRESH_DEBOUNCE_MS);
  }

  function startConfigWatcher() {
    configWatcher = (currentStats) => {
      const nextConfigSignature = getStatsSignature(currentStats);
      if (!nextConfigSignature || nextConfigSignature === lastConfigSignature) {
        return;
      }

      lastConfigSignature = nextConfigSignature;
      scheduleRefresh();
    };

    fs.watchFile(configPath, { interval: Math.max(REFRESH_DEBOUNCE_MS, 100) }, configWatcher);
  }

  function startReconcileLoop() {
    if (!Number.isFinite(reconcileIntervalMs) || reconcileIntervalMs <= 0) {
      return;
    }

    reconcileTimer = setInterval(() => {
      void refreshSafely();
    }, reconcileIntervalMs);
  }

  async function start() {
    if (started) {
      return;
    }

    await refresh();
    if (watchConfig) {
      startConfigWatcher();
    }
    startReconcileLoop();
    started = true;
  }

  function stop() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    if (pathSyncTimer) {
      clearTimeout(pathSyncTimer);
      pathSyncTimer = null;
    }

    if (configWatcher) {
      fs.unwatchFile(configPath, configWatcher);
      configWatcher = null;
    }

    if (reconcileTimer) {
      clearInterval(reconcileTimer);
      reconcileTimer = null;
    }

    for (const watcher of directoryWatchers.values()) {
      watcher.close();
    }

    directoryWatchers.clear();
    started = false;
  }

  return {
    coversPath,
    getAggregate,
    getMatchedPathIndex,
    getMatchedPaths,
    hasPath,
    refresh,
    registerAggregate,
    start,
    stop
  };
}

module.exports = {
  createFileAggregateStore,
  loadFileWatchConfig,
  normalizeProjectPath,
  toProjectPath
};
