import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { __test as superviseTest } from "../commands/supervise.js";
import { buildServeProcessTitle, buildSupervisorProcessTitle } from "../server/lib/utils/process_title.js";

test("supervise keeps serve args opaque and reserves only supervisor-owned flags", () => {
  const { options, serveArgs } = superviseTest.parseSuperviseArgs([
    "--branch",
    "main",
    "HOST=0.0.0.0",
    "PORT=4444",
    "WORKERS=8",
    "CUSTOMWARE_PATH=state",
    "--new-serve-flag",
    "ALLOW_GUEST_USERS=false"
  ]);

  assert.equal(options.branchName, "main");
  assert.deepEqual(serveArgs, [
    "HOST=0.0.0.0",
    "PORT=4444",
    "WORKERS=8",
    "CUSTOMWARE_PATH=state",
    "--new-serve-flag",
    "ALLOW_GUEST_USERS=false"
  ]);
});

test("supervise rewrites only child host port and customware path", () => {
  const serveArgs = superviseTest.buildServeArgs(
    [
      "WORKERS=8",
      "HOST=10.0.0.1",
      "PORT=1234",
      "CUSTOMWARE_PATH=relative-state",
      "--future-serve-flag",
      "ALLOW_GUEST_USERS=false"
    ],
    "/srv/space/customware"
  );

  assert.deepEqual(serveArgs, [
    "WORKERS=8",
    "CUSTOMWARE_PATH=/srv/space/customware",
    "--future-serve-flag",
    "ALLOW_GUEST_USERS=false",
    "HOST=127.0.0.1",
    "PORT=0"
  ]);
});

test("supervise resolves public bind and required customware from args then env", () => {
  const serveArgs = [
    "HOST=1.2.3.4",
    "PORT=4567",
    "CUSTOMWARE_PATH=relative-state"
  ];
  const env = {
    CUSTOMWARE_PATH: "/ignored/by/arg",
    HOST: "9.9.9.9",
    PORT: "9999"
  };

  assert.equal(
    superviseTest.resolveRequiredCustomwarePath("/workspace/agent-one", serveArgs, env),
    path.resolve("/workspace/agent-one", "relative-state")
  );
  assert.equal(superviseTest.resolvePublicHost({}, serveArgs, env), "1.2.3.4");
  assert.equal(superviseTest.resolvePublicPort({}, serveArgs, env), 4567);
});

test("supervise defaults state dir to project-root supervisor folder", () => {
  assert.equal(
    superviseTest.resolveDefaultStateDir("/workspace/agent-one"),
    path.join("/workspace/agent-one", "supervisor")
  );
});

test("runtime process titles stay distinct and short enough for htop-style listings", () => {
  assert.equal(buildSupervisorProcessTitle(), "space-supervise");
  assert.equal(buildServeProcessTitle(), "space-serve");
  assert.equal(buildServeProcessTitle({ clusterPrimary: true }), "space-serve-p");
  assert.equal(buildServeProcessTitle({ workerNumber: 1 }), "space-serve-w1");
  assert.equal(buildServeProcessTitle({ workerNumber: 12 }), "space-serve-w12");
});
