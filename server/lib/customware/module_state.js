import {
  createRuntimeGroupIndexFromAreas,
  getFileIndexShardId
} from "../file_watch/state_shards.js";
import {
  FILE_INDEX_AREA,
  GROUP_INDEX_AREA,
  GROUP_META_AREA,
  GROUP_USER_INDEX_AREA
} from "../../runtime/state_areas.js";
import { createRuntimeGroupIndex } from "./group_runtime.js";
import { normalizeMaxLayer } from "./layer_limit.js";
import { normalizeEntityId } from "./layout.js";
import { createEmptyGroupIndex } from "./overrides.js";

function createEmptyRecordMap() {
  return Object.create(null);
}

function hasStateGetter(stateSystem, methodName) {
  return Boolean(
    stateSystem &&
      typeof stateSystem === "object" &&
      !Array.isArray(stateSystem) &&
      typeof stateSystem[methodName] === "function"
  );
}

function getStateValue(stateSystem, area, id) {
  if (!hasStateGetter(stateSystem, "getValue")) {
    return null;
  }

  return stateSystem.getValue(area, id);
}

function getStateAreaValues(stateSystem, area) {
  if (!hasStateGetter(stateSystem, "getAreaValues")) {
    return createEmptyRecordMap();
  }

  const values = stateSystem.getAreaValues(area);
  return values && typeof values === "object" && !Array.isArray(values) ? values : createEmptyRecordMap();
}

function listStateAreaIds(stateSystem, area) {
  if (!hasStateGetter(stateSystem, "listAreaIds")) {
    return [];
  }

  return stateSystem.listAreaIds(area);
}

function stripTrailingSlash(value) {
  const text = String(value || "");
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

function getProjectPathLookupCandidates(projectPath) {
  const normalizedPath = String(projectPath || "");

  if (!normalizedPath) {
    return [];
  }

  const basePath = stripTrailingSlash(normalizedPath);
  return normalizedPath.endsWith("/") ? [normalizedPath, basePath] : [normalizedPath, `${basePath}/`];
}

function listReadableModuleGroupIds(groupIndex, username) {
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

  orderedGroups.forEach((groupId) => {
    if (groupId && groupId !== "_all") {
      groupIds.push(groupId);
    }
  });

  return [...new Set(groupIds)];
}

function getRuntimeGroupIndexFromStateSystem(stateSystem, runtimeParams) {
  if (!stateSystem) {
    return createRuntimeGroupIndex(createEmptyGroupIndex(), runtimeParams);
  }

  return createRuntimeGroupIndex(
    createRuntimeGroupIndexFromAreas({
      [GROUP_INDEX_AREA]: getStateAreaValues(stateSystem, GROUP_INDEX_AREA),
      [GROUP_META_AREA]: getStateAreaValues(stateSystem, GROUP_META_AREA),
      [GROUP_USER_INDEX_AREA]: getStateAreaValues(stateSystem, GROUP_USER_INDEX_AREA)
    }),
    runtimeParams
  );
}

function getFileIndexShardValue(stateSystem, shardId) {
  const normalizedShardId = String(shardId || "").trim();

  if (!normalizedShardId) {
    return createEmptyRecordMap();
  }

  const shardValue = getStateValue(stateSystem, FILE_INDEX_AREA, normalizedShardId);
  return shardValue && typeof shardValue === "object" && !Array.isArray(shardValue)
    ? shardValue
    : createEmptyRecordMap();
}

function collectProjectPathsFromFileIndexShards(stateSystem, shardIds = []) {
  const projectPaths = new Set();

  (Array.isArray(shardIds) ? shardIds : []).forEach((shardId) => {
    Object.keys(getFileIndexShardValue(stateSystem, shardId)).forEach((projectPath) => {
      projectPaths.add(projectPath);
    });
  });

  return [...projectPaths].sort((left, right) => left.localeCompare(right));
}

function collectReadableModuleShardIds(options = {}) {
  const maxLayer = normalizeMaxLayer(options.maxLayer);
  const shardIds = [];
  const groupIds = listReadableModuleGroupIds(options.groupIndex || createEmptyGroupIndex(), options.username);

  if (maxLayer >= 0 && options.includeL0 !== false) {
    shardIds.push("L0");
  }

  if (maxLayer >= 1 && options.includeL1 !== false) {
    groupIds.forEach((groupId) => {
      shardIds.push(`L1/${groupId}`);
    });
  }

  if (maxLayer >= 2 && options.includeL2 !== false) {
    const normalizedUsername = normalizeEntityId(options.username);

    if (normalizedUsername) {
      shardIds.push(`L2/${normalizedUsername}`);
    }
  }

  return [...new Set(shardIds)];
}

function hasIndexedProjectPath(stateSystem, projectPath) {
  const shardId = getFileIndexShardId(projectPath);

  if (!shardId) {
    return false;
  }

  const shardValue = getFileIndexShardValue(stateSystem, shardId);
  return getProjectPathLookupCandidates(projectPath).some((candidate) => Boolean(shardValue[candidate]));
}

export {
  collectProjectPathsFromFileIndexShards,
  collectReadableModuleShardIds,
  getFileIndexShardValue,
  getRuntimeGroupIndexFromStateSystem,
  hasIndexedProjectPath,
  listReadableModuleGroupIds,
  listStateAreaIds
};
