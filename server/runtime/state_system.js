import { isDeepStrictEqual } from "node:util";

import { createIpcRequestId } from "./ipc.js";

const DEFAULT_DELTA_RETENTION = 1_000;
const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_LOCK_WAIT_MS = 5_000;
const STATE_VERSION_HEADER = "Space-State-Version";

function cloneStateValue(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function createEmptyAreaMap() {
  return Object.create(null);
}

function normalizeArea(area) {
  const normalizedArea = String(area || "").trim();

  if (!normalizedArea) {
    throw new Error("State area is required.");
  }

  return normalizedArea;
}

function normalizeId(id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    throw new Error("State id is required.");
  }

  return normalizedId;
}

function normalizeDurationMs(value, fallbackMs = 0) {
  const normalizedValue = Math.floor(Number(value));
  return Number.isFinite(normalizedValue) && normalizedValue > 0 ? normalizedValue : fallbackMs;
}

function normalizeVersion(value, fallbackVersion = 0) {
  const normalizedValue = Math.floor(Number(value));
  return Number.isFinite(normalizedValue) && normalizedValue >= 0 ? normalizedValue : fallbackVersion;
}

function createStateVersionGapError(fromVersion, currentVersion) {
  const error = new Error(
    `State delta gap detected: expected ${currentVersion}, received ${fromVersion}.`
  );
  error.code = "STATE_VERSION_GAP";
  error.currentVersion = currentVersion;
  error.fromVersion = fromVersion;
  return error;
}

function serializeEntry(entry = null) {
  if (!entry) {
    return null;
  }

  return {
    area: String(entry.area || ""),
    id: String(entry.id || ""),
    expiresAtMs: Number(entry.expiresAtMs) || 0,
    replicated: entry.replicated !== false,
    updatedAtMs: Number(entry.updatedAtMs) || 0,
    value: cloneStateValue(entry.value),
    version: Number(entry.version) || 0
  };
}

function createVersionWaitResult(version, satisfied, timedOut) {
  return {
    satisfied: Boolean(satisfied),
    timedOut: Boolean(timedOut),
    version: normalizeVersion(version)
  };
}

