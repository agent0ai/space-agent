import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createUser } from "../server/lib/auth/user_manage.js";
import { createGroup } from "../server/lib/customware/group_files.js";
import { createWatchdog } from "../server/lib/file_watch/watchdog.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, "..");

function createStaticRuntimeParams(values = {}) {
  return {
    get(name, fallback = undefined) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(condition, description, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await wait(25);
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

function createCustomwareRuntimeParams(customwarePath) {
  return createStaticRuntimeParams({
    CUSTOMWARE_GIT_HISTORY: false,
    CUSTOMWARE_PATH: customwarePath
  });
}

test("watchdog leaves external L2 changes unloaded until the user shard is requested", async (testContext) => {
  const customwarePath = fs.mkdtempSync(path.join(os.tmpdir(), "space-watchdog-external-"));
  const runtimeParams = createCustomwareRuntimeParams(customwarePath);
  const watchdog = createWatchdog({
    projectRoot: PROJECT_ROOT,
    reconcileIntervalMs: 0,
    runtimeParams
  });

  testContext.after(() => {
    watchdog.stop();
    fs.rmSync(customwarePath, { force: true, recursive: true });
  });

  fs.mkdirSync(path.join(customwarePath, "L1"), { recursive: true });
  fs.mkdirSync(path.join(customwarePath, "L2"), { recursive: true });

  await watchdog.start();

  const targetDirectory = path.join(customwarePath, "L2", "alice", "notes", "nested");
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(path.join(targetDirectory, "a.txt"), "hello");

  await wait(150);

  assert.equal(watchdog.hasPath("/app/L2/alice/notes/nested/a.txt"), false);

  await watchdog.ensureFileIndexShardLoaded("L2/alice");

  assert.equal(watchdog.hasPath("/app/L2/alice/notes/nested/"), true);
  assert.equal(watchdog.hasPath("/app/L2/alice/notes/nested/a.txt"), true);

  assert.equal(
    Boolean(watchdog.getIndex("path_index")["/app/L2/alice/notes/nested/a.txt"]),
    true
  );
});

test("watchdog tracks CLI-style group writes immediately and L2 user writes on demand", async (testContext) => {
  const customwarePath = fs.mkdtempSync(path.join(os.tmpdir(), "space-watchdog-cli-"));
  const runtimeParams = createCustomwareRuntimeParams(customwarePath);
  const watchdog = createWatchdog({
    projectRoot: PROJECT_ROOT,
    reconcileIntervalMs: 0,
    runtimeParams
  });

  testContext.after(() => {
    watchdog.stop();
    fs.rmSync(customwarePath, { force: true, recursive: true });
  });

  fs.mkdirSync(path.join(customwarePath, "L1"), { recursive: true });
  fs.mkdirSync(path.join(customwarePath, "L2"), { recursive: true });

  await watchdog.start();

  createUser(PROJECT_ROOT, "bob", "secret123", {
    runtimeParams
  });
  createGroup(PROJECT_ROOT, "team-red", {
    runtimeParams
  });

  await waitFor(
    () =>
      watchdog.hasPath("/app/L1/team-red/group.yaml"),
    "the CLI-style group file to appear in the watchdog index"
  );

  assert.equal(watchdog.hasPath("/app/L2/bob/meta/password.json"), false);

  await watchdog.ensureFileIndexShardLoaded("L2/bob");

  assert.equal(watchdog.hasPath("/app/L2/bob/user.yaml"), true);
  assert.equal(watchdog.hasPath("/app/L2/bob/meta/password.json"), true);
  assert.equal(watchdog.hasPath("/app/L2/bob/meta/logins.json"), true);
  assert.equal(Boolean(watchdog.getIndex("path_index")["/app/L1/team-red/group.yaml"]), true);
  assert.equal(Boolean(watchdog.getIndex("path_index")["/app/L2/bob/meta/password.json"]), true);
});

test("watchdog can load L2 auth state without loading the full user shard", async (testContext) => {
  const customwarePath = fs.mkdtempSync(path.join(os.tmpdir(), "space-watchdog-auth-state-"));
  const runtimeParams = createCustomwareRuntimeParams(customwarePath);
  const watchdog = createWatchdog({
    liveWatchEnabled: false,
    projectRoot: PROJECT_ROOT,
    reconcileIntervalMs: 0,
    runtimeParams
  });

  testContext.after(() => {
    watchdog.stop();
    fs.rmSync(customwarePath, { force: true, recursive: true });
  });

  fs.mkdirSync(path.join(customwarePath, "L1"), { recursive: true });
  fs.mkdirSync(path.join(customwarePath, "L2"), { recursive: true });
  createUser(PROJECT_ROOT, "alice", "secret123", {
    runtimeParams
  });
  fs.mkdirSync(path.join(customwarePath, "L2", "alice", "notes"), { recursive: true });
  fs.writeFileSync(path.join(customwarePath, "L2", "alice", "notes", "private.txt"), "secret");

  await watchdog.start();

  assert.equal(watchdog.hasPath("/app/L2/alice/notes/private.txt"), false);

  await watchdog.ensureUserAuthStateLoaded("alice");

  assert.equal(watchdog.getIndex("user_index").hasUser("alice"), true);
  assert.equal(watchdog.hasPath("/app/L2/alice/user.yaml"), true);
  assert.equal(watchdog.hasPath("/app/L2/alice/meta/password.json"), true);
  assert.equal(watchdog.hasPath("/app/L2/alice/notes/private.txt"), false);

  await watchdog.ensureFileIndexShardLoaded("L2/alice");

  assert.equal(watchdog.hasPath("/app/L2/alice/notes/private.txt"), true);
});

test("watchdog lazy L2 shard payloads clear stale replica shards after deletion", async (testContext) => {
  const customwarePath = fs.mkdtempSync(path.join(os.tmpdir(), "space-watchdog-lazy-delete-"));
  const runtimeParams = createCustomwareRuntimeParams(customwarePath);
  const primary = createWatchdog({
    liveWatchEnabled: false,
    projectRoot: PROJECT_ROOT,
    reconcileIntervalMs: 0,
    runtimeParams
  });
  let replica = null;

  testContext.after(() => {
    primary.stop();
    replica?.stop();
    fs.rmSync(customwarePath, { force: true, recursive: true });
  });

  fs.mkdirSync(path.join(customwarePath, "L1"), { recursive: true });
  fs.mkdirSync(path.join(customwarePath, "L2", "alice", "notes"), { recursive: true });
  fs.writeFileSync(path.join(customwarePath, "L2", "alice", "notes", "private.txt"), "secret");

  await primary.start();

  const loadResult = await primary.ensureFileIndexShardLoaded("L2/alice");
  replica = createWatchdog({
    initialSnapshot: primary.getSnapshot(),
    liveWatchEnabled: false,
    projectRoot: PROJECT_ROOT,
    reconcileIntervalMs: 0,
    replica: true,
    runtimeParams
  });
  await replica.start();
  await replica.applyLazyFileIndexShards(loadResult.lazyFileIndexShards);

  assert.equal(replica.hasPath("/app/L2/alice/notes/private.txt"), true);

  fs.rmSync(path.join(customwarePath, "L2", "alice"), { force: true, recursive: true });
  const deleteResult = await primary.applyProjectPathChanges(["/app/L2/alice/"]);

  assert.equal(
    deleteResult.lazyFileIndexShards.some(
      (shard) => shard.id === "L2/alice" && Object.keys(shard.value || {}).length === 0
    ),
    true
  );

  await replica.applyLazyFileIndexShards(deleteResult.lazyFileIndexShards);

  assert.equal(replica.hasPath("/app/L2/alice/notes/private.txt"), false);
});

test("watchdog explicit project-path sync hydrates missing ancestors without a full layer rescan", async (testContext) => {
  const customwarePath = fs.mkdtempSync(path.join(os.tmpdir(), "space-watchdog-project-sync-"));
  const runtimeParams = createCustomwareRuntimeParams(customwarePath);
  const watchdog = createWatchdog({
    liveWatchEnabled: false,
    projectRoot: PROJECT_ROOT,
    reconcileIntervalMs: 0,
    runtimeParams
  });

  testContext.after(() => {
    watchdog.stop();
    fs.rmSync(customwarePath, { force: true, recursive: true });
  });

  fs.mkdirSync(path.join(customwarePath, "L1"), { recursive: true });
  fs.mkdirSync(path.join(customwarePath, "L2"), { recursive: true });

  await watchdog.start();

  const targetDirectory = path.join(customwarePath, "L2", "alice", "notes", "nested");
  const targetFile = path.join(targetDirectory, "a.txt");

  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(targetFile, "hello");

  await watchdog.applyProjectPathChanges(["/app/L2/alice/notes/nested/a.txt"]);

  const pathIndex = watchdog.getIndex("path_index");

  assert.equal(Boolean(pathIndex["/app/L2/alice/"]), true);
  assert.equal(Boolean(pathIndex["/app/L2/alice/notes/"]), true);
  assert.equal(Boolean(pathIndex["/app/L2/alice/notes/nested/"]), true);
  assert.equal(Boolean(pathIndex["/app/L2/alice/notes/nested/a.txt"]), true);
});

test("watchdog schedules reconciles from the previous completion instead of queuing overlap", async (testContext) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "space-watchdog-reconcile-"));
  const projectRoot = path.join(tempRoot, "project");
  const handlerDir = path.join(tempRoot, "handlers");
  const configPath = path.join(tempRoot, "watchdog.yaml");
  const watchdogModuleUrl = pathToFileURL(
    path.join(PROJECT_ROOT, "server", "lib", "file_watch", "watchdog.js")
  ).href;
  const runtimeParams = createStaticRuntimeParams({
    CUSTOMWARE_GIT_HISTORY: false
  });

  testContext.after(() => {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  fs.mkdirSync(path.join(projectRoot, "app", "L0"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "app", "L0", "seed.txt"), "seed\n");
  fs.mkdirSync(handlerDir, { recursive: true });
  fs.writeFileSync(
    path.join(handlerDir, "slow_counter.js"),
    `import fs from "node:fs";\nimport path from "node:path";\n\nimport { WatchdogHandler } from ${JSON.stringify(watchdogModuleUrl)};\n\nlet refreshCount = 0;\n\nfunction wait(ms) {\n  return new Promise((resolve) => {\n    setTimeout(resolve, ms);\n  });\n}\n\nfunction touchSeed(projectRoot) {\n  fs.writeFileSync(path.join(projectRoot, "app", "L0", "seed.txt"), \`seed-\${Date.now()}-\${refreshCount}\\n\`);\n}\n\nexport function getRefreshCount() {\n  return refreshCount;\n}\n\nexport default class SlowCounterHandler extends WatchdogHandler {\n  createInitialState() {\n    return { count: refreshCount };\n  }\n\n  async onStart() {\n    refreshCount += 1;\n    touchSeed(this.projectRoot);\n    await wait(80);\n    this.state = { count: refreshCount };\n  }\n\n  async onChanges() {\n    refreshCount += 1;\n\n    if (refreshCount < 4) {\n      touchSeed(this.projectRoot);\n    }\n\n    await wait(80);\n    this.state = { count: refreshCount };\n  }\n}\n`
  );
  fs.writeFileSync(
    configPath,
    `slow_counter:\n  - /app/**/*\n`
  );

  const slowCounterModule = await import(pathToFileURL(path.join(handlerDir, "slow_counter.js")).href);

  const watchdog = createWatchdog({
    configPath,
    handlerDir,
    projectRoot,
    reconcileIntervalMs: 50,
    runtimeParams,
    watchConfig: false
  });

  testContext.after(() => {
    watchdog.stop();
  });

  await watchdog.start();
  await wait(230);

  const refreshCount = Number(slowCounterModule.getRefreshCount() || 0);

  assert.ok(refreshCount >= 2, `Expected at least 2 refresh callbacks, saw ${refreshCount}.`);
  assert.ok(
    refreshCount < 5,
    `Expected completion-anchored reconcile scheduling, saw ${refreshCount} refresh callbacks.`
  );
});
