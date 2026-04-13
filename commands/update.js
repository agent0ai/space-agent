import { createGitClient } from "../server/lib/git/client_create.js";
import { resolveConfiguredUpdateRemoteUrl } from "./lib/update_remote.js";

const DEFAULT_REMOTE = "origin";
const UPDATE_REMOTE_FETCH_REFSPEC = "+refs/heads/*:refs/remotes/origin/*";
const UPDATE_BRANCH_CONFIG_KEY = "space.updateBranch";

function parseUpdateArgs(args) {
  let target = null;
  let branchName = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--branch") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--branch requires a branch name.");
      }

      branchName = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--branch=")) {
      branchName = arg.slice("--branch=".length).trim();
      if (!branchName) {
        throw new Error("--branch requires a branch name.");
      }
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown update argument: ${arg}`);
    }

    if (target) {
      throw new Error("Update accepts at most one positional tag, commit, or branch target.");
    }

    target = arg;
  }

  if (target && branchName) {
    throw new Error("Use either a positional target or --branch <branch>, not both.");
  }

  return {
    branchName,
    target
  };
}

async function readRememberedBranch(gitClient) {
  return gitClient.readConfig(UPDATE_BRANCH_CONFIG_KEY);
}

async function rememberBranch(gitClient, branchName) {
  if (!branchName) {
    return;
  }

  await gitClient.writeConfig(UPDATE_BRANCH_CONFIG_KEY, branchName);
}

async function ensureUpdateRemote(gitClient, remoteUrl) {
  const remoteUrlConfigPath = `remote.${DEFAULT_REMOTE}.url`;
  const remoteFetchConfigPath = `remote.${DEFAULT_REMOTE}.fetch`;
  const currentRemoteUrl = await gitClient.readConfig(remoteUrlConfigPath);
  const currentFetchRefspec = await gitClient.readConfig(remoteFetchConfigPath);

  if (currentRemoteUrl !== remoteUrl) {
    await gitClient.writeConfig(remoteUrlConfigPath, remoteUrl);
    console.log(`Configured ${DEFAULT_REMOTE} update remote as ${remoteUrl}.`);
  }

  if (currentFetchRefspec !== UPDATE_REMOTE_FETCH_REFSPEC) {
    await gitClient.writeConfig(remoteFetchConfigPath, UPDATE_REMOTE_FETCH_REFSPEC);
  }
}

async function resolveTargetRevision(gitClient, remoteName, target) {
  const tagRevision = await gitClient.resolveTagRevision(target);
  if (tagRevision) {
    return {
      revision: tagRevision,
      label: `tag ${target}`
    };
  }

  const commitRevision = await gitClient.resolveCommitRevision(target, remoteName);
  if (!commitRevision) {
    return null;
  }

  return {
    revision: commitRevision,
    label: `commit ${target}`
  };
}

async function resolveReconnectBranch(gitClient, remoteName, fetchedDefaultBranch) {
  const rememberedBranch = await readRememberedBranch(gitClient);
  if (rememberedBranch && (await gitClient.hasRemoteBranch(remoteName, rememberedBranch))) {
    return rememberedBranch;
  }

  if (fetchedDefaultBranch && (await gitClient.hasRemoteBranch(remoteName, fetchedDefaultBranch))) {
    return fetchedDefaultBranch;
  }

  return null;
}

async function reattachBranch(gitClient, remoteName, branchName) {
  const currentBranch = await gitClient.readCurrentBranch();
  if (currentBranch === branchName) {
    return;
  }

  const hadLocalBranch = await gitClient.hasLocalBranch(branchName);
  if (!hadLocalBranch && !(await gitClient.hasRemoteBranch(remoteName, branchName))) {
    throw new Error(`Remote ${remoteName} does not have branch ${branchName}.`);
  }

  await gitClient.checkoutBranch(remoteName, branchName);

  if (hadLocalBranch) {
    console.log(`Reattached to ${branchName}.`);
    return;
  }

  console.log(`Created and attached ${branchName} tracking ${remoteName}/${branchName}.`);
}

async function resolveBranchTarget(gitClient, remoteName, target) {
  if (!target) {
    return null;
  }

  if ((await gitClient.hasRemoteBranch(remoteName, target)) || (await gitClient.hasLocalBranch(target))) {
    return target;
  }

  return null;
}

async function updateBranch(gitClient, remoteName, fetchedDefaultBranch, requestedBranchName = null) {
  let branchName = requestedBranchName || (await gitClient.readCurrentBranch());
  if (!branchName) {
    branchName = await resolveReconnectBranch(gitClient, remoteName, fetchedDefaultBranch);
    if (!branchName) {
      throw new Error(
        "Update could not reconnect from detached HEAD because no remembered branch or origin default branch was available."
      );
    }
  }

  if (!(await gitClient.hasRemoteBranch(remoteName, branchName))) {
    throw new Error(`Remote ${remoteName} does not have branch ${branchName}.`);
  }

  await reattachBranch(gitClient, remoteName, branchName);
  await rememberBranch(gitClient, branchName);

  const previousCommit = await gitClient.readHeadCommit();
  await gitClient.fastForward(remoteName, branchName);
  const nextCommit = await gitClient.readHeadCommit();
  const shortCommit = await gitClient.readShortCommit();

  if (previousCommit === nextCommit) {
    console.log(`Already up to date with ${remoteName}/${branchName} at ${shortCommit}.`);
    return;
  }

  console.log(`Updated ${branchName} to ${remoteName}/${branchName} at ${shortCommit}.`);
}

async function resolveTargetBranch(gitClient, remoteName, fetchedDefaultBranch) {
  const currentBranch = await gitClient.readCurrentBranch();
  if (currentBranch) {
    return currentBranch;
  }

  return resolveReconnectBranch(gitClient, remoteName, fetchedDefaultBranch);
}

async function applyRevisionToBranch(gitClient, remoteName, branchName, resolvedTarget) {
  await reattachBranch(gitClient, remoteName, branchName);
  await rememberBranch(gitClient, branchName);

  const previousCommit = await gitClient.readHeadCommit();
  await gitClient.hardReset(resolvedTarget.revision);
  const nextCommit = await gitClient.readHeadCommit();
  const shortCommit = await gitClient.readShortCommit();

  if (previousCommit === nextCommit) {
    console.log(`Already on ${branchName} at ${resolvedTarget.label} (${shortCommit}).`);
    return;
  }

  console.log(`Updated ${branchName} to ${resolvedTarget.label} at ${shortCommit}.`);
}

async function checkoutTargetRevision(gitClient, remoteName, fetchedDefaultBranch, target, resolvedTarget = null) {
  const targetRevision = resolvedTarget || (await resolveTargetRevision(gitClient, remoteName, target));
  if (!targetRevision) {
    throw new Error(`Could not resolve "${target}" as an exact tag or a short/full commit hash from ${remoteName}.`);
  }

  const targetBranch = await resolveTargetBranch(gitClient, remoteName, fetchedDefaultBranch);
  if (targetBranch) {
    await applyRevisionToBranch(gitClient, remoteName, targetBranch, targetRevision);
    return;
  }

  await gitClient.checkoutDetached(targetRevision.revision);
  const shortCommit = await gitClient.readShortCommit();
  console.log(`Checked out ${targetRevision.label} at ${shortCommit} in detached HEAD mode.`);
}

export const help = {
  name: "update",
  summary: "Fetch and apply source-checkout updates from the configured Git update repository.",
  usage: [
    "node space update",
    "node space update --branch <branch>",
    "node space update <branch>",
    "node space update <version-tag>",
    "node space update <commit>"
  ],
  description:
    "For source checkouts only. The updater uses GIT_URL when it is set, otherwise the local origin remote URL, and falls back to the canonical Space Agent repository only when neither is configured. It pins origin to that update remote before fetching, then prefers native Git, then NodeGit when installed and loadable, then isomorphic-git. For GitHub remotes it uses SPACE_GITHUB_TOKEN when that environment variable is set, and sends no GitHub auth header when it is not. Without an argument, it fast-forwards the current branch from origin, or reconnects from detached HEAD to the remembered or default origin branch first. You can also target a branch explicitly with --branch <branch> or a bare branch name. Version tags and short/full commit hashes move the current or remembered branch to that exact revision when possible, falling back to detached HEAD only when no branch can be recovered.",
  arguments: [
    {
      name: "<branch>",
      description: "Branch name to fast-forward from origin when used as the single positional target."
    },
    {
      name: "<version-tag>",
      description: "Exact git tag to apply to the current or recovered branch."
    },
    {
      name: "<commit>",
      description: "Short or full commit hash to apply to the current or recovered branch."
    }
  ],
  options: [
    {
      flag: "--branch <branch>",
      description: "Force update of the named branch instead of inferring the current or positional target branch."
    }
  ],
  examples: [
    "node space update",
    "node space update main",
    "node space update --branch release",
    "node space update v0.10",
    "node space update a1b2c3d4"
  ]
};

export async function execute(context) {
  const { branchName, target } = parseUpdateArgs(context.args);
  const gitClient = await createGitClient({ projectRoot: context.projectRoot });
  const updateRemoteUrl = resolveConfiguredUpdateRemoteUrl({
    env: process.env,
    projectRoot: context.projectRoot
  });

  if (process.env.SPACE_GIT_BACKEND || gitClient.name !== "native") {
    console.log(`Using ${gitClient.label}.`);
  }

  await gitClient.ensureCleanTrackedFiles();
  await ensureUpdateRemote(gitClient, updateRemoteUrl);

  console.log(`Fetching updates from ${updateRemoteUrl}...`);
  const { defaultBranch } = await gitClient.fetchRemote(DEFAULT_REMOTE);

  if (branchName) {
    await updateBranch(gitClient, DEFAULT_REMOTE, defaultBranch, branchName);
    return 0;
  }

  if (target) {
    const resolvedTarget = await resolveTargetRevision(gitClient, DEFAULT_REMOTE, target);
    const targetBranch = await resolveBranchTarget(gitClient, DEFAULT_REMOTE, target);

    if (targetBranch && !resolvedTarget) {
      await updateBranch(gitClient, DEFAULT_REMOTE, defaultBranch, targetBranch);
      return 0;
    }

    await checkoutTargetRevision(gitClient, DEFAULT_REMOTE, defaultBranch, target, resolvedTarget);
    return 0;
  }

  await updateBranch(gitClient, DEFAULT_REMOTE, defaultBranch);
  return 0;
}
