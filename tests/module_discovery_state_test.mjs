import test from "node:test";
import assert from "node:assert/strict";

import { resolveInheritedModuleProjectPath } from "../server/lib/customware/module_inheritance.js";
import {
  listResolvedExtensionRequestPathGroups,
  listResolvedExtensionRequestPaths
} from "../server/lib/customware/extension_overrides.js";
import { listInstalledModules, readModuleInfo } from "../server/lib/customware/module_manage.js";
import { createStateSystem } from "../server/runtime/state_system.js";
import {
  FILE_INDEX_AREA,
  GROUP_INDEX_AREA,
  GROUP_META_AREA,
  GROUP_USER_INDEX_AREA
} from "../server/runtime/state_areas.js";

function createRuntimeParams(values = {}) {
  return {
    get(name, fallbackValue = undefined) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallbackValue;
    }
  };
}

function seedDiscoveryState() {
  const stateSystem = createStateSystem();

  stateSystem.setEntry(GROUP_INDEX_AREA, "team", {
    groupId: "team",
    includesAllUsers: false,
    memberUsers: ["alice", "admin"]
  });
  stateSystem.setEntry(GROUP_INDEX_AREA, "_admin", {
    groupId: "_admin",
    includesAllUsers: false,
    memberUsers: ["admin"]
  });
  stateSystem.setEntry(GROUP_META_AREA, "errors", []);
  stateSystem.setEntry(GROUP_META_AREA, "inclusion_cycles", []);
  stateSystem.setEntry(GROUP_USER_INDEX_AREA, "alice", {
    username: "alice",
    groups: ["team"],
    managedGroups: []
  });
  stateSystem.setEntry(GROUP_USER_INDEX_AREA, "bob", {
    username: "bob",
    groups: [],
    managedGroups: []
  });
  stateSystem.setEntry(GROUP_USER_INDEX_AREA, "admin", {
    username: "admin",
    groups: ["_admin", "team"],
    managedGroups: ["_all"]
  });

  stateSystem.setEntry(FILE_INDEX_AREA, "L0", {
    "/app/L0/_all/mod/_core/framework/css/colors.css": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    },
    "/app/L0/_all/mod/acme/demo/index.js": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    },
    "/app/L0/_all/mod/acme/demo/ext/pages/default.yaml": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    }
  });
  stateSystem.setEntry(FILE_INDEX_AREA, "L1/team", {
    "/app/L1/team/mod/acme/demo/": {
      isDirectory: true,
      mtimeMs: 1,
      sizeBytes: 0
    },
    "/app/L1/team/mod/acme/demo/index.js": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    },
    "/app/L1/team/mod/acme/demo/ext/pages/team.yaml": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    }
  });
  stateSystem.setEntry(FILE_INDEX_AREA, "L2/alice", {
    "/app/L2/alice/mod/acme/demo/": {
      isDirectory: true,
      mtimeMs: 1,
      sizeBytes: 0
    },
    "/app/L2/alice/mod/acme/demo/index.js": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    },
    "/app/L2/alice/mod/acme/demo/ext/pages/user.yaml": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    }
  });
  stateSystem.setEntry(FILE_INDEX_AREA, "L2/bob", {
    "/app/L2/bob/mod/acme/solo/": {
      isDirectory: true,
      mtimeMs: 1,
      sizeBytes: 0
    },
    "/app/L2/bob/mod/acme/solo/index.js": {
      isDirectory: false,
      mtimeMs: 1,
      sizeBytes: 1
    }
  });

  return stateSystem;
}

