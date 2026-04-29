import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBundleRuntime } from "../app/L0/_all/mod/_core/framework/js/bundles.js";
import { listInstalledBundles, listInstalledModules, readBundleInfo } from "../server/lib/customware/module_manage.js";
import { createStateSystem } from "../server/runtime/state_system.js";
import {
  FILE_INDEX_AREA,
  GROUP_INDEX_AREA,
  GROUP_META_AREA,
  GROUP_USER_INDEX_AREA
} from "../server/runtime/state_areas.js";

const CUSTOMWARE_BUNDLE_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/customware_bundle_example/", import.meta.url)
);
const COMPONENT_CONTEXT_MENU_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/component_context_menu_bundle/", import.meta.url)
);

function createRuntimeParams(values = {}) {
  return {
    get(name, fallbackValue = undefined) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallbackValue;
    }
  };
}

function copyDirectory(projectRoot, appPath, sourcePath) {
  const absolutePath = path.join(projectRoot, "app", ...appPath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.cpSync(sourcePath, absolutePath, { recursive: true });
}

function writeFile(projectRoot, appPath, content) {
  const absolutePath = path.join(projectRoot, "app", ...appPath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function seedBundleState() {
  const stateSystem = createStateSystem();

  stateSystem.setEntry(GROUP_INDEX_AREA, "team", {
    groupId: "team",
    includesAllUsers: false,
    memberUsers: ["alice"]
  });
  stateSystem.setEntry(GROUP_META_AREA, "errors", []);
  stateSystem.setEntry(GROUP_META_AREA, "inclusion_cycles", []);
  stateSystem.setEntry(GROUP_USER_INDEX_AREA, "alice", {
    username: "alice",
    groups: ["team"],
    managedGroups: []
  });
  stateSystem.setEntry(FILE_INDEX_AREA, "L1/team", {
    "/app/L1/team/mod/example/customware_bundle_example/": {
      isDirectory: true,
      mtimeMs: 1,
      sizeBytes: 0
    },
    "/app/L1/team/mod/example/customware_bundle_example/space.bundle.yaml": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 300
    }
  });
  stateSystem.setEntry(FILE_INDEX_AREA, "L2/alice", {
    "/app/L2/alice/mod/acme/invalid/": {
      isDirectory: true,
      mtimeMs: 1,
      sizeBytes: 0
    },
    "/app/L2/alice/mod/acme/invalid/space.bundle.yaml": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 20
    }
  });

  return stateSystem;
}

function seedComponentContextMenuBundleState() {
  const stateSystem = createStateSystem();

  stateSystem.setEntry(GROUP_INDEX_AREA, "team", {
    groupId: "team",
    includesAllUsers: false,
    memberUsers: ["alice"]
  });
  stateSystem.setEntry(GROUP_META_AREA, "errors", []);
  stateSystem.setEntry(GROUP_META_AREA, "inclusion_cycles", []);
  stateSystem.setEntry(GROUP_USER_INDEX_AREA, "alice", {
    username: "alice",
    groups: ["team"],
    managedGroups: []
  });
  stateSystem.setEntry(FILE_INDEX_AREA, "L1/team", {
    "/app/L1/team/mod/space/component-context-menu/": {
      isDirectory: true,
      mtimeMs: 1,
      sizeBytes: 0
    },
    "/app/L1/team/mod/space/component-context-menu/space.bundle.yaml": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 460
    }
  });

  return stateSystem;
}

test("customware bundles are discovered from installed module manifests", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "space-bundle-test-"));
  t.after(() => fs.rmSync(projectRoot, { force: true, recursive: true }));

  copyDirectory(
    projectRoot,
    "L1/team/mod/example/customware_bundle_example",
    CUSTOMWARE_BUNDLE_FIXTURE_PATH
  );
  writeFile(projectRoot, "L2/alice/mod/acme/invalid/space.bundle.yaml", "id: Bad Bundle\n");

  const runtimeParams = createRuntimeParams();
  const stateSystem = seedBundleState();

  const bundles = await listInstalledBundles({
    area: "l1",
    projectRoot,
    runtimeParams,
    stateSystem,
    username: "alice"
  });

  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].id, "example/customware-bundle");
  assert.equal(bundles[0].valid, true);
  assert.deepEqual(bundles[0].capabilities, ["theme", "actions"]);
  assert.deepEqual(
    bundles[0].actions.map((action) => [action.id, action.title, action.bundleId]),
    [["example.bundle.ping", "Example bundle ping", "example/customware-bundle"]]
  );
  assert.equal(bundles[0].module.path, "L1/team/mod/example/customware_bundle_example/");

  const moduleEntries = await listInstalledModules({
    area: "l1",
    projectRoot,
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.equal(moduleEntries[0].bundle.id, "example/customware-bundle");
});