function createStateSystem(options = {}) {
  const replica = options.replica === true;
  const deltaRetention = normalizeDurationMs(
    options.deltaRetention,
    DEFAULT_DELTA_RETENTION
  );
  const entriesByArea = Object.create(null);
  const deltaLog = [];
  const locks = new Map();
  const waitQueues = new Map();
  const versionWaiters = new Set();
  let replicatedVersion = normalizeVersion(options.version, 0);

  function ensureAreaEntries(area) {
    const normalizedArea = normalizeArea(area);

    if (!entriesByArea[normalizedArea]) {
      entriesByArea[normalizedArea] = createEmptyAreaMap();
    }

    return entriesByArea[normalizedArea];
  }

  function getAreaEntries(area) {
    const normalizedArea = normalizeArea(area);
    return entriesByArea[normalizedArea] || null;
  }

  function removeAreaIfEmpty(area) {
    const normalizedArea = normalizeArea(area);
    const areaEntries = entriesByArea[normalizedArea];

    if (areaEntries && Object.keys(areaEntries).length === 0) {
      delete entriesByArea[normalizedArea];
    }
  }

  function removeExpiredEntry(area, id) {
    const normalizedArea = normalizeArea(area);
    const normalizedId = normalizeId(id);
    const areaEntries = entriesByArea[normalizedArea];

    if (!areaEntries) {
      return null;
    }

    const entry = areaEntries[normalizedId];

    if (!entry) {
      return null;
    }

    if (Number(entry.expiresAtMs) > 0 && Number(entry.expiresAtMs) <= Date.now()) {
      delete areaEntries[normalizedId];
      removeAreaIfEmpty(normalizedArea);
      return null;
    }

    return entry;
  }

  function resolveVersionWaiters() {
    for (const waiter of versionWaiters) {
      if (replicatedVersion < waiter.minVersion) {
        continue;
      }

      clearTimeout(waiter.timeoutId);
      versionWaiters.delete(waiter);
      waiter.resolve(createVersionWaitResult(replicatedVersion, true, false));
    }
  }

  function maybeGrantNextWaiter(lockKey) {
    const currentLock = ensureFreshLock(lockKey);

    if (currentLock) {
      return;
    }

    const queue = waitQueues.get(lockKey);

    if (!queue || queue.length === 0) {
      waitQueues.delete(lockKey);
      return;
    }

    const waiter = queue.shift();

    if (!waiter) {
      maybeGrantNextWaiter(lockKey);
      return;
    }

    clearTimeout(waiter.timeoutId);

    const now = Date.now();
    const lockRecord = {
      area: waiter.area,
      expiresAtMs: now + waiter.ttlMs,
      id: waiter.id,
      lockToken: createIpcRequestId("state-lock")
    };

    locks.set(lockKey, lockRecord);

    if (queue.length === 0) {
      waitQueues.delete(lockKey);
    }

    waiter.resolve({
      acquired: true,
      area: waiter.area,
      expiresAtMs: lockRecord.expiresAtMs,
      id: waiter.id,
      lockToken: lockRecord.lockToken
    });
  }

  function buildLockKey(area, id) {
    return `${normalizeArea(area)}:${normalizeId(id)}`;
  }

  function ensureFreshLock(lockKey) {
    const currentLock = locks.get(lockKey);

    if (
      currentLock &&
      Number(currentLock.expiresAtMs) > 0 &&
      Number(currentLock.expiresAtMs) <= Date.now()
    ) {
      locks.delete(lockKey);
    }

    return locks.get(lockKey) || null;
  }

  function getVersion() {
    return replicatedVersion;
  }

  function waitForVersion(minVersion, options = {}) {
    const normalizedMinVersion = normalizeVersion(minVersion, 0);

    if (replicatedVersion >= normalizedMinVersion) {
      return Promise.resolve(createVersionWaitResult(replicatedVersion, true, false));
    }

    const timeoutMs = Math.max(0, Math.floor(Number(options.timeoutMs) || 0));

    return new Promise((resolve) => {
      const waiter = {
        minVersion: normalizedMinVersion,
        resolve,
        timeoutId: null
      };

      if (timeoutMs > 0) {
        waiter.timeoutId = setTimeout(() => {
          versionWaiters.delete(waiter);
          resolve(createVersionWaitResult(replicatedVersion, false, true));
        }, timeoutMs);
        waiter.timeoutId.unref?.();
      }

      versionWaiters.add(waiter);
    });
  }

  function getEntry(area, id) {
    return serializeEntry(removeExpiredEntry(area, id));
  }

  function getValue(area, id) {
    const entry = removeExpiredEntry(area, id);
    return entry ? cloneStateValue(entry.value) : null;
  }

  function getAreaValues(area, options = {}) {
    const normalizedArea = normalizeArea(area);
    const replicatedOnly = options.replicatedOnly === true;
    const areaEntries = getAreaEntries(normalizedArea);

    if (!areaEntries) {
      return createEmptyAreaMap();
    }

    const output = createEmptyAreaMap();

    Object.keys(areaEntries).forEach((id) => {
      const entry = removeExpiredEntry(normalizedArea, id);

      if (!entry) {
        return;
      }

      if (replicatedOnly && entry.replicated === false) {
        return;
      }

      output[id] = cloneStateValue(entry.value);
    });

    return output;
  }

  function listAreaIds(area, options = {}) {
    const normalizedArea = normalizeArea(area);
    const replicatedOnly = options.replicatedOnly === true;
    const areaEntries = getAreaEntries(normalizedArea);

    if (!areaEntries) {
      return [];
    }

    return Object.keys(areaEntries)
      .filter((id) => {
        const entry = removeExpiredEntry(normalizedArea, id);
        return Boolean(entry && (!replicatedOnly || entry.replicated !== false));
      })
      .sort((left, right) => left.localeCompare(right));
  }

  function getReplicatedSnapshot() {
    const state = createEmptyAreaMap();

    Object.keys(entriesByArea).forEach((area) => {
      const areaValues = getAreaValues(area, {
        replicatedOnly: true
      });

      if (Object.keys(areaValues).length > 0) {
        state[area] = areaValues;
      }
    });

    return {
      state,
      version: replicatedVersion
    };
  }

  function trimDeltaLog() {
    if (deltaLog.length <= deltaRetention) {
      return;
    }

    deltaLog.splice(0, deltaLog.length - deltaRetention);
  }

  function getDeltaSince(fromVersion) {
    const normalizedFromVersion = normalizeVersion(fromVersion, 0);

    if (normalizedFromVersion >= replicatedVersion) {
      return {
        changes: [],
        fromVersion: normalizedFromVersion,
        toVersion: replicatedVersion
      };
    }

    const deltas = deltaLog.filter((delta) => Number(delta.toVersion) > normalizedFromVersion);

    if (deltas.length === 0 || Number(deltas[0].fromVersion) !== normalizedFromVersion) {
      return null;
    }

    return {
      changes: deltas.flatMap((delta) => delta.changes.map((change) => ({
        ...change,
        value: change.deleted ? undefined : cloneStateValue(change.value)
      }))),
      fromVersion: normalizedFromVersion,
      toVersion: deltas[deltas.length - 1].toVersion
    };
  }

  function applyNormalizedReplicatedChange(change, version) {
    const normalizedArea = normalizeArea(change.area);
    const normalizedId = normalizeId(change.id);
    const areaEntries = ensureAreaEntries(normalizedArea);

    if (change.deleted) {
      delete areaEntries[normalizedId];
      removeAreaIfEmpty(normalizedArea);
      return;
    }

    areaEntries[normalizedId] = {
      area: normalizedArea,
      expiresAtMs: 0,
      id: normalizedId,
      replicated: true,
      updatedAtMs: Date.now(),
      value: cloneStateValue(change.value),
      version
    };
  }

  function applySnapshot(snapshot = {}) {
    const normalizedVersion = normalizeVersion(snapshot.version, replicatedVersion);
    const nextState =
      snapshot.state && typeof snapshot.state === "object" && !Array.isArray(snapshot.state)
        ? snapshot.state
        : createEmptyAreaMap();

    Object.keys(entriesByArea).forEach((area) => {
      const areaEntries = entriesByArea[area];

      Object.keys(areaEntries || {}).forEach((id) => {
        const entry = areaEntries[id];

        if (entry?.replicated !== false) {
          delete areaEntries[id];
        }
      });

      removeAreaIfEmpty(area);
    });

    Object.entries(nextState).forEach(([area, areaValues]) => {
      if (!areaValues || typeof areaValues !== "object" || Array.isArray(areaValues)) {
        return;
      }

      Object.entries(areaValues).forEach(([id, value]) => {
        applyNormalizedReplicatedChange(
          {
            area,
            id,
            value
          },
          normalizedVersion
        );
      });
    });

    replicatedVersion = normalizedVersion;
    resolveVersionWaiters();

    return getReplicatedSnapshot();
  }

  function applyDelta(delta = {}) {
    const fromVersion = normalizeVersion(delta.fromVersion, replicatedVersion);
    const toVersion = normalizeVersion(delta.toVersion, fromVersion);
    const changes = Array.isArray(delta.changes) ? delta.changes : [];

    if (toVersion <= replicatedVersion) {
      return {
        applied: false,
        version: replicatedVersion
      };
    }

    if (fromVersion !== replicatedVersion) {
      throw createStateVersionGapError(fromVersion, replicatedVersion);
    }

    changes.forEach((change) => {
      applyNormalizedReplicatedChange(change, toVersion);
    });

    replicatedVersion = toVersion;
    resolveVersionWaiters();

    return {
      applied: true,
      version: replicatedVersion
    };
  }

  function applyLocalEntries(entries = [], options = {}) {
    const normalizedVersion = normalizeVersion(options.version, replicatedVersion);

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const normalizedArea = normalizeArea(entry?.area);
      const normalizedId = normalizeId(entry?.id);
      const areaEntries = ensureAreaEntries(normalizedArea);

      if (entry.deleted) {
        delete areaEntries[normalizedId];
        removeAreaIfEmpty(normalizedArea);
        return;
      }

      areaEntries[normalizedId] = {
        area: normalizedArea,
        expiresAtMs: 0,
        id: normalizedId,
        replicated: entry.replicated !== false,
        updatedAtMs: Date.now(),
        value: cloneStateValue(entry.value),
        version: normalizedVersion
      };
    });

    if (normalizedVersion > replicatedVersion) {
      replicatedVersion = normalizedVersion;
      resolveVersionWaiters();
    }

    return {
      version: replicatedVersion
    };
  }

  function commitEntries(changes = []) {
    if (replica) {
      throw new Error("Replica state systems cannot commit authoritative changes.");
    }

    const normalizedChanges = Array.isArray(changes) ? changes : [];
    const localChanges = [];
    const replicatedChanges = [];
    const changedReplicatedEntries = [];
    let nextReplicatedVersion = replicatedVersion;

    normalizedChanges.forEach((change) => {
      const normalizedArea = normalizeArea(change.area);
      const normalizedId = normalizeId(change.id);
      const replicate = change.replicate !== false;
      const existingEntry = removeExpiredEntry(normalizedArea, normalizedId);
      const areaEntries = entriesByArea[normalizedArea] || null;

      if (change.deleted) {
        if (!existingEntry) {
          return;
        }

        delete areaEntries[normalizedId];
        removeAreaIfEmpty(normalizedArea);

        const serializedChange = {
          area: normalizedArea,
          deleted: true,
          id: normalizedId
        };

        if (existingEntry.replicated !== false) {
          replicatedChanges.push(serializedChange);
        } else {
          localChanges.push(serializedChange);
        }
        return;
      }

      const clonedValue = cloneStateValue(change.value);
      const updatedAtMs = Date.now();
      const expiresInMs = normalizeDurationMs(change.expiresInMs, 0);
      const expiresAtMs = expiresInMs > 0 ? updatedAtMs + expiresInMs : 0;

      if (
        existingEntry &&
        existingEntry.replicated === replicate &&
        Number(existingEntry.expiresAtMs) === Number(expiresAtMs) &&
        isDeepStrictEqual(existingEntry.value, clonedValue)
      ) {
        return;
      }

      const nextEntry = {
        area: normalizedArea,
        expiresAtMs,
        id: normalizedId,
        replicated: replicate,
        updatedAtMs,
        value: clonedValue,
        version: replicate ? replicatedVersion + 1 : Number(existingEntry?.version) || 0
      };

      ensureAreaEntries(normalizedArea)[normalizedId] = nextEntry;

      const serializedChange = {
        area: normalizedArea,
        deleted: false,
        id: normalizedId,
        value: cloneStateValue(clonedValue)
      };

      if (replicate) {
        replicatedChanges.push(serializedChange);
        changedReplicatedEntries.push(nextEntry);
      } else {
        localChanges.push(serializedChange);
      }
    });

    let delta = null;

    if (replicatedChanges.length > 0) {
      nextReplicatedVersion = replicatedVersion + 1;
      changedReplicatedEntries.forEach((entry) => {
        entry.version = nextReplicatedVersion;
      });

      delta = {
        changes: replicatedChanges.map((change) => ({
          ...change,
          value: change.deleted ? undefined : cloneStateValue(change.value)
        })),
        fromVersion: replicatedVersion,
        toVersion: nextReplicatedVersion
      };

      replicatedVersion = nextReplicatedVersion;
      deltaLog.push(delta);
      trimDeltaLog();
      resolveVersionWaiters();
    }

    return {
      delta,
      localChanges,
      changes: replicatedChanges,
      version: replicatedVersion
    };
  }

  function setEntry(area, id, value, options = {}) {
    const result = commitEntries([
      {
        area,
        expiresInMs: options.expiresInMs,
        id,
        replicate: options.replicate,
        value
      }
    ]);

    const entry =
      getEntry(area, id) || {
      area: normalizeArea(area),
      id: normalizeId(id),
      version: result.version
      };

    return {
      ...entry,
      delta: result.delta || null
    };
  }

  function deleteEntry(area, id) {
    const previousEntry = getEntry(area, id);

    if (!previousEntry) {
      return {
        deleted: false,
        entry: null,
        version: replicatedVersion
      };
    }

    const result = commitEntries([
      {
        area,
        deleted: true,
        id
      }
    ]);

    return {
      deleted: true,
      delta: result.delta || null,
      entry: previousEntry,
      version: result.version
    };
  }

  function takeEntry(area, id) {
    const previousEntry = getEntry(area, id);

    if (!previousEntry) {
      return null;
    }

    if (previousEntry.replicated) {
      throw new Error("takeEntry() only supports primary-only state entries.");
    }

    commitEntries([
      {
        area,
        deleted: true,
        id
      }
    ]);

    return previousEntry;
  }

  function acquireLock(area, id, options = {}) {
    const normalizedArea = normalizeArea(area);
    const normalizedId = normalizeId(id);
    const lockKey = buildLockKey(normalizedArea, normalizedId);
    const ttlMs = normalizeDurationMs(options.ttlMs, DEFAULT_LOCK_TTL_MS);
    const normalizedWaitMs = Math.floor(Number(options.waitMs));
    const waitMs =
      Number.isFinite(normalizedWaitMs) && normalizedWaitMs >= 0
        ? normalizedWaitMs
        : DEFAULT_LOCK_WAIT_MS;
    const currentLock = ensureFreshLock(lockKey);

    if (!currentLock) {
      const lockRecord = {
        area: normalizedArea,
        expiresAtMs: Date.now() + ttlMs,
        id: normalizedId,
        lockToken: createIpcRequestId("state-lock")
      };

      locks.set(lockKey, lockRecord);

      return Promise.resolve({
        acquired: true,
        area: normalizedArea,
        expiresAtMs: lockRecord.expiresAtMs,
        id: normalizedId,
        lockToken: lockRecord.lockToken
      });
    }

    if (waitMs <= 0) {
      return Promise.resolve({
        acquired: false,
        area: normalizedArea,
        expiresAtMs: Number(currentLock.expiresAtMs) || 0,
        id: normalizedId,
        lockToken: ""
      });
    }

    return new Promise((resolve) => {
      const queue = waitQueues.get(lockKey) || [];
      const waiter = {
        area: normalizedArea,
        id: normalizedId,
        resolve,
        timeoutId: null,
        ttlMs
      };

      waiter.timeoutId = setTimeout(() => {
        const activeQueue = waitQueues.get(lockKey) || [];
        const waiterIndex = activeQueue.indexOf(waiter);

        if (waiterIndex >= 0) {
          activeQueue.splice(waiterIndex, 1);
        }

        if (activeQueue.length === 0) {
          waitQueues.delete(lockKey);
        }

        resolve({
          acquired: false,
          area: normalizedArea,
          expiresAtMs: 0,
          id: normalizedId,
          lockToken: ""
        });
      }, waitMs);

      waiter.timeoutId.unref?.();
      queue.push(waiter);
      waitQueues.set(lockKey, queue);
    });
  }

  function releaseLock(area, id, lockToken) {
    const lockKey = buildLockKey(area, id);
    const currentLock = ensureFreshLock(lockKey);

    if (!currentLock || currentLock.lockToken !== String(lockToken || "")) {
      return false;
    }

    locks.delete(lockKey);
    maybeGrantNextWaiter(lockKey);
    return true;
  }

  return {
    acquireLock,
    applyDelta,
    applyLocalEntries,
    applySnapshot,
    commitEntries,
    deleteEntry,
    getAreaValues,
    getDeltaSince,
    getEntry,
    getReplicatedSnapshot,
    getValue,
    getVersion,
    listAreaIds,
    releaseLock,
    setEntry,
    takeEntry,
    waitForVersion
  };
}

function normalizeStateVersionHeaderValue(value) {
  const normalizedVersion = Math.floor(Number(value));
  return Number.isFinite(normalizedVersion) && normalizedVersion >= 0 ? normalizedVersion : 0;
}

export {
  STATE_VERSION_HEADER,
  cloneStateValue,
  createStateSystem,
  createStateVersionGapError,
  normalizeStateVersionHeaderValue,
  serializeEntry
};
