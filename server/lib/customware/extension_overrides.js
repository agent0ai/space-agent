import { globToRegExp, normalizePathSegment } from "../utils/app_files.js";
import { parseProjectModuleExtensionFilePath } from "./layout.js";
import {
  collectProjectPathsFromFileIndexShards,
  collectReadableModuleShardIds,
  getRuntimeGroupIndexFromStateSystem
} from "./module_state.js";
import { collectAccessibleModuleEntries, compareRankedEntries } from "./overrides.js";

function normalizeExtensionPattern(value) {
  try {
    return normalizePathSegment(value);
  } catch {
    return "";
  }
}

function compileExtensionPatterns(patterns) {
  return patterns
    .map((pattern) => normalizeExtensionPattern(pattern))
    .filter(Boolean)
    .map((pattern) => ({
      matcher: globToRegExp(pattern),
      pattern
    }));
}

function matchesExtensionPattern(entry, compiledPatterns) {
  return compiledPatterns.some(({ matcher }) => matcher.test(entry.extensionPath));
}

function listResolvedExtensionRequestPathGroups(options = {}) {
  const { maxLayer, requests = [], runtimeParams, stateSystem, username } = options;

  if (!stateSystem) {
    return Object.create(null);
  }

  const normalizedRequests = requests
    .map((request) => {
      const key = String(request && request.key || "").trim();
      const compiledPatterns = compileExtensionPatterns(
        Array.isArray(request && request.patterns) ? request.patterns : []
      );

      if (!key || compiledPatterns.length === 0) {
        return null;
      }

      return {
        compiledPatterns,
        key
      };
    })
    .filter(Boolean);

  if (normalizedRequests.length === 0) {
    return Object.create(null);
  }

  const groupIndex = getRuntimeGroupIndexFromStateSystem(stateSystem, runtimeParams);
  const accessibleEntries = collectAccessibleModuleEntries(
    collectProjectPathsFromFileIndexShards(
      stateSystem,
      collectReadableModuleShardIds({
        groupIndex,
        maxLayer,
        username
      })
    ),
    {
      groupIndex,
      maxLayer,
      parseProjectPath: parseProjectModuleExtensionFilePath,
      username
    }
  );

  const selectedEntriesByKey = new Map(
    normalizedRequests.map((request) => [request.key, new Map()])
  );

  for (const entry of accessibleEntries) {
    for (const request of normalizedRequests) {
      if (!matchesExtensionPattern(entry, request.compiledPatterns)) {
        continue;
      }

      selectedEntriesByKey.get(request.key).set(entry.requestPath, entry);
    }
  }

  const results = Object.create(null);

  for (const request of normalizedRequests) {
    results[request.key] = [...selectedEntriesByKey.get(request.key).values()]
      .sort(compareRankedEntries)
      .map((entry) => entry.requestPath);
  }

  return results;
}

function listResolvedExtensionRequestPaths(options = {}) {
  const { maxLayer, patterns = [], runtimeParams, stateSystem, username } = options;
  const results = listResolvedExtensionRequestPathGroups({
    maxLayer,
    requests: [
      {
        key: "default",
        patterns
      }
    ],
    runtimeParams,
    stateSystem,
    username,
  });

  return results.default || [];
}

export {
  listResolvedExtensionRequestPathGroups,
  listResolvedExtensionRequestPaths
};
