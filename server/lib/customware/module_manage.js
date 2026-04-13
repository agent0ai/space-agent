import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FILE_INDEX_AREA } from "../../runtime/state_areas.js";
import { cloneGitRepository, createGitClient } from "../git/client_create.js";
import { sanitizeRemoteUrl } from "../git/shared.js";
import { createAppAccessController, createHttpError, toAppRelativePath } from "./file_access.js";
import { recordAppPathMutations } from "./git_history.js";
import { getLayerOrder, normalizeMaxLayer } from "./layer_limit.js";
import {
  normalizeEntityId,
  normalizeAppProjectPath,
  parseModuleDirectoryRequestPath,
  parseProjectModuleDirectoryPath,
  resolveProjectAbsolutePath
} from "./layout.js";
import {
  collectProjectPathsFromFileIndexShards,
  collectReadableModuleShardIds,
  getFileIndexShardValue,
  getRuntimeGroupIndexFromStateSystem,
  listReadableModuleGroupIds,
  listStateAreaIds
} from "./module_state.js";
import { collectAccessibleModuleEntries } from "./overrides.js";
import {
  applyUserFolderQuotaPlan,
  createUserFolderQuotaPlan,
  invalidateUserFolderSizeCacheForProjectPaths,
  readAbsolutePathSize
} from "./user_quota.js";

const DEFAULT_REMOTE = "origin";
const DEFAULT_REMOTE_FETCH = "+refs/heads/*:refs/remotes/origin/*";
const DEFAULT_MODULE_LIST_AREA = "l2_self";
const MODULE_LIST_AREAS = new Set(["l1", "l2_self", "l2_user", "l2_users"]);
const GIT_INFO_CONCURRENCY = 8;

