import { FILE_INDEX_AREA } from "../../runtime/state_areas.js";
import { getFileIndexShardId } from "./state_shards.js";

function createEmptyRecordMap() {
  return Object.create(null);
}

function clonePathIndex(pathIndex = createEmptyRecordMap()) {
  const nextPathIndex = createEmptyRecordMap();

  Object.entries(pathIndex || createEmptyRecordMap()).forEach(([projectPath, metadata]) => {
    nextPathIndex[projectPath] =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? { ...metadata }
        : metadata;
  });

  return nextPathIndex;
}

function stripTrailingSlash(value) {
  const text = String(value || "");
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

function isPathIndexEntryEqual(left, right) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    Boolean(left.isDirectory) === Boolean(right.isDirectory) &&
    Number(left.mtimeMs || 0) === Number(right.mtimeMs || 0) &&
    Number(left.sizeBytes || 0) === Number(right.sizeBytes || 0)
  );
}

function isL2FileIndexShardId(shardId = "") {
  return String(shardId || "").startsWith("L2/");
}

function shouldReplicateFileIndexShard(shardId = "") {
  return !isL2FileIndexShardId(shardId);
}

function createFileIndexStore(options = {}) {
  const areaState = options.areaState || createEmptyRecordMap();
  const stateSystem = options.stateSystem || null;
  const getCurrentVersion =
    typeof options.getCurrentVersion === "function" ? options.getCurrentVersion : () => 0;
  const removeAreaIfEmpty =
    typeof options.removeAreaIfEmpty === "function" ? options.removeAreaIfEmpty : () => {};
  const loadedShardIds = new Set();
  const staleShardIds = new Set();
  const shardVersions = new Map();
  let shardVersionCounter = 0;

  function ensureArea() {
    if (!areaState[FILE_INDEX_AREA]) {
      areaState[FILE_INDEX_AREA] = createEmptyRecordMap();
    }

    return areaState[FILE_INDEX_AREA];
  }

  function getArea() {
    return areaState[FILE_INDEX_AREA] || createEmptyRecordMap();
  }

  function listShardIds() {
    return Object.keys(getArea()).sort((left, right) => left.localeCompare(right));
  }

  function normalizeShardId(shardId = "") {
    return String(shardId || "").trim();
  }

  function getShardValue(shardId = "") {
    const normalizedShardId = normalizeShardId(shardId);

    if (!normalizedShardId) {
      return createEmptyRecordMap();
    }

    return getArea()[normalizedShardId] || createEmptyRecordMap();
  }

  function hasShard(shardId = "") {
    return Object.prototype.hasOwnProperty.call(getArea(), normalizeShardId(shardId));
  }

  function markVersion(shardId = "", version = null) {
    const normalizedShardId = normalizeShardId(shardId);

    if (!normalizedShardId) {
      return 0;
    }

    const normalizedVersion = Math.floor(Number(version));

    if (Number.isFinite(normalizedVersion) && normalizedVersion > 0) {
      shardVersionCounter = Math.max(shardVersionCounter, normalizedVersion);
      shardVersions.set(normalizedShardId, normalizedVersion);
      return normalizedVersion;
    }

    shardVersionCounter += 1;
    shardVersions.set(normalizedShardId, shardVersionCounter);
    return shardVersionCounter;
  }

  function getShardVersion(shardId = "") {
    return Number(shardVersions.get(normalizeShardId(shardId)) || 0);
  }

  function applyLocalStateEntry(shardId, value, options = {}) {
    const normalizedShardId = normalizeShardId(shardId);

    if (
      !normalizedShardId ||
      !isL2FileIndexShardId(normalizedShardId) ||
      !stateSystem ||
      typeof stateSystem.applyLocalEntries !== "function"
    ) {
      return;
    }

    stateSystem.applyLocalEntries(
      [
        value
          ? {
              area: FILE_INDEX_AREA,
              id: normalizedShardId,
              replicated: false,
              value
            }
          : {
              area: FILE_INDEX_AREA,
              deleted: true,
              id: normalizedShardId,
              replicated: false
            }
      ],
      {
        version: getCurrentVersion()
      }
    );
  }

  function applyShard(shardId, nextShardValue, options = {}) {
    const normalizedShardId = normalizeShardId(shardId);

    if (!normalizedShardId) {
      return;
    }

    const area = ensureArea();

    if (!nextShardValue || Object.keys(nextShardValue).length === 0) {
      delete area[normalizedShardId];
      loadedShardIds.delete(normalizedShardId);
      staleShardIds.delete(normalizedShardId);
      removeAreaIfEmpty(FILE_INDEX_AREA);
      markVersion(normalizedShardId, options.version);
      applyLocalStateEntry(normalizedShardId, null);
      return;
    }

    const clonedShardValue = clonePathIndex(nextShardValue);
    area[normalizedShardId] = clonedShardValue;

    if (options.fullyLoaded === true || !isL2FileIndexShardId(normalizedShardId)) {
      loadedShardIds.add(normalizedShardId);
    }

    if (options.stale === true) {
      staleShardIds.add(normalizedShardId);
    } else {
      staleShardIds.delete(normalizedShardId);
    }

    markVersion(normalizedShardId, options.version);
    applyLocalStateEntry(normalizedShardId, clonedShardValue);
  }

  function hydrateFromReplicatedState(state = {}) {
    delete areaState[FILE_INDEX_AREA];
    loadedShardIds.clear();
    staleShardIds.clear();
    shardVersions.clear();
    shardVersionCounter = 0;

    const fileIndexArea =
      state?.[FILE_INDEX_AREA] && typeof state[FILE_INDEX_AREA] === "object"
        ? state[FILE_INDEX_AREA]
        : createEmptyRecordMap();

    Object.entries(fileIndexArea).forEach(([shardId, value]) => {
      const normalizedShardId = normalizeShardId(shardId);

      if (!normalizedShardId) {
        return;
      }

      ensureArea()[normalizedShardId] = clonePathIndex(value);
      if (!isL2FileIndexShardId(normalizedShardId)) {
        loadedShardIds.add(normalizedShardId);
      }
      markVersion(normalizedShardId);
    });
  }

  function getPathEntry(projectPath = "") {
    const shardId = getFileIndexShardId(projectPath);

    if (!shardId) {
      return null;
    }

    return getShardValue(shardId)[projectPath] || null;
  }

  function setPathEntry(projectPath = "", metadata = null) {
    const shardId = getFileIndexShardId(projectPath);

    if (!shardId || !metadata) {
      return false;
    }

    const area = ensureArea();
    const shardValue = area[shardId] || createEmptyRecordMap();
    area[shardId] = shardValue;
    const previousMetadata = shardValue[projectPath] || null;

    if (isPathIndexEntryEqual(previousMetadata, metadata)) {
      return false;
    }

    shardValue[projectPath] =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? { ...metadata }
        : metadata;
    markVersion(shardId);
    applyLocalStateEntry(shardId, shardValue);
    return true;
  }

  function deletePathEntry(projectPath = "") {
    const shardId = getFileIndexShardId(projectPath);
    const area = getArea();
    const shardValue = shardId ? area[shardId] : null;

    if (!shardValue || !(projectPath in shardValue)) {
      return false;
    }

    delete shardValue[projectPath];
    markVersion(shardId);

    if (Object.keys(shardValue).length === 0) {
      delete area[shardId];
      loadedShardIds.delete(shardId);
      staleShardIds.delete(shardId);
      removeAreaIfEmpty(FILE_INDEX_AREA);
      applyLocalStateEntry(shardId, null);
    } else {
      applyLocalStateEntry(shardId, shardValue);
    }

    return true;
  }

  function removeEntries(projectPath, options = {}) {
    const normalizedBase = stripTrailingSlash(projectPath);

    if (!normalizedBase) {
      return false;
    }

    let changed = false;
    const shardId = getFileIndexShardId(projectPath);
    const shardIds =
      shardId && !["app", "L0", "L1", "L2"].includes(shardId) ? [shardId] : listShardIds();

    for (const currentShardId of shardIds) {
      const shardValue = getShardValue(currentShardId);
      let shardChanged = false;

      for (const existingPath of Object.keys(shardValue)) {
        const existingBase = stripTrailingSlash(existingPath);

        if (existingBase === normalizedBase || existingBase.startsWith(`${normalizedBase}/`)) {
          delete shardValue[existingPath];
          options.changedProjectPaths?.add?.(existingPath);
          shardChanged = true;
          changed = true;
        }
      }

      if (!shardChanged) {
        continue;
      }

      markVersion(currentShardId);

      if (Object.keys(shardValue).length === 0) {
        delete getArea()[currentShardId];
        loadedShardIds.delete(currentShardId);
        staleShardIds.delete(currentShardId);
        removeAreaIfEmpty(FILE_INDEX_AREA);
        applyLocalStateEntry(currentShardId, null);
      } else {
        applyLocalStateEntry(currentShardId, shardValue);
      }
    }

    return changed;
  }

  function removeEntryCandidates(projectPaths = [], options = {}) {
    let changed = false;

    for (const candidatePath of Array.isArray(projectPaths) ? projectPaths : []) {
      if (!candidatePath || !getPathEntry(candidatePath)) {
        continue;
      }

      deletePathEntry(candidatePath);
      options.changedProjectPaths?.add?.(candidatePath);
      changed = true;
    }

    return changed;
  }

  function listProjectPaths() {
    return listShardIds()
      .flatMap((shardId) => Object.keys(getShardValue(shardId)))
      .sort((left, right) => left.localeCompare(right));
  }

  function createPathIndexSnapshot() {
    const nextPathIndex = createEmptyRecordMap();

    listShardIds().forEach((shardId) => {
      Object.entries(getShardValue(shardId)).forEach(([projectPath, metadata]) => {
        nextPathIndex[projectPath] =
          metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? { ...metadata }
            : metadata;
      });
    });

    return nextPathIndex;
  }

  function collectShardChanges(shardId, nextShardValue = createEmptyRecordMap(), createChangeEvent) {
    const previousShardValue = getShardValue(shardId);
    const projectPaths = [
      ...new Set([
        ...Object.keys(previousShardValue),
        ...Object.keys(nextShardValue || createEmptyRecordMap())
      ])
    ].sort((left, right) => left.localeCompare(right));
    const changes = [];

    for (const projectPath of projectPaths) {
      const previousMetadata = previousShardValue[projectPath] || null;
      const nextMetadata = nextShardValue?.[projectPath] || null;

      if (isPathIndexEntryEqual(previousMetadata, nextMetadata)) {
        continue;
      }

      changes.push(
        createChangeEvent(
          projectPath,
          nextMetadata || previousMetadata,
          nextMetadata ? "upsert" : "delete"
        )
      );
    }

    return changes;
  }

  function replaceShard(shardId, nextShardValue = createEmptyRecordMap(), options = {}) {
    const normalizedShardId = normalizeShardId(shardId);

    if (!normalizedShardId) {
      return [];
    }

    const changes = collectShardChanges(
      normalizedShardId,
      nextShardValue,
      options.createChangeEvent
    );

    if (changes.length > 0 || !hasShard(normalizedShardId)) {
      applyShard(normalizedShardId, nextShardValue, {
        fullyLoaded: options.fullyLoaded === true,
        version: options.version
      });
    } else if (options.fullyLoaded === true) {
      loadedShardIds.add(normalizedShardId);
      staleShardIds.delete(normalizedShardId);
    }

    return changes;
  }

  function replaceShards(nextFileIndexShards = createEmptyRecordMap(), options = {}) {
    const scopedShardIds = Array.isArray(options.shardIds)
      ? [...new Set(options.shardIds)].sort((left, right) => left.localeCompare(right))
      : [
          ...new Set([
            ...listShardIds().filter((shardId) => options.includeShard?.(shardId) !== false),
            ...Object.keys(nextFileIndexShards || createEmptyRecordMap())
          ])
        ].sort((left, right) => left.localeCompare(right));
    const changes = [];

    for (const shardId of scopedShardIds) {
      if (options.includeShard && options.includeShard(shardId) === false) {
        continue;
      }

      changes.push(
        ...replaceShard(shardId, nextFileIndexShards?.[shardId] || createEmptyRecordMap(), {
          createChangeEvent: options.createChangeEvent,
          fullyLoaded: options.fullyLoadedShardIds?.has?.(shardId) || options.fullyLoaded === true
        })
      );
    }

    return changes;
  }

  function isShardFullyLoaded(shardId = "") {
    const normalizedShardId = normalizeShardId(shardId);

    if (!normalizedShardId) {
      return false;
    }

    return !isL2FileIndexShardId(normalizedShardId) || loadedShardIds.has(normalizedShardId);
  }

  function isShardCurrent(shardId = "") {
    const normalizedShardId = normalizeShardId(shardId);
    return Boolean(
      normalizedShardId &&
        isShardFullyLoaded(normalizedShardId) &&
        !staleShardIds.has(normalizedShardId)
    );
  }

  function getShardSnapshot(shardId = "", options = {}) {
    const normalizedShardId = normalizeShardId(shardId);

    if (!normalizedShardId) {
      return null;
    }

    if (!hasShard(normalizedShardId)) {
      if (options.includeEmpty !== true) {
        return null;
      }

      return {
        fullyLoaded: false,
        id: normalizedShardId,
        value: createEmptyRecordMap(),
        version: getShardVersion(normalizedShardId)
      };
    }

    return {
      fullyLoaded: isShardFullyLoaded(normalizedShardId),
      id: normalizedShardId,
      value: clonePathIndex(getShardValue(normalizedShardId)),
      version: getShardVersion(normalizedShardId)
    };
  }

  function applyLazyShards(shards = []) {
    for (const shard of Array.isArray(shards) ? shards : []) {
      const shardId = normalizeShardId(shard?.id);

      if (!shardId) {
        continue;
      }

      applyShard(shardId, shard.value || createEmptyRecordMap(), {
        fullyLoaded: shard.fullyLoaded === true,
        version: Number(shard.version) || null
      });
    }
  }

  function markShardStale(shardId = "", version = 0) {
    const normalizedShardId = normalizeShardId(shardId);

    if (!normalizedShardId || !isL2FileIndexShardId(normalizedShardId)) {
      return false;
    }

    const remoteVersion = Number(version) || 0;
    const currentVersion = getShardVersion(normalizedShardId);

    if (remoteVersion > 0 && currentVersion >= remoteVersion) {
      return false;
    }

    if (!hasShard(normalizedShardId) && !loadedShardIds.has(normalizedShardId)) {
      return false;
    }

    staleShardIds.add(normalizedShardId);
    return true;
  }

  function applyInvalidations(invalidations = []) {
    let changed = false;

    for (const invalidation of Array.isArray(invalidations) ? invalidations : []) {
      if (markShardStale(invalidation?.id, invalidation?.version)) {
        changed = true;
      }
    }

    return changed;
  }

  function createInvalidations(shardIds = []) {
    return [...new Set((Array.isArray(shardIds) ? shardIds : []).map(normalizeShardId).filter(Boolean))]
      .filter(isL2FileIndexShardId)
      .map((shardId) => ({
        id: shardId,
        version: getShardVersion(shardId)
      }))
      .filter((entry) => entry.version > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function getPreviousLocalL2ShardIds() {
    return listShardIds().filter(isL2FileIndexShardId);
  }

  function clearLocalStateEntries(shardIds = []) {
    const entries = (Array.isArray(shardIds) ? shardIds : [])
      .map(normalizeShardId)
      .filter(Boolean)
      .map((shardId) => ({
        area: FILE_INDEX_AREA,
        deleted: true,
        id: shardId,
        replicated: false
      }));

    if (entries.length > 0 && stateSystem && typeof stateSystem.applyLocalEntries === "function") {
      stateSystem.applyLocalEntries(entries, {
        version: getCurrentVersion()
      });
    }
  }

  return {
    applyInvalidations,
    applyLazyShards,
    applyShard,
    clearLocalStateEntries,
    clonePathIndex,
    createInvalidations,
    createPathIndexSnapshot,
    deletePathEntry,
    getArea,
    getPathEntry,
    getPreviousLocalL2ShardIds,
    getShardSnapshot,
    getShardValue,
    getShardVersion,
    hasShard,
    hydrateFromReplicatedState,
    isShardCurrent,
    isShardFullyLoaded,
    listProjectPaths,
    listShardIds,
    removeEntries,
    removeEntryCandidates,
    replaceShard,
    replaceShards,
    setPathEntry,
    shouldReplicateFileIndexShard
  };
}

export {
  clonePathIndex,
  createFileIndexStore,
  isL2FileIndexShardId,
  isPathIndexEntryEqual,
  shouldReplicateFileIndexShard
};