test("component context menu bundle fixture advertises the initializer plugin seam", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "space-component-menu-test-"));
  t.after(() => fs.rmSync(projectRoot, { force: true, recursive: true }));

  copyDirectory(
    projectRoot,
    "L1/team/mod/space/component-context-menu",
    COMPONENT_CONTEXT_MENU_FIXTURE_PATH
  );

  const runtimeParams = createRuntimeParams();
  const stateSystem = seedComponentContextMenuBundleState();

  const bundles = await listInstalledBundles({
    area: "l1",
    projectRoot,
    runtimeParams,
    stateSystem,
    username: "alice"
  });

  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].id, "space/component-context-menu");
  assert.deepEqual(bundles[0].capabilities, ["component-menu", "actions", "browser-runtime"]);
  assert.deepEqual(bundles[0].extensionPoints, ["_core/framework/initializer.js/initialize/end"]);
  assert.deepEqual(
    bundles[0].actions.map((action) => [action.id, action.title, action.capability]),
    [["space.component_menu.copy_id", "Copy component ID", "component-menu"]]
  );
  assert.equal(bundles[0].module.path, "L1/team/mod/space/component-context-menu/");

  const info = await readBundleInfo({
    maxLayer: 1,
    path: "/mod/space/component-context-menu",
    projectRoot,
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.equal(info.installed, true);
  assert.equal(info.bundle.id, "space/component-context-menu");
});

test("customware bundle info returns selected module metadata and invalid manifest errors", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "space-bundle-test-"));
  t.after(() => fs.rmSync(projectRoot, { force: true, recursive: true }));

  copyDirectory(
    projectRoot,
    "L1/team/mod/example/customware_bundle_example",
    CUSTOMWARE_BUNDLE_FIXTURE_PATH
  );
  writeFile(projectRoot, "L2/alice/mod/acme/invalid/space.bundle.yaml", "id: Bad Bundle\n");

  const runtimeParams = createRuntimeParams();
  const stateSystem = seedBundleState();

  const info = await readBundleInfo({
    maxLayer: 1,
    path: "/mod/example/customware_bundle_example",
    projectRoot,
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.equal(info.installed, true);
  assert.equal(info.bundle.id, "example/customware-bundle");
  assert.equal(info.module.selectedPath, "L1/team/mod/example/customware_bundle_example/");

  const invalidBundles = await listInstalledBundles({
    area: "l2_self",
    projectRoot,
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.equal(invalidBundles.length, 1);
  assert.equal(invalidBundles[0].valid, false);
  assert.match(invalidBundles[0].errors.join("\n"), /Bundle id must start/u);
});

test("browser bundle runtime registers removable actions and bridge sync handlers", async () => {
  const apiCalls = [];
  const runtime = createBundleRuntime({
    api: {
      bundleInfo(pathOrOptions) {
        apiCalls.push(["info", pathOrOptions]);
        return Promise.resolve({ bundle: null, installed: false, module: {} });
      },
      bundleList(options) {
        apiCalls.push(["list", options]);
        return Promise.resolve([]);
      }
    }
  });

  assert.deepEqual(await runtime.list({ area: "l1" }), []);
  assert.deepEqual(apiCalls[0], ["list", { area: "l1" }]);

  const unregisterAction = runtime.actions.register({
    bundleId: "acme/fleet",
    id: "fleet.open",
    title: "Open fleet",
    async run(payload, context) {
      return {
        actionId: context.action.id,
        payload
      };
    }
  });

  assert.deepEqual(runtime.actions.list(), [
    {
      bundleId: "acme/fleet",
      capability: "",
      description: "",
      id: "fleet.open",
      title: "Open fleet"
    }
  ]);
  assert.deepEqual(await runtime.actions.run("fleet.open", { node: "orchestrator" }), {
    actionId: "fleet.open",
    payload: { node: "orchestrator" }
  });
  assert.equal(unregisterAction(), true);
  assert.equal(runtime.actions.get("fleet.open"), null);

  const unregisterSync = runtime.bridge.registerSync("hermes", (payload) => ({
    received: payload
  }));
  assert.deepEqual(await runtime.bridge.syncState("hermes", { online: true }), {
    received: { online: true }
  });
  assert.equal(unregisterSync(), true);
  assert.equal(await runtime.bridge.syncState("hermes", { online: false }), null);
});
