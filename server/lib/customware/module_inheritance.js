import { isProjectPathWithinMaxLayer } from "./layer_limit.js";
import {
  normalizeModuleRequestPath,
  parseProjectModuleFilePath,
  resolveProjectAbsolutePath
} from "./layout.js";
import {
  collectProjectPathsFromFileIndexShards,
  collectReadableModuleShardIds,
  getRuntimeGroupIndexFromStateSystem
} from "./module_state.js";
import { createEmptyGroupIndex, filterAccessibleModulePaths } from "./overrides.js";

function findCandidateModuleProjectPaths(options = {}) {
  const filePaths = collectProjectPathsFromFileIndexShards(
    options.stateSystem,
    collectReadableModuleShardIds({
      groupIndex: options.groupIndex,
      maxLayer: options.maxLayer,
      username: options.username
    })
  );

  return filePaths.filter((projectPath) => {
    if (!isProjectPathWithinMaxLayer(projectPath, options.maxLayer)) {
      return false;
    }

    const modulePathInfo = parseProjectModuleFilePath(projectPath);
    return Boolean(modulePathInfo && modulePathInfo.requestPath === options.requestPath);
  });
}

function resolveInheritedModuleProjectPath({
  maxLayer,
  projectRoot,
  requestPath,
  runtimeParams,
  stateSystem,
  username,
}) {
  const normalizedRequestPath = normalizeModuleRequestPath(requestPath);

  if (!normalizedRequestPath || !stateSystem) {
    return null;
  }

  const groupIndex = getRuntimeGroupIndexFromStateSystem(stateSystem, runtimeParams) || createEmptyGroupIndex();
  const candidatePaths = findCandidateModuleProjectPaths({
    groupIndex,
    maxLayer,
    requestPath: normalizedRequestPath,
    stateSystem,
    username
  });
  const accessiblePaths = filterAccessibleModulePaths(candidatePaths, username, groupIndex, {
    maxLayer
  });
  const selectedProjectPath = accessiblePaths.length > 0 ? accessiblePaths[accessiblePaths.length - 1] : "";

  if (!selectedProjectPath) {
    return null;
  }

  return {
    absolutePath: resolveProjectAbsolutePath(projectRoot, selectedProjectPath, runtimeParams),
    candidatePaths,
    projectPath: selectedProjectPath,
    requestPath: normalizedRequestPath
  };
}

export {
  createEmptyGroupIndex,
  findCandidateModuleProjectPaths,
  filterAccessibleModulePaths,
  resolveInheritedModuleProjectPath
};
