import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listAppPaths, listAppPathsByPatterns, writeAppFile } from "../server/lib/customware/file_access.js";
import {
  flushGitHistoryCommits,
  getLayerHistoryCommitDiff,
  getLayerHistoryOperationPreview,
  listLayerHistoryCommits,
  recordAppPathMutations,
  revertLayerHistoryCommit,
  resolveGitHistoryDebounceMs,
  rollbackLayerHistory,
  scheduleGitHistoryCommitsForProjectPaths
} from "../server/lib/customware/git_history.js";
import { setRuntimeAppPathMutationHandler } from "../server/runtime/app_path_mutations.js";

function createRuntimeParams(values = {}) {
  return {
    get(name, fallback = undefined) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
    }
  };
}

function collectProjectPaths(projectRoot) {
  const appRoot = path.join(projectRoot, "app");
  const output = [];

  function walk(absolutePath) {
    if (!fs.existsSync(absolutePath)) {
      return;
    }

    const stats = fs.statSync(absolutePath);
    const relativePath = path.relative(appRoot, absolutePath).replaceAll(path.sep, "/");
    const projectPath = relativePath
      ? `/app/${relativePath}${stats.isDirectory() ? "/" : ""}`
      : "/app/";

    output.push(projectPath);

    if (!stats.isDirectory()) {
      return;
    }

    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }

      walk(path.join(absolutePath, entry.name));
    }
  }

  walk(appRoot);
  return output.sort((left, right) => left.localeCompare(right));
}

function createGroupWatchdog(paths = []) {
  const pathIndex = Object.create(null);
  for (const projectPath of paths) {
    pathIndex[projectPath] = true;
  }

  const groupIndex = {
    getManagedGroupsForUser(username) {
      return username === "manager" ? ["team"] : [];
    },
    getOrderedGroupsForUser(username) {
      return username === "manager" || username === "alice" ? ["team"] : [];
    },
    isUserInGroup(username, groupId) {
      return (username === "manager" || username === "alice") && groupId === "team";
    }
  };

  return {
    getIndex(name) {
      if (name === "path_index") {
        return pathIndex;
      }

      return name === "group_index" ? groupIndex : Object.create(null);
    },
    getPaths() {
      return [...paths];
    }
  };
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });

  if (result.error || result.status !== 0) {
    throw result.error || new Error(String(result.stderr || result.stdout || "git command failed").trim());
  }

  return result.stdout.trim();
}

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "space-customware-git-history-"));
const runtimeParams = createRuntimeParams({
  CUSTOMWARE_GIT_HISTORY: true,
  CUSTOMWARE_PATH: "",
  SINGLE_USER_APP: false
});

