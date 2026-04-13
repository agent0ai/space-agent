import { spawnSync } from "node:child_process";

const PARAM_ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u;
const DEFAULT_REMOTE_NAME = "origin";
const DEFAULT_UPDATE_REMOTE_URL = "https://github.com/agent0ai/space-agent.git";

function parseRuntimeAssignment(rawValue) {
  const match = String(rawValue || "").match(PARAM_ASSIGNMENT_PATTERN);

  if (!match) {
    return null;
  }

  return {
    name: String(match[1] || "").trim().toUpperCase(),
    value: match[2]
  };
}

function findLastAssignmentValue(args, paramName) {
  const normalizedParamName = String(paramName || "").trim().toUpperCase();

  for (let index = args.length - 1; index >= 0; index -= 1) {
    const assignment = parseRuntimeAssignment(args[index]);

    if (assignment && assignment.name === normalizedParamName) {
      return String(assignment.value || "").trim();
    }
  }

  return "";
}

function readLocalGitConfig(projectRoot, key) {
  const result = spawnSync("git", ["config", "--local", "--get", key], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error || result.status !== 0) {
    return "";
  }

  return String(result.stdout || "").trim();
}

function resolveConfiguredUpdateRemoteUrl(options = {}) {
  const explicitRemoteUrl = String(options.explicitRemoteUrl || "").trim();

  if (explicitRemoteUrl) {
    return explicitRemoteUrl;
  }

  const runtimeAssignmentValue = findLastAssignmentValue(options.runtimeArgs || [], "GIT_URL");

  if (runtimeAssignmentValue) {
    return runtimeAssignmentValue;
  }

  const envValue = String(options.env?.GIT_URL || "").trim();

  if (envValue) {
    return envValue;
  }

  const localOriginUrl = readLocalGitConfig(
    String(options.projectRoot || ""),
    `remote.${DEFAULT_REMOTE_NAME}.url`
  );

  if (localOriginUrl) {
    return localOriginUrl;
  }

  return DEFAULT_UPDATE_REMOTE_URL;
}

export {
  DEFAULT_REMOTE_NAME,
  DEFAULT_UPDATE_REMOTE_URL,
  findLastAssignmentValue,
  parseRuntimeAssignment,
  readLocalGitConfig,
  resolveConfiguredUpdateRemoteUrl
};