test("state-backed module discovery resolves L0, L1, and L2 per user visibility", async () => {
  const stateSystem = seedDiscoveryState();
  const runtimeParams = createRuntimeParams();

  const firmware = resolveInheritedModuleProjectPath({
    maxLayer: 2,
    projectRoot: "/workspace/agent-one",
    requestPath: "/mod/_core/framework/css/colors.css",
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.equal(firmware?.projectPath, "/app/L0/_all/mod/_core/framework/css/colors.css");

  const aliceModule = resolveInheritedModuleProjectPath({
    maxLayer: 2,
    projectRoot: "/workspace/agent-one",
    requestPath: "/mod/acme/demo/index.js",
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.equal(aliceModule?.projectPath, "/app/L2/alice/mod/acme/demo/index.js");

  const bobModule = resolveInheritedModuleProjectPath({
    maxLayer: 2,
    projectRoot: "/workspace/agent-one",
    requestPath: "/mod/acme/demo/index.js",
    runtimeParams,
    stateSystem,
    username: "bob"
  });
  assert.equal(bobModule?.projectPath, "/app/L0/_all/mod/acme/demo/index.js");

  const noL2Module = resolveInheritedModuleProjectPath({
    maxLayer: 1,
    projectRoot: "/workspace/agent-one",
    requestPath: "/mod/acme/demo/index.js",
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.equal(noL2Module?.projectPath, "/app/L1/team/mod/acme/demo/index.js");
});

test("state-backed extension discovery respects layered overrides and caller visibility", () => {
  const stateSystem = seedDiscoveryState();
  const runtimeParams = createRuntimeParams();

  const aliceExtensions = listResolvedExtensionRequestPaths({
    maxLayer: 2,
    patterns: ["pages/*.yaml"],
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.deepEqual(aliceExtensions, [
    "/mod/acme/demo/ext/pages/default.yaml",
    "/mod/acme/demo/ext/pages/team.yaml",
    "/mod/acme/demo/ext/pages/user.yaml"
  ]);

  const bobExtensions = listResolvedExtensionRequestPaths({
    maxLayer: 2,
    patterns: ["pages/*.yaml"],
    runtimeParams,
    stateSystem,
    username: "bob"
  });
  assert.deepEqual(bobExtensions, ["/mod/acme/demo/ext/pages/default.yaml"]);

  const grouped = listResolvedExtensionRequestPathGroups({
    maxLayer: 2,
    requests: [
      { key: "pages", patterns: ["pages/*.yaml"] },
      { key: "teamOnly", patterns: ["pages/team.yaml"] }
    ],
    runtimeParams,
    stateSystem,
    username: "alice"
  });
  assert.deepEqual(grouped.pages, [
    "/mod/acme/demo/ext/pages/default.yaml",
    "/mod/acme/demo/ext/pages/team.yaml",
    "/mod/acme/demo/ext/pages/user.yaml"
  ]);
  assert.deepEqual(grouped.teamOnly, ["/mod/acme/demo/ext/pages/team.yaml"]);
});

test("state-backed module management lists self and admin cross-user visibility correctly", async () => {
  const stateSystem = seedDiscoveryState();
  const runtimeParams = createRuntimeParams();

  const aliceL1 = await listInstalledModules({
    area: "l1",
    runtimeParams,
    search: "",
    stateSystem,
    username: "alice"
  });
  assert.deepEqual(
    aliceL1.map((entry) => entry.path),
    ["L1/team/mod/acme/demo/"]
  );

  const bobL1 = await listInstalledModules({
    area: "l1",
    runtimeParams,
    search: "",
    stateSystem,
    username: "bob"
  });
  assert.deepEqual(bobL1, []);

  const aliceSelf = await listInstalledModules({
    area: "l2_self",
    runtimeParams,
    search: "",
    stateSystem,
    username: "alice"
  });
  assert.deepEqual(
    aliceSelf.map((entry) => entry.path),
    ["L2/alice/mod/acme/demo/"]
  );

  const adminUsers = await listInstalledModules({
    area: "l2_users",
    runtimeParams,
    search: "",
    stateSystem,
    username: "admin"
  });
  assert.equal(adminUsers.length, 2);
  assert.deepEqual(
    adminUsers.map((entry) => [entry.requestPath, entry.ownerCount]),
    [
      ["/mod/acme/demo", 1],
      ["/mod/acme/solo", 1]
    ]
  );

  const bobInfo = await readModuleInfo({
    includeOtherUsers: true,
    maxLayer: 2,
    ownerId: "bob",
    path: "/mod/acme/solo",
    projectRoot: "/workspace/agent-one",
    runtimeParams,
    stateSystem,
    username: "admin"
  });
  assert.equal(bobInfo.installed, true);
  assert.equal(bobInfo.selectedPath, "L2/bob/mod/acme/solo/");
});