try {
  assert.equal(resolveGitHistoryDebounceMs(0), 10_000);
  assert.equal(resolveGitHistoryDebounceMs(59_999), 10_000);
  assert.equal(resolveGitHistoryDebounceMs(60_000), 5_000);
  assert.equal(resolveGitHistoryDebounceMs(5 * 60_000), 1_000);
  assert.equal(resolveGitHistoryDebounceMs(10 * 60_000), 0);
  assert.equal(resolveGitHistoryDebounceMs(60_000, 2_000), 2_000);

  setRuntimeAppPathMutationHandler(() => true);
  recordAppPathMutations(
    {
      projectRoot,
      runtimeParams
    },
    ["/app/L2/bob/worker-only.txt"]
  );
  assert.deepEqual(await flushGitHistoryCommits({ throwOnError: true }), []);
  setRuntimeAppPathMutationHandler(null);

  scheduleGitHistoryCommitsForProjectPaths(
    {
      projectRoot,
      runtimeParams
    },
    ["/app/L2/bob/worker-only.txt"]
  );
  const primaryScheduledFlush = await flushGitHistoryCommits({ throwOnError: true });
  assert.equal(primaryScheduledFlush.length, 1);
  assert.equal(primaryScheduledFlush[0].path, "L2/bob/");

  writeAppFile({
    content: "one\n",
    path: "~/notes.txt",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  writeAppFile({
    content: "two\n",
    path: "~/notes.txt",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  const firstFlush = await flushGitHistoryCommits({ throwOnError: true });
  assert.equal(firstFlush.length, 1);
  assert.equal(firstFlush[0].committed, true);

  let userHistory = await listLayerHistoryCommits({
    limit: 10,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(userHistory.path, "L2/alice/");
  assert.equal(userHistory.commits.length, 1);
  assert.ok(userHistory.commits[0].changedFiles.includes(".gitignore"));
  assert.ok(userHistory.commits[0].changedFiles.includes("notes.txt"));
  assert.ok(!userHistory.commits[0].changedFiles.includes("meta/password.json"));
  assert.ok(!userHistory.commits[0].changedFiles.includes("meta/logins.json"));

  const userGitignore = fs.readFileSync(
    path.join(projectRoot, "app", "L2", "alice", ".gitignore"),
    "utf8"
  );
  assert.match(userGitignore, /^meta\/password\.json$/m);
  assert.match(userGitignore, /^meta\/logins\.json$/m);

  writeAppFile({
    content: "password-state\n",
    path: "~/meta/password.json",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  writeAppFile({
    content: "login-state\n",
    path: "~/meta/logins.json",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  await flushGitHistoryCommits({ throwOnError: true });

  userHistory = await listLayerHistoryCommits({
    limit: 10,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(userHistory.commits.length, 1);

  writeAppFile({
    content: "three\n",
    path: "~/notes.txt",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  await flushGitHistoryCommits({ throwOnError: true });

  userHistory = await listLayerHistoryCommits({
    limit: 10,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(userHistory.commits.length, 2);
  const previousCommitHash = userHistory.commits[1].hash;
  const latestCommitHash = userHistory.commits[0].hash;
  assert.ok(userHistory.currentHash);
  assert.equal(userHistory.commits[0].files.find((file) => file.path === "notes.txt")?.action, "modified");

  const pagedHistory = await listLayerHistoryCommits({
    limit: 1,
    offset: 0,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(pagedHistory.commits.length, 1);
  assert.equal(pagedHistory.hasMore, true);
  assert.equal(pagedHistory.limit, 1);
  assert.equal(pagedHistory.offset, 0);

  const filteredHistory = await listLayerHistoryCommits({
    fileFilter: "notes",
    limit: 10,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(filteredHistory.commits.length, 2);

  writeAppFile({
    content: "include\n",
    path: "~/settings/personality.system.include.md",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  writeAppFile({
    content: "other\n",
    path: "~/settings/other.md",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  await flushGitHistoryCommits({ throwOnError: true });

  const personalityHistory = await listLayerHistoryCommits({
    fileFilter: "person",
    limit: 10,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(personalityHistory.commits.length, 1);
  const personalityCommitHash = personalityHistory.commits[0].hash;
  assert.ok(
    personalityHistory.commits[0].files.some((file) => file.path === "settings/personality.system.include.md")
  );
  assert.ok(
    personalityHistory.commits[0].files.some((file) => file.path === "settings/other.md")
  );

  const revertPreview = await getLayerHistoryOperationPreview({
    commitHash: personalityCommitHash,
    operation: "revert",
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(
    revertPreview.files.find((file) => file.path === "settings/personality.system.include.md")?.action,
    "deleted"
  );
  assert.equal(revertPreview.files.find((file) => file.path === "settings/other.md")?.action, "deleted");

  const travelPreview = await getLayerHistoryOperationPreview({
    commitHash: previousCommitHash,
    operation: "travel",
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.ok(travelPreview.files.some((file) => file.path === "notes.txt"));
  assert.ok(travelPreview.files.some((file) => file.path === "settings/other.md"));

  const travelPreviewDiff = await getLayerHistoryOperationPreview({
    commitHash: previousCommitHash,
    filePath: "notes.txt",
    operation: "travel",
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.match(travelPreviewDiff.patch, /-three/u);
  assert.match(travelPreviewDiff.patch, /\+two/u);

  const notesDiff = await getLayerHistoryCommitDiff({
    commitHash: latestCommitHash,
    filePath: "notes.txt",
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(notesDiff.file.path, "notes.txt");
  assert.match(notesDiff.patch, /\+three/u);

  await rollbackLayerHistory({
    commitHash: previousCommitHash,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(
    fs.readFileSync(path.join(projectRoot, "app", "L2", "alice", "notes.txt"), "utf8"),
    "two\n"
  );

  userHistory = await listLayerHistoryCommits({
    limit: 10,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(userHistory.currentHash, previousCommitHash);
  assert.ok(userHistory.commits.some((commit) => commit.hash === previousCommitHash));
  assert.ok(userHistory.commits.some((commit) => commit.hash === latestCommitHash));

  writeAppFile({
    content: "after rollback\n",
    path: "~/notes.txt",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  await flushGitHistoryCommits({ throwOnError: true });
  userHistory = await listLayerHistoryCommits({
    limit: 10,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });
  const afterRollbackCommitHash = userHistory.currentHash;

  await revertLayerHistoryCommit({
    commitHash: afterRollbackCommitHash,
    path: "~",
    projectRoot,
    runtimeParams,
    username: "alice"
  });

  assert.equal(
    fs.readFileSync(path.join(projectRoot, "app", "L2", "alice", "notes.txt"), "utf8"),
    "two\n"
  );

  writeAppFile({
    content: "group\n",
    path: "L1/team/group.txt",
    projectRoot,
    runtimeParams,
    username: "manager",
    watchdog: createGroupWatchdog()
  });
  await flushGitHistoryCommits({ throwOnError: true });

  const groupHistory = await listLayerHistoryCommits({
    limit: 10,
    path: "L1/team",
    projectRoot,
    runtimeParams,
    username: "manager",
    watchdog: createGroupWatchdog()
  });

  assert.equal(groupHistory.path, "L1/team/");
  assert.equal(groupHistory.commits.length, 1);
  assert.deepEqual(
    groupHistory.commits[0].changedFiles.sort((left, right) => left.localeCompare(right)),
    [".gitignore", "group.txt"]
  );
  assert.equal(fs.readFileSync(path.join(projectRoot, "app", "L1", "team", ".gitignore"), "utf8"), "");

  const repositoryWatchdog = createGroupWatchdog(collectProjectPaths(projectRoot));
  const aliceWritableRepositories = listAppPathsByPatterns({
    access: "write",
    gitRepositories: true,
    patterns: ["**/.git/"],
    projectRoot,
    runtimeParams,
    username: "alice",
    watchdog: repositoryWatchdog
  });

  assert.deepEqual(aliceWritableRepositories["**/.git/"], ["L2/alice/"]);

  const managerWritableRepositories = listAppPathsByPatterns({
    access: "write",
    gitRepositories: true,
    patterns: ["**/.git/"],
    projectRoot,
    runtimeParams,
    username: "manager",
    watchdog: repositoryWatchdog
  });

  assert.deepEqual(managerWritableRepositories["**/.git/"], ["L1/team/"]);

  const aliceReadableRepositories = listAppPathsByPatterns({
    gitRepositories: true,
    patterns: ["**/.git/"],
    projectRoot,
    runtimeParams,
    username: "alice",
    watchdog: repositoryWatchdog
  });

  assert.deepEqual(aliceReadableRepositories["**/.git/"], ["L1/team/", "L2/alice/"]);

  const managerWritableRepositoryList = listAppPaths({
    access: "write",
    gitRepositories: true,
    path: "/app/",
    projectRoot,
    runtimeParams,
    username: "manager",
    watchdog: repositoryWatchdog
  });

  assert.deepEqual(managerWritableRepositoryList.paths, ["L1/team/"]);

  const legacyRoot = path.join(projectRoot, "app", "L2", "legacy");
  fs.mkdirSync(path.join(legacyRoot, "meta"), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "notes.txt"), "old\n");
  fs.writeFileSync(path.join(legacyRoot, "meta", "password.json"), "old-password\n");
  fs.writeFileSync(path.join(legacyRoot, "meta", "logins.json"), "old-logins\n");
  runGit(legacyRoot, ["init"]);
  runGit(legacyRoot, ["add", "-A", "--", "."]);
  runGit(legacyRoot, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.local",
    "commit",
    "--no-gpg-sign",
    "-m",
    "legacy initial"
  ]);
  const legacyInitialCommit = runGit(legacyRoot, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(legacyRoot, "notes.txt"), "new\n");
  runGit(legacyRoot, ["add", "-A", "--", "."]);
  runGit(legacyRoot, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.local",
    "commit",
    "--no-gpg-sign",
    "-m",
    "legacy newer"
  ]);
  fs.writeFileSync(path.join(legacyRoot, "meta", "password.json"), "current-password\n");
  fs.writeFileSync(path.join(legacyRoot, "meta", "logins.json"), "current-logins\n");

  await rollbackLayerHistory({
    commitHash: legacyInitialCommit,
    path: "L2/legacy",
    projectRoot,
    runtimeParams,
    username: "legacy"
  });

  assert.equal(fs.readFileSync(path.join(legacyRoot, "notes.txt"), "utf8"), "old\n");
  assert.equal(fs.readFileSync(path.join(legacyRoot, "meta", "password.json"), "utf8"), "current-password\n");
  assert.equal(fs.readFileSync(path.join(legacyRoot, "meta", "logins.json"), "utf8"), "current-logins\n");

  writeAppFile({
    content: "after rollback\n",
    path: "L2/legacy/notes.txt",
    projectRoot,
    runtimeParams,
    username: "legacy"
  });
  await flushGitHistoryCommits({ throwOnError: true });

  assert.equal(runGit(legacyRoot, ["ls-files", "meta/password.json"]), "");
  assert.equal(runGit(legacyRoot, ["ls-files", "meta/logins.json"]), "");
} finally {
  fs.rmSync(projectRoot, {
    force: true,
    recursive: true
  });
}
