import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_PROJECT_VERSION = "v0.0";

function readGitOutput(projectRoot, args) {
  return execFileSync("git", args, {
    cwd: projectRoot || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function readLatestTag(projectRoot) {
  try {
    return readGitOutput(projectRoot, ["describe", "--tags", "--abbrev=0"]);
  } catch {
    return null;
  }
}

function readCommitCount(projectRoot, rangeArgs) {
  return Number(readGitOutput(projectRoot, ["rev-list", "--count", ...rangeArgs]) || "0");
}

function normalizePackageVersionTag(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  const unprefixed = normalized.replace(/^v/iu, "");
  const zeroPatchMatch = /^(\d+)\.(\d+)\.0$/u.exec(unprefixed);

  if (zeroPatchMatch) {
    return `v${zeroPatchMatch[1]}.${zeroPatchMatch[2]}`;
  }

  return normalized.toLowerCase().startsWith("v") ? normalized : `v${normalized}`;
}

function readPackageVersion(projectRoot) {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot || process.cwd(), "package.json"), "utf8")
    );

    return normalizePackageVersionTag(packageJson.version);
  } catch {
    return "";
  }
}

function resolveGitProjectVersion(projectRoot) {
  const latestTag = readLatestTag(projectRoot);
  const baseTag = latestTag || DEFAULT_PROJECT_VERSION;
  const commitCount = latestTag
    ? readCommitCount(projectRoot, [`${latestTag}..HEAD`])
    : readCommitCount(projectRoot, ["HEAD"]);

  return commitCount > 0 ? `${baseTag}+${commitCount}` : baseTag;
}

function resolveProjectVersion(projectRoot) {
  try {
    return resolveGitProjectVersion(projectRoot);
  } catch {
    return readPackageVersion(projectRoot) || DEFAULT_PROJECT_VERSION;
  }
}

export {
  DEFAULT_PROJECT_VERSION,
  normalizePackageVersionTag,
  readLatestTag,
  resolveGitProjectVersion,
  resolveProjectVersion
};
