import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { buildBasicAuthHeader } from "../../../server/lib/git/shared.js";
import { resolveConfiguredUpdateRemoteUrl } from "../update_remote.js";

const DEFAULT_REMOTE_NAME = "origin";
const RELEASE_COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const REMOTE_CHECK_TIMEOUT_MS = 60 * 1000;
const UPDATE_BRANCH_CONFIG_KEY = "space.updateBranch";

function shortRevision(revision) {
  return String(revision || "").slice(0, 12);
}

function sanitizeRemoteUrl(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  if (!value) {
    return "";
  }

  try {
    const parsedUrl = new URL(value);
    parsedUrl.username = "";
    parsedUrl.password = "";
    return parsedUrl.toString();
  } catch {
    return value;
  }
}

function buildGitAuthConfigArgs(remoteUrl, env = process.env) {
  if (!/^https?:\/\//i.test(String(remoteUrl || "").trim())) {
    return [];
  }

  const authorizationHeader = buildBasicAuthHeader(remoteUrl, {}, env);

  if (!authorizationHeader) {
    return [];
  }

  return ["-c", `http.extraHeader=Authorization: ${authorizationHeader}`];
}

function runProcess(command, args, options = {}) {
  const { cwd, env = process.env, logPrefix = "", timeoutMs = RELEASE_COMMAND_TIMEOUT_MS } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: logPrefix ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    let hardKillTimer = null;
    let settled = false;
    let timedOut = false;
    let timeoutTimer = null;
    let stdout = "";
    let stderr = "";

    function cleanupTimers() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
        hardKillTimer = null;
      }
    }

    function rejectOnce(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanupTimers();
      reject(error);
    }

    function resolveOnce(value) {
      if (settled) {
        return;
      }

      settled = true;
      cleanupTimers();
      resolve(value);
    }

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");

        hardKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 5_000);
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (logPrefix) {
        process.stdout.write(text.replace(/^/gmu, logPrefix));
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (logPrefix) {
        process.stderr.write(text.replace(/^/gmu, logPrefix));
      }
    });

    child.once("error", rejectOnce);
    child.once("exit", (code, signal) => {
      if (timedOut) {
        rejectOnce(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms.`));
        return;
      }

      if (code === 0) {
        resolveOnce({
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
        return;
      }

      const label = signal ? `signal ${signal}` : `code ${code}`;
      const detail = (stderr || stdout || "").trim();
      rejectOnce(new Error(`${command} ${args.join(" ")} exited with ${label}${detail ? `: ${detail}` : ""}`));
    });
  });
}

async function readProcess(command, args, options = {}) {
  const result = await runProcess(command, args, options);
  return result.stdout;
}

async function tryReadProcess(command, args, options = {}) {
  try {
    return await readProcess(command, args, options);
  } catch {
    return "";
  }
}

async function ensureGitAvailable(projectRoot) {
  await readProcess("git", ["--version"], {
    cwd: projectRoot
  });
}

async function readCurrentRevision(projectRoot) {
  return readProcess("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot
  });
}

async function readCurrentBranch(projectRoot) {
  return tryReadProcess("git", ["branch", "--show-current"], {
    cwd: projectRoot
  });
}

async function readLocalConfig(projectRoot, key) {
  return tryReadProcess("git", ["config", "--local", "--get", key], {
    cwd: projectRoot
  });
}

async function readOriginDefaultBranch(projectRoot) {
  const refName = await tryReadProcess("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    cwd: projectRoot
  });
  const prefix = `${DEFAULT_REMOTE_NAME}/`;

  if (!refName.startsWith(prefix)) {
    return "";
  }

  return refName.slice(prefix.length);
}

async function resolveSourceBranch(projectRoot, requestedBranchName) {
  if (requestedBranchName) {
    return requestedBranchName;
  }

  const currentBranch = await readCurrentBranch(projectRoot);
  if (currentBranch) {
    return currentBranch;
  }

  const rememberedBranch = await readLocalConfig(projectRoot, UPDATE_BRANCH_CONFIG_KEY);
  if (rememberedBranch) {
    return rememberedBranch;
  }

  const defaultBranch = await readOriginDefaultBranch(projectRoot);
  if (defaultBranch) {
    return defaultBranch;
  }

  throw new Error(
    "Supervise could not infer an update branch from this checkout. Pass --branch <branch>."
  );
}

async function resolveSourceRemoteUrl(projectRoot, requestedRemoteUrl, runtimeArgs = [], env = process.env) {
  return resolveConfiguredUpdateRemoteUrl({
    env,
    explicitRemoteUrl: requestedRemoteUrl,
    projectRoot,
    runtimeArgs
  });
}

async function resolveUpdateSource(options) {
  const { branchName, projectRoot, remoteUrl, runtimeArgs = [] } = options;

  await ensureGitAvailable(projectRoot);

  return {
    branchName: await resolveSourceBranch(projectRoot, branchName),
    currentRevision: await readCurrentRevision(projectRoot),
    remoteUrl: await resolveSourceRemoteUrl(projectRoot, remoteUrl, runtimeArgs, process.env)
  };
}

async function readRemoteBranchRevision({ branchName, projectRoot, remoteUrl }) {
  const output = await readProcess(
    "git",
    [...buildGitAuthConfigArgs(remoteUrl), "ls-remote", "--heads", remoteUrl, `refs/heads/${branchName}`],
    {
      cwd: projectRoot,
      timeoutMs: REMOTE_CHECK_TIMEOUT_MS
    }
  );
  const [revision = ""] = output.split(/\s+/u);

  if (!revision) {
    throw new Error(`Remote ${sanitizeRemoteUrl(remoteUrl)} does not have branch ${branchName}.`);
  }

  return revision;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readReleaseMetadata(releaseDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(releaseDir, ".space-release.json"), "utf8"));
  } catch {
    return null;
  }
}

async function writeReleaseMetadata(releaseDir, metadata) {
  await fs.writeFile(
    path.join(releaseDir, ".space-release.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
}

async function installReleaseDependencies(releaseDir, env) {
  if (!(await pathExists(path.join(releaseDir, "package.json")))) {
    return;
  }

  await runProcess("npm", ["install", "--omit=optional"], {
    cwd: releaseDir,
    env,
    logPrefix: "[supervise:npm] "
  });
}

async function cloneRelease({ branchName, env, remoteUrl, revision, targetDir, tempDir }) {
  await runProcess(
    "git",
    [
      ...buildGitAuthConfigArgs(remoteUrl, env),
      "clone",
      "--no-checkout",
      "--single-branch",
      "--branch",
      branchName,
      remoteUrl,
      tempDir
    ],
    {
      cwd: path.dirname(tempDir),
      env,
      logPrefix: "[supervise:git] "
    }
  );
  await runProcess("git", ["checkout", "--detach", revision], {
    cwd: tempDir,
    env,
    logPrefix: "[supervise:git] "
  });
  await installReleaseDependencies(tempDir, env);
  await writeReleaseMetadata(tempDir, {
    branchName,
    createdAt: new Date().toISOString(),
    remoteUrl: sanitizeRemoteUrl(remoteUrl),
    revision
  });
  await fs.rename(tempDir, targetDir);
}

async function ensureReleaseForRevision(options) {
  const {
    branchName,
    env,
    releasesDir,
    remoteUrl,
    revision
  } = options;
  const shortName = shortRevision(revision);
  const targetDir = path.join(releasesDir, shortName);
  const metadata = await readReleaseMetadata(targetDir);

  if (metadata?.revision === revision) {
    return {
      label: shortName,
      revision,
      rootDir: targetDir
    };
  }

  await fs.mkdir(releasesDir, {
    recursive: true
  });

  const tempDir = path.join(releasesDir, `.tmp-${shortName}-${process.pid}-${Date.now()}`);

  try {
    await fs.rm(tempDir, {
      force: true,
      recursive: true
    });
    if (await pathExists(targetDir)) {
      await fs.rm(targetDir, {
        force: true,
        recursive: true
      });
    }
    await cloneRelease({
      branchName,
      env,
      remoteUrl,
      revision,
      targetDir,
      tempDir
    });
  } catch (error) {
    await fs.rm(tempDir, {
      force: true,
      recursive: true
    }).catch(() => {});
    throw error;
  }

  return {
    label: shortName,
    revision,
    rootDir: targetDir
  };
}

export {
  buildGitAuthConfigArgs,
  ensureReleaseForRevision,
  readRemoteBranchRevision,
  resolveUpdateSource,
  sanitizeRemoteUrl,
  shortRevision
};