function stripTrailingSlash(value) {
  const text = String(value || "");
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

function getGroupIndex(stateSystem, runtimeParams) {
  return getRuntimeGroupIndexFromStateSystem(stateSystem, runtimeParams);
}

function hasPath(pathIndex, projectPath) {
  return Boolean(pathIndex && projectPath && pathIndex[projectPath]);
}

function hasDescendantPath(pathIndex, projectPath) {
  const normalizedPath = String(projectPath || "");

  return Object.keys(pathIndex).some(
    (candidatePath) => candidatePath !== normalizedPath && candidatePath.startsWith(normalizedPath)
  );
}

function createAbsolutePath(projectRoot, projectPath, runtimeParams) {
  return resolveProjectAbsolutePath(projectRoot, projectPath, runtimeParams);
}

function createModulePathError(value) {
  return createHttpError(
    `Expected a module root path under L1/<group>/mod/<author>/<repo>/ or L2/<user>/mod/<author>/<repo>/: ${String(value || "")}`,
    400
  );
}

function normalizeModuleListArea(value) {
  const normalizedArea = String(value || "").trim().toLowerCase();

  if (!normalizedArea) {
    return DEFAULT_MODULE_LIST_AREA;
  }

  if (!MODULE_LIST_AREAS.has(normalizedArea)) {
    throw createHttpError(`Unsupported module list area: ${normalizedArea}`, 400);
  }

  return normalizedArea;
}

function normalizeModuleOwnerId(value) {
  const normalizedOwnerId = normalizeEntityId(value);
  return normalizedOwnerId || "";
}

function normalizeModuleSearch(value) {
  return String(value || "").trim().toLowerCase();
}

async function mapWithConcurrencyLimit(items, limit, mapper) {
  const inputItems = Array.isArray(items) ? items : [];
  const normalizedLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(inputItems.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(normalizedLimit, inputItems.length) },
    async () => {
      while (nextIndex < inputItems.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(inputItems[currentIndex], currentIndex);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

function matchesModuleSearch(modulePathInfo, normalizedSearch) {
  if (!normalizedSearch) {
    return true;
  }

  const authorId = String(modulePathInfo?.authorId || "").toLowerCase();
  const repositoryId = String(modulePathInfo?.repositoryId || "").toLowerCase();
  const moduleId = `${authorId}/${repositoryId}`;

  return (
    authorId.includes(normalizedSearch) ||
    repositoryId.includes(normalizedSearch) ||
    moduleId.includes(normalizedSearch)
  );
}

function compareModuleListEntries(left, right) {
  const leftModuleId = `${left.authorId}/${left.repositoryId}`;
  const rightModuleId = `${right.authorId}/${right.repositoryId}`;
  const moduleCompare = leftModuleId.localeCompare(rightModuleId);

  if (moduleCompare !== 0) {
    return moduleCompare;
  }

  const layerCompare = Number(getLayerOrder(left.layer)) - Number(getLayerOrder(right.layer));

  if (layerCompare !== 0) {
    return layerCompare;
  }

  const ownerTypeCompare = String(left.ownerType || "").localeCompare(String(right.ownerType || ""));

  if (ownerTypeCompare !== 0) {
    return ownerTypeCompare;
  }

  const ownerCompare = String(left.ownerId || "").localeCompare(String(right.ownerId || ""));

  if (ownerCompare !== 0) {
    return ownerCompare;
  }

  return String(left.projectPath || "").localeCompare(String(right.projectPath || ""));
}

function collectVisibleModuleDirectoryEntries(options = {}) {
  if (!options.stateSystem) {
    return [];
  }

  const groupIndex = getGroupIndex(options.stateSystem, options.runtimeParams);
  const accessController = createAppAccessController({
    groupIndex,
    runtimeParams: options.runtimeParams,
    username: options.username
  });
  const normalizedSearch = normalizeModuleSearch(options.search);
  const normalizedOwnerId = normalizeModuleOwnerId(options.ownerId);
  const includeOtherUsers = options.includeOtherUsers === true;
  const maxLayer = normalizeMaxLayer(options.maxLayer);
  const area = options.area ? normalizeModuleListArea(options.area) : "";
  const targetsOtherUser = normalizedOwnerId && normalizedOwnerId !== accessController.username;
  const requiresAdmin =
    area === "l2_users" ||
    includeOtherUsers ||
    targetsOtherUser ||
    (area === "l2_user" && normalizedOwnerId !== accessController.username);

  if (requiresAdmin && !accessController.isAdmin) {
    throw createHttpError("Admin access required.", 403);
  }

  if (area === "l2_user" && !normalizedOwnerId) {
    throw createHttpError("Module list area l2_user requires ownerId.", 400);
  }

  const shardIds = [];

  if (maxLayer >= 1 && area !== "l2_self" && area !== "l2_user" && area !== "l2_users") {
    listReadableModuleGroupIds(groupIndex, accessController.username).forEach((groupId) => {
      shardIds.push(`L1/${groupId}`);
    });
  }

  if (maxLayer >= 2 && area !== "l1") {
    if (area === "l2_self") {
      if (accessController.username) {
        shardIds.push(`L2/${accessController.username}`);
      }
    } else if (area === "l2_user") {
      shardIds.push(`L2/${normalizedOwnerId}`);
    } else if (area === "l2_users" || includeOtherUsers) {
      listStateAreaIds(options.stateSystem, FILE_INDEX_AREA)
        .filter((shardId) => shardId.startsWith("L2/"))
        .forEach((shardId) => {
          shardIds.push(shardId);
        });
    } else if (normalizedOwnerId) {
      shardIds.push(`L2/${normalizedOwnerId}`);
    } else if (accessController.username) {
      shardIds.push(`L2/${accessController.username}`);
    }
  }

  return collectProjectPathsFromFileIndexShards(options.stateSystem, shardIds)
    .map((projectPath) => parseProjectModuleDirectoryPath(projectPath))
    .filter(Boolean)
    .filter((entry) => entry.layer !== "L0")
    .filter((entry) => {
      const layerOrder = getLayerOrder(entry.layer);
      return layerOrder !== null && layerOrder <= maxLayer;
    })
    .filter((entry) => matchesModuleSearch(entry, normalizedSearch))
    .map((entry) => {
      const canRead = accessController.canReadProjectPath(entry.projectPath);
      const canWrite = accessController.canWriteProjectPath(entry.projectPath);

      return {
        ...entry,
        canRead,
        canWrite
      };
    })
    .filter((entry) => entry.canRead || entry.canWrite)
    .filter((entry) => {
      if (area === "l1") {
        return entry.layer === "L1";
      }

      if (area === "l2_self") {
        return entry.layer === "L2" && entry.ownerId === accessController.username;
      }

      if (area === "l2_user") {
        return entry.layer === "L2" && entry.ownerId === normalizedOwnerId;
      }

      if (area === "l2_users") {
        return entry.layer === "L2";
      }

      if (entry.layer === "L2") {
        if (normalizedOwnerId) {
          return entry.ownerId === normalizedOwnerId;
        }

        if (includeOtherUsers) {
          return true;
        }

        return entry.ownerId === accessController.username;
      }

      return true;
    })
    .sort(compareModuleListEntries);
}

function createModuleListItemId(entry, options = {}) {
  const area = String(options.area || "");

  if (options.aggregated === true) {
    return `${area}:aggregate:${entry.layer}:${entry.requestPath}`;
  }

  return `${area}:${entry.layer}:${entry.ownerType}:${entry.ownerId}:${entry.requestPath}`;
}

function compareResolvedModuleLocations(left, right) {
  if (left.rank !== null && right.rank !== null && left.rank !== right.rank) {
    return left.rank - right.rank;
  }

  if (left.rank !== null && right.rank === null) {
    return -1;
  }

  if (left.rank === null && right.rank !== null) {
    return 1;
  }

  return compareModuleListEntries(left, right);
}

function normalizeModuleTargetPath(inputPath, options = {}) {
  const normalizedProjectPath = normalizeAppProjectPath(inputPath, {
    isDirectory: true
  });
  const modulePathInfo = parseProjectModuleDirectoryPath(normalizedProjectPath);

  if (!normalizedProjectPath || !modulePathInfo) {
    throw createModulePathError(inputPath);
  }

  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.stateSystem, options.runtimeParams),
    runtimeParams: options.runtimeParams,
    username: options.username
  });

  if (!accessController.canWriteProjectPath(normalizedProjectPath)) {
    throw createHttpError("Write access denied.", 403);
  }

  return {
    ...modulePathInfo,
    absolutePath: createAbsolutePath(
      options.projectRoot,
      normalizedProjectPath,
      options.runtimeParams
    ),
    appPath: toAppRelativePath(normalizedProjectPath),
    projectPath: normalizedProjectPath
  };
}

function normalizeModuleReference(inputPath) {
  const requestPathInfo = parseModuleDirectoryRequestPath(inputPath);

  if (requestPathInfo) {
    return requestPathInfo;
  }

  const normalizedProjectPath = normalizeAppProjectPath(inputPath, {
    isDirectory: true
  });
  const modulePathInfo = parseProjectModuleDirectoryPath(normalizedProjectPath);

  if (!normalizedProjectPath || !modulePathInfo) {
    throw createModulePathError(inputPath);
  }

  return modulePathInfo;
}

async function readModuleGitInfo(options = {}) {
  const absolutePath = String(options.absolutePath || "");

  if (!absolutePath || !fs.existsSync(path.join(absolutePath, ".git"))) {
    return null;
  }

  try {
    const gitClient = await createGitClient({
      projectRoot: absolutePath
    });
    const [currentBranch, remoteUrl, headCommit, shortCommit] = await Promise.all([
      gitClient.readCurrentBranch(),
      gitClient.readConfig(`remote.${DEFAULT_REMOTE}.url`),
      gitClient.readHeadCommit(),
      gitClient.readShortCommit()
    ]);

    return {
      backend: gitClient.name,
      detached: !currentBranch,
      headCommit,
      remoteUrl: remoteUrl ? sanitizeRemoteUrl(remoteUrl) : null,
      shortCommit,
      branch: currentBranch
    };
  } catch (error) {
    return {
      error: error.message || "Failed to read Git repository info."
    };
  }
}

async function ensureRemoteConfig(gitClient, repoUrl) {
  const configuredRemoteUrl = repoUrl
    ? sanitizeRemoteUrl(repoUrl)
    : await gitClient.readConfig(`remote.${DEFAULT_REMOTE}.url`);

  if (!configuredRemoteUrl) {
    throw createHttpError("Module install requires a repository URL.", 400);
  }

  await gitClient.writeConfig(`remote.${DEFAULT_REMOTE}.url`, configuredRemoteUrl);

  const currentFetchSpec = await gitClient.readConfig(`remote.${DEFAULT_REMOTE}.fetch`);
  if (!currentFetchSpec) {
    await gitClient.writeConfig(`remote.${DEFAULT_REMOTE}.fetch`, DEFAULT_REMOTE_FETCH);
  }

  return configuredRemoteUrl;
}

async function updateTrackedBranch(gitClient, defaultBranch) {
  let branchName = await gitClient.readCurrentBranch();

  if (!branchName) {
    branchName = defaultBranch;
  }

  if (!branchName) {
    throw createHttpError(
      "Module update could not determine a branch to attach or fast-forward.",
      400
    );
  }

  if (!(await gitClient.hasRemoteBranch(DEFAULT_REMOTE, branchName))) {
    if (defaultBranch && branchName !== defaultBranch && (await gitClient.hasRemoteBranch(DEFAULT_REMOTE, defaultBranch))) {
      branchName = defaultBranch;
    } else {
      throw createHttpError(`Remote ${DEFAULT_REMOTE} does not have branch ${branchName}.`, 400);
    }
  }

  await gitClient.checkoutBranch(DEFAULT_REMOTE, branchName);
  await gitClient.fastForward(DEFAULT_REMOTE, branchName);

  return branchName;
}

async function checkoutRequestedRevision(gitClient, options = {}) {
  if (options.tag) {
    const revision = await gitClient.resolveTagRevision(options.tag);

    if (!revision) {
      throw createHttpError(`Could not resolve tag ${options.tag}.`, 400);
    }

    await gitClient.checkoutDetached(revision);
    return {
      kind: "tag",
      value: options.tag
    };
  }

  if (options.commit) {
    const revision = await gitClient.resolveCommitRevision(options.commit, DEFAULT_REMOTE, {
      remoteUrl: options.remoteUrl,
      token: options.token
    });

    if (!revision) {
      throw createHttpError(`Could not resolve commit ${options.commit}.`, 400);
    }

    await gitClient.checkoutDetached(revision);
    return {
      kind: "commit",
      value: options.commit
    };
  }

  return null;
}

async function moveDirectoryIntoPlace(sourceAbsolutePath, destinationAbsolutePath) {
  try {
    await fsPromises.rename(sourceAbsolutePath, destinationAbsolutePath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }

    await fsPromises.cp(sourceAbsolutePath, destinationAbsolutePath, {
      errorOnExist: true,
      force: false,
      recursive: true
    });
    await fsPromises.rm(sourceAbsolutePath, {
      force: true,
      recursive: true
    });
  }
}

async function installIntoNewPath(targetPathInfo, options = {}) {
  const tempAbsolutePath = await fsPromises.mkdtemp(path.join(os.tmpdir(), "space-module-install-"));
  let movedIntoPlace = false;

  try {
    await cloneGitRepository({
      authOptions: {
        token: options.token
      },
      remoteUrl: options.repoUrl,
      targetDir: tempAbsolutePath
    });

    if (options.tag || options.commit) {
      const gitClient = await createGitClient({
        projectRoot: tempAbsolutePath
      });
      const remoteUrl = await ensureRemoteConfig(gitClient, options.repoUrl);

      await gitClient.fetchRemote(DEFAULT_REMOTE, {
        remoteUrl,
        token: options.token
      });
      await checkoutRequestedRevision(gitClient, {
        commit: options.commit,
        remoteUrl,
        tag: options.tag,
        token: options.token
      });
    }

    const quotaPlan = createUserFolderQuotaPlan(options, [
      {
        deltaBytes: readAbsolutePathSize(tempAbsolutePath),
        projectPath: targetPathInfo.projectPath
      }
    ]);

    await fsPromises.mkdir(path.dirname(targetPathInfo.absolutePath), { recursive: true });
    try {
      await moveDirectoryIntoPlace(tempAbsolutePath, targetPathInfo.absolutePath);
      movedIntoPlace = true;
    } catch (error) {
      invalidateUserFolderSizeCacheForProjectPaths(options, [targetPathInfo.projectPath]);
      throw error;
    }
    applyUserFolderQuotaPlan(quotaPlan);
  } catch (error) {
    if (!movedIntoPlace) {
      await fsPromises.rm(tempAbsolutePath, {
        force: true,
        recursive: true
      });
    }
    throw error;
  }
}

async function updateExistingPath(targetPathInfo, options = {}) {
  let gitClient;

  try {
    gitClient = await createGitClient({
      projectRoot: targetPathInfo.absolutePath
    });
  } catch (error) {
    throw createHttpError(
      error.message || `Module path is not a valid Git repository: ${targetPathInfo.appPath}`,
      400
    );
  }

  await gitClient.ensureCleanTrackedFiles();

  const remoteUrl = await ensureRemoteConfig(gitClient, options.repoUrl);
  const { defaultBranch } = await gitClient.fetchRemote(DEFAULT_REMOTE, {
    remoteUrl,
    token: options.token
  });
  const checkedOutTarget = await checkoutRequestedRevision(gitClient, {
    commit: options.commit,
    remoteUrl,
    tag: options.tag,
    token: options.token
  });

  if (!checkedOutTarget) {
    await updateTrackedBranch(gitClient, defaultBranch);
  }
}

async function resolveInstalledLocations(options = {}) {
  const groupIndex = getGroupIndex(options.stateSystem, options.runtimeParams);
  const selectionUsername =
    options.ownerId && normalizeEntityId(options.ownerId) !== normalizeEntityId(options.username)
      ? normalizeEntityId(options.ownerId)
      : options.username;
  const visibleEntries = collectVisibleModuleDirectoryEntries({
    includeOtherUsers: options.includeOtherUsers === true,
    maxLayer: normalizeMaxLayer(options.maxLayer),
    ownerId: options.ownerId,
    runtimeParams: options.runtimeParams,
    stateSystem: options.stateSystem,
    username: options.username
  }).filter((entry) => entry.requestPath === options.requestPath);
  const selectedShardIds = collectReadableModuleShardIds({
    groupIndex,
    maxLayer: normalizeMaxLayer(options.maxLayer),
    username: selectionUsername
  });

  if (normalizeMaxLayer(options.maxLayer) >= 2) {
    if (options.ownerId) {
      selectedShardIds.push(`L2/${normalizeEntityId(options.ownerId)}`);
    }

    if (options.includeOtherUsers === true) {
      listStateAreaIds(options.stateSystem, FILE_INDEX_AREA)
        .filter((shardId) => shardId.startsWith("L2/"))
        .forEach((shardId) => {
          selectedShardIds.push(shardId);
        });
    }
  }

  const selectedEntries = collectAccessibleModuleEntries(
    collectProjectPathsFromFileIndexShards(
      options.stateSystem,
      [...new Set(selectedShardIds)]
    ),
    {
      groupIndex,
      maxLayer: normalizeMaxLayer(options.maxLayer),
      parseProjectPath: parseProjectModuleDirectoryPath,
      username: selectionUsername
    }
  ).filter((entry) => entry.requestPath === options.requestPath);
  const selectedEntryMap = new Map(
    selectedEntries.map((entry, index) => [
      entry.projectPath,
      {
        rank: entry.rank,
        selected: index === selectedEntries.length - 1
      }
    ])
  );

  const locations = await mapWithConcurrencyLimit(
    visibleEntries,
    GIT_INFO_CONCURRENCY,
    async (entry) => ({
      authorId: entry.authorId,
      canRead: entry.canRead,
      canWrite: entry.canWrite,
      effective: selectedEntryMap.has(entry.projectPath),
      git: await readModuleGitInfo({
        absolutePath: createAbsolutePath(options.projectRoot, entry.projectPath, options.runtimeParams)
      }),
      layer: entry.layer,
      ownerId: entry.ownerId,
      ownerType: entry.ownerType,
      path: toAppRelativePath(entry.projectPath),
      rank: selectedEntryMap.get(entry.projectPath)?.rank ?? null,
      requestPath: entry.requestPath,
      repositoryId: entry.repositoryId,
      selected: selectedEntryMap.get(entry.projectPath)?.selected === true
    })
  );

  return locations.sort(compareResolvedModuleLocations);
}

async function readModuleInfo(options = {}) {
  const moduleReference = normalizeModuleReference(options.path || options.modulePath || options.requestPath || "");
  const requestedOwnerId =
    options.ownerId ||
    (moduleReference.layer === "L2" && moduleReference.ownerType === "user"
      ? moduleReference.ownerId
      : "");
  const locations = await resolveInstalledLocations({
    includeOtherUsers: options.includeOtherUsers === true,
    maxLayer: options.maxLayer,
    ownerId: requestedOwnerId,
    projectRoot: options.projectRoot,
    requestPath: moduleReference.requestPath,
    runtimeParams: options.runtimeParams,
    stateSystem: options.stateSystem,
    username: options.username,
  });
  const selectedLocation = locations.find((location) => location.selected) || null;

  return {
    installed: locations.length > 0,
    locations,
    modulePath: moduleReference.requestPath.slice(1),
    requestPath: moduleReference.requestPath,
    selectedPath: selectedLocation ? selectedLocation.path : ""
  };
}

async function installModule(options = {}) {
  if (options.tag && options.commit) {
    throw createHttpError("Specify either tag or commit, not both.", 400);
  }

  const targetPathInfo = normalizeModuleTargetPath(options.path, options);
  const pathIndex = getFileIndexShardValue(
    options.stateSystem,
    targetPathInfo.layer === "L1"
      ? `L1/${targetPathInfo.ownerId}`
      : `L2/${targetPathInfo.ownerId}`
  );
  const conflictingFilePath = stripTrailingSlash(targetPathInfo.projectPath);
  const existsAsDirectory =
    hasPath(pathIndex, targetPathInfo.projectPath) || hasDescendantPath(pathIndex, targetPathInfo.projectPath);

  if (hasPath(pathIndex, conflictingFilePath)) {
    throw createHttpError(`Module path already exists as a file: ${targetPathInfo.appPath}`, 400);
  }

  if (!existsAsDirectory && !options.repoUrl) {
    throw createHttpError("Module install requires a repository URL.", 400);
  }

  try {
    if (existsAsDirectory) {
      await updateExistingPath(targetPathInfo, options);
    } else {
      await installIntoNewPath(targetPathInfo, options);
    }
  } catch (error) {
    if (error && error.statusCode) {
      throw error;
    }

    throw createHttpError(error.message || "Module install failed.", 400);
  }

  recordAppPathMutations(
    {
      projectRoot: options.projectRoot,
      runtimeParams: options.runtimeParams
    },
    [targetPathInfo.projectPath]
  );

  return {
    action: existsAsDirectory ? "updated" : "installed",
    path: targetPathInfo.appPath,
    requestPath: targetPathInfo.requestPath
  };
}

async function listInstalledModules(options = {}) {
  const area = normalizeModuleListArea(options.area);

  // Always use maxLayer 2 so L1 and L2 modules are visible regardless of the
  // request context (admin requests run with maxLayer=0 for resolution, but the
  // intent here is to list what is actually installed).
  const entries = collectVisibleModuleDirectoryEntries({
    area,
    maxLayer: 2,
    ownerId: options.ownerId,
    runtimeParams: options.runtimeParams,
    search: options.search,
    stateSystem: options.stateSystem,
    username: options.username,
  });

  if (area === "l2_users") {
    const groupedEntries = new Map();

    entries.forEach((entry) => {
      const groupKey = entry.requestPath;
      const groupedEntry =
        groupedEntries.get(groupKey) || {
          authorId: entry.authorId,
          canRead: false,
          entries: [],
          layer: entry.layer,
          ownerIds: new Set(),
          repositoryId: entry.repositoryId,
          requestPath: entry.requestPath
        };

      groupedEntry.canRead ||= entry.canRead;
      groupedEntry.entries.push(entry);
      groupedEntry.ownerIds.add(entry.ownerId);
      groupedEntries.set(groupKey, groupedEntry);
    });

    return mapWithConcurrencyLimit(
      [...groupedEntries.values()].sort((left, right) =>
        `${left.authorId}/${left.repositoryId}`.localeCompare(`${right.authorId}/${right.repositoryId}`)
      ),
      GIT_INFO_CONCURRENCY,
      async (groupedEntry) => {
        const representativeEntry = groupedEntry.entries[0];
        const ownerPreview = [...groupedEntry.ownerIds].sort((left, right) => left.localeCompare(right)).slice(0, 3);

        return {
          aggregated: true,
          authorId: groupedEntry.authorId,
          canRead: groupedEntry.canRead,
          canWrite: false,
          git: await readModuleGitInfo({
            absolutePath: createAbsolutePath(
              options.projectRoot,
              representativeEntry.projectPath,
              options.runtimeParams
            )
          }),
          id: createModuleListItemId(groupedEntry, {
            aggregated: true,
            area
          }),
          layer: groupedEntry.layer,
          ownerCount: groupedEntry.ownerIds.size,
          ownerId: "",
          ownerPreview,
          ownerType: "user-aggregate",
          path: "",
          requestPath: groupedEntry.requestPath,
          repositoryId: groupedEntry.repositoryId
        };
      }
    );
  }

  return mapWithConcurrencyLimit(
    entries,
    GIT_INFO_CONCURRENCY,
    async (entry) => ({
      aggregated: false,
      authorId: entry.authorId,
      canRead: entry.canRead,
      canWrite: entry.canWrite,
      git: await readModuleGitInfo({
        absolutePath: createAbsolutePath(options.projectRoot, entry.projectPath, options.runtimeParams)
      }),
      id: createModuleListItemId(entry, {
        area
      }),
      layer: entry.layer,
      ownerId: entry.ownerId,
      ownerType: entry.ownerType,
      ownerCount: 1,
      path: toAppRelativePath(entry.projectPath),
      requestPath: entry.requestPath,
      repositoryId: entry.repositoryId
    })
  );
}

export {
  installModule,
  listInstalledModules,
  normalizeModuleTargetPath,
  readModuleInfo
};
