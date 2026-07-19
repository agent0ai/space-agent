import {
  parseAppProjectPath,
  parseGroupConfigProjectPath,
  parseProjectUserConfigPath,
  parseProjectUserDirectoryPath,
  parseProjectUserLoginsPath,
  parseProjectUserPasswordPath
} from "../customware/layout.js";
import {
  FILE_INDEX_AREA,
  FILE_INDEX_META_AREA,
  GROUP_ERRORS_ID,
  GROUP_INDEX_AREA,
  GROUP_INCLUSION_CYCLES_ID,
  GROUP_META_AREA,
  GROUP_USER_INDEX_AREA,
  LOGIN_CHALLENGE_AREA,
  SESSION_INDEX_AREA,
  SHARED_STATE_AREA,
  USER_ERROR_INDEX_AREA,
  USER_INDEX_AREA
} from "../../runtime/state_areas.js";

function cloneValue(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function createEmptyRecordMap() {
  return Object.create(null);
}

function sortStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function getFileIndexShardId(projectPath) {
  const parsedProjectPath = parseAppProjectPath(projectPath);

  if (!parsedProjectPath) {
    return "";
  }

  if (parsedProjectPath.kind === "app-root") {
    return "app";
  }

  if (parsedProjectPath.kind === "layer-root") {
    return parsedProjectPath.layer;
  }

  if (parsedProjectPath.layer === "L0") {
    return "L0";
  }

  return `${parsedProjectPath.layer}/${parsedProjectPath.ownerId}`;
}

function collectFileIndexShardIds(pathIndex = createEmptyRecordMap()) {
  return sortStrings(
    Object.keys(pathIndex || createEmptyRecordMap())
      .map((projectPath) => getFileIndexShardId(projectPath))
      .filter(Boolean)
  );
}

function collectFileIndexShardIdsFromProjectPaths(projectPaths = []) {
  return sortStrings(
    (Array.isArray(projectPaths) ? projectPaths : [])
      .map((projectPath) => getFileIndexShardId(projectPath))
      .filter(Boolean)
  );
}

function buildFileIndexShardValue(pathIndex, shardId) {
  const normalizedShardId = String(shardId || "").trim();
  const shardValue = createEmptyRecordMap();

  if (!normalizedShardId) {
    return shardValue;
  }

  Object.entries(pathIndex || createEmptyRecordMap()).forEach(([projectPath, metadata]) => {
    if (getFileIndexShardId(projectPath) !== normalizedShardId) {
      return;
    }

    shardValue[projectPath] = cloneValue(metadata);
  });

  return shardValue;
}

function collectAffectedUsernames(changes = []) {
  const usernames = new Set();

  (Array.isArray(changes) ? changes : []).forEach((change) => {
    const projectPath = String(change?.projectPath || "");
    const userInfo =
      parseProjectUserDirectoryPath(projectPath) ||
      parseProjectUserConfigPath(projectPath) ||
      parseProjectUserLoginsPath(projectPath) ||
      parseProjectUserPasswordPath(projectPath);

    if (userInfo?.username) {
      usernames.add(userInfo.username);
    }
  });

  return [...usernames].sort((left, right) => left.localeCompare(right));
}

function getUserIndexErrorsForUsername(userIndex, username) {
  const userPrefix = `/app/L2/${username}/`;

  return (Array.isArray(userIndex?.errors) ? userIndex.errors : [])
    .filter((error) => String(error?.projectPath || "").startsWith(userPrefix))
    .map((error) => cloneValue(error));
}

function getSessionMapForUser(userRecord) {
  const sessionMap = createEmptyRecordMap();

  (Array.isArray(userRecord?.sessions) ? userRecord.sessions : []).forEach((session) => {
    const sessionVerifier = String(session?.sessionVerifier || "").trim();

    if (!sessionVerifier) {
      return;
    }

    sessionMap[sessionVerifier] = cloneValue(session);
  });

  return sessionMap;
}

function buildUserIndexShardChanges(previousUserIndex, nextUserIndex, usernames = []) {
  const changes = [];

  sortStrings(usernames).forEach((username) => {
    const previousUserRecord =
      previousUserIndex && typeof previousUserIndex.getUser === "function"
        ? previousUserIndex.getUser(username)
        : null;
    const nextUserRecord =
      nextUserIndex && typeof nextUserIndex.getUser === "function" ? nextUserIndex.getUser(username) : null;
    const previousSessions = getSessionMapForUser(previousUserRecord);
    const nextSessions = getSessionMapForUser(nextUserRecord);
    const sessionVerifiers = sortStrings([
      ...Object.keys(previousSessions),
      ...Object.keys(nextSessions)
    ]);
    const nextErrors = getUserIndexErrorsForUsername(nextUserIndex, username);

    changes.push(
      nextUserRecord
        ? {
            area: USER_INDEX_AREA,
            id: username,
            value: cloneValue(nextUserRecord)
          }
        : {
            area: USER_INDEX_AREA,
            deleted: true,
            id: username
          }
    );

    changes.push(
      nextErrors.length > 0
        ? {
            area: USER_ERROR_INDEX_AREA,
            id: username,
            value: nextErrors
          }
        : {
            area: USER_ERROR_INDEX_AREA,
            deleted: true,
            id: username
          }
    );

    sessionVerifiers.forEach((sessionVerifier) => {
      const nextSession = nextSessions[sessionVerifier];

      changes.push(
        nextSession
          ? {
              area: SESSION_INDEX_AREA,
              id: sessionVerifier,
              value: cloneValue(nextSession)
            }
          : {
              area: SESSION_INDEX_AREA,
              deleted: true,
              id: sessionVerifier
            }
      );
    });
  });

  return changes;
}

function hasGroupConfigChange(changes = []) {
  return (Array.isArray(changes) ? changes : []).some((change) =>
    Boolean(parseGroupConfigProjectPath(change?.projectPath))
  );
}

function buildGroupIndexShardChanges(previousGroupIndex, nextGroupIndex) {
  const previousGroups =
    previousGroupIndex?.groups && typeof previousGroupIndex.groups === "object"
      ? previousGroupIndex.groups
      : createEmptyRecordMap();
  const nextGroups =
    nextGroupIndex?.groups && typeof nextGroupIndex.groups === "object"
      ? nextGroupIndex.groups
      : createEmptyRecordMap();
  const previousUsers =
    previousGroupIndex?.users && typeof previousGroupIndex.users === "object"
      ? previousGroupIndex.users
      : createEmptyRecordMap();
  const nextUsers =
    nextGroupIndex?.users && typeof nextGroupIndex.users === "object"
      ? nextGroupIndex.users
      : createEmptyRecordMap();
  const changes = [];

  sortStrings([...Object.keys(previousGroups), ...Object.keys(nextGroups)]).forEach((groupId) => {
    const nextGroupRecord = nextGroups[groupId];

    changes.push(
      nextGroupRecord
        ? {
            area: GROUP_INDEX_AREA,
            id: groupId,
            value: cloneValue(nextGroupRecord)
          }
        : {
            area: GROUP_INDEX_AREA,
            deleted: true,
            id: groupId
          }
    );
  });

  sortStrings([...Object.keys(previousUsers), ...Object.keys(nextUsers)]).forEach((username) => {
    const nextUserRecord = nextUsers[username];

    changes.push(
      nextUserRecord
        ? {
            area: GROUP_USER_INDEX_AREA,
            id: username,
            value: cloneValue(nextUserRecord)
          }
        : {
            area: GROUP_USER_INDEX_AREA,
            deleted: true,
            id: username
          }
    );
  });

  changes.push({
    area: GROUP_META_AREA,
    id: GROUP_ERRORS_ID,
    value: cloneValue(Array.isArray(nextGroupIndex?.errors) ? nextGroupIndex.errors : [])
  });
  changes.push({
    area: GROUP_META_AREA,
    id: GROUP_INCLUSION_CYCLES_ID,
    value: cloneValue(
      Array.isArray(nextGroupIndex?.inclusionCycles) ? nextGroupIndex.inclusionCycles : []
    )
  });

  return changes;
}

function createRuntimeUserIndexFromAreas(areaState = {}) {
  const users =
    areaState[USER_INDEX_AREA] && typeof areaState[USER_INDEX_AREA] === "object"
      ? areaState[USER_INDEX_AREA]
      : createEmptyRecordMap();
  const sessions =
    areaState[SESSION_INDEX_AREA] && typeof areaState[SESSION_INDEX_AREA] === "object"
      ? areaState[SESSION_INDEX_AREA]
      : createEmptyRecordMap();
  const errorShards =
    areaState[USER_ERROR_INDEX_AREA] && typeof areaState[USER_ERROR_INDEX_AREA] === "object"
      ? areaState[USER_ERROR_INDEX_AREA]
      : createEmptyRecordMap();
  const errors = Object.values(errorShards).flatMap((value) =>
    Array.isArray(value) ? value.map((error) => cloneValue(error)) : []
  );

  return {
    errors,
    getSession(sessionVerifier) {
      const normalizedVerifier = String(sessionVerifier || "").trim();
      return normalizedVerifier ? sessions[normalizedVerifier] || null : null;
    },
    getUser(username) {
      const normalizedUsername = String(username || "").trim();
      return normalizedUsername ? users[normalizedUsername] || null : null;
    },
    hasUser(username) {
      return Boolean(this.getUser(username));
    },
    sessions,
    users
  };
}

function createRuntimeGroupIndexFromAreas(areaState = {}) {
  const groups =
    areaState[GROUP_INDEX_AREA] && typeof areaState[GROUP_INDEX_AREA] === "object"
      ? areaState[GROUP_INDEX_AREA]
      : createEmptyRecordMap();
  const users =
    areaState[GROUP_USER_INDEX_AREA] && typeof areaState[GROUP_USER_INDEX_AREA] === "object"
      ? areaState[GROUP_USER_INDEX_AREA]
      : createEmptyRecordMap();
  const meta =
    areaState[GROUP_META_AREA] && typeof areaState[GROUP_META_AREA] === "object"
      ? areaState[GROUP_META_AREA]
      : createEmptyRecordMap();
  const errors = Array.isArray(meta[GROUP_ERRORS_ID]) ? meta[GROUP_ERRORS_ID] : [];
  const inclusionCycles = Array.isArray(meta[GROUP_INCLUSION_CYCLES_ID])
    ? meta[GROUP_INCLUSION_CYCLES_ID]
    : [];

  return {
    errors,
    getManagedGroupsForUser(username) {
      const normalizedUsername = String(username || "").trim();
      const userRecord = normalizedUsername ? users[normalizedUsername] || null : null;
      return userRecord && Array.isArray(userRecord.managedGroups) ? [...userRecord.managedGroups] : [];
    },
    getOrderedGroupsForUser(username) {
      const normalizedUsername = String(username || "").trim();
      const userRecord = normalizedUsername ? users[normalizedUsername] || null : null;
      return userRecord && Array.isArray(userRecord.groups) ? [...userRecord.groups] : [];
    },
    groups,
    inclusionCycles,
    isUserInGroup(username, groupId) {
      const normalizedUsername = String(username || "").trim();
      const normalizedGroupId = String(groupId || "").trim();

      if (!normalizedGroupId) {
        return false;
      }

      if (normalizedGroupId === "_all") {
        return true;
      }

      const groupRecord = groups[normalizedGroupId];

      if (!groupRecord) {
        return false;
      }

      if (groupRecord.includesAllUsers) {
        return true;
      }

      if (!normalizedUsername) {
        return false;
      }

      return Array.isArray(groupRecord.memberUsers) && groupRecord.memberUsers.includes(normalizedUsername);
    },
    users
  };
}

export {
  FILE_INDEX_AREA,
  FILE_INDEX_META_AREA,
  GROUP_ERRORS_ID,
  GROUP_INDEX_AREA,
  GROUP_INCLUSION_CYCLES_ID,
  GROUP_META_AREA,
  GROUP_USER_INDEX_AREA,
  LOGIN_CHALLENGE_AREA,
  SESSION_INDEX_AREA,
  SHARED_STATE_AREA,
  USER_ERROR_INDEX_AREA,
  USER_INDEX_AREA,
  buildFileIndexShardValue,
  buildGroupIndexShardChanges,
  buildUserIndexShardChanges,
  collectAffectedUsernames,
  collectFileIndexShardIds,
  collectFileIndexShardIdsFromProjectPaths,
  createRuntimeGroupIndexFromAreas,
  createRuntimeUserIndexFromAreas,
  getFileIndexShardId,
  hasGroupConfigChange
};
