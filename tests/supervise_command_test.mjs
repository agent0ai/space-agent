import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PASSWORD_SEAL_KEY_ENV_NAME,
  SESSION_HMAC_KEY_ENV_NAME,
  loadSupervisorAuthEnv
} from "../commands/lib/supervisor/auth_keys.js";
import { __test as superviseTest } from "../commands/supervise.js";
import {
  AUTH_KEYS_FILENAME,
  buildAuthDataDir,
  loadAuthKeys
} from "../server/lib/auth/keys_manage.js";
import { buildServeProcessTitle, buildSupervisorProcessTitle } from "../server/lib/utils/process_title.js";

function createTempDir(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "space-supervise-test-"));
  t.after(() => fs.rmSync(tempDir, { force: true, recursive: true }));
  return tempDir;
}

function encodeTestKey(byteValue) {
  return Buffer.alloc(32, byteValue).toString("base64url");
}

function writeAuthKeysFile(filePath, passwordByte, sessionByte) {
  fs.mkdirSync(path.dirname(filePath), {
    mode: 0o700,
    recursive: true
  });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        created_at: "2026-04-30T00:00:00.000Z",
        password_seal_key: encodeTestKey(passwordByte),
        session_hmac_key: encodeTestKey(sessionByte)
      },
      null,
      2
    )}\n`,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
}

function readAuthKeysFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

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

test("supervise reuses canonical server auth keys created by CLI and server helpers", async (t) => {
  const tempDir = createTempDir(t);
  const projectRoot = path.join(tempDir, "project");
  const stateDir = path.join(projectRoot, "supervisor");
  const serverKeys = loadAuthKeys(projectRoot, {});
  const auth = await loadSupervisorAuthEnv({
    env: {},
    projectRoot,
    stateDir
  });

  assert.equal(auth.source, serverKeys.filePath);
  assert.deepEqual(auth.env, {
    [PASSWORD_SEAL_KEY_ENV_NAME]: Buffer.from(serverKeys.passwordSealKey).toString("base64url"),
    [SESSION_HMAC_KEY_ENV_NAME]: Buffer.from(serverKeys.sessionHmacKey).toString("base64url")
  });
});

test("supervise prefers canonical server auth keys over legacy supervisor keys", async (t) => {
  const tempDir = createTempDir(t);
  const projectRoot = path.join(tempDir, "project");
  const stateDir = path.join(projectRoot, "supervisor");
  const serverKeysPath = path.join(buildAuthDataDir(projectRoot, {}), AUTH_KEYS_FILENAME);
  const legacyKeysPath = path.join(stateDir, "auth", AUTH_KEYS_FILENAME);

  writeAuthKeysFile(serverKeysPath, 1, 2);
  writeAuthKeysFile(legacyKeysPath, 3, 4);

  const auth = await loadSupervisorAuthEnv({
    env: {},
    projectRoot,
    stateDir
  });

  assert.equal(auth.source, serverKeysPath);
  assert.equal(auth.env[PASSWORD_SEAL_KEY_ENV_NAME], encodeTestKey(1));
  assert.equal(auth.env[SESSION_HMAC_KEY_ENV_NAME], encodeTestKey(2));
});

test("supervise migrates legacy supervisor auth keys when canonical storage is absent", async (t) => {
  const tempDir = createTempDir(t);
  const projectRoot = path.join(tempDir, "project");
  const stateDir = path.join(projectRoot, "supervisor");
  const serverKeysPath = path.join(buildAuthDataDir(projectRoot, {}), AUTH_KEYS_FILENAME);
  const legacyKeysPath = path.join(stateDir, "auth", AUTH_KEYS_FILENAME);

  writeAuthKeysFile(legacyKeysPath, 5, 6);

  const auth = await loadSupervisorAuthEnv({
    env: {},
    projectRoot,
    stateDir
  });

  assert.equal(auth.env[PASSWORD_SEAL_KEY_ENV_NAME], encodeTestKey(5));
  assert.equal(auth.env[SESSION_HMAC_KEY_ENV_NAME], encodeTestKey(6));
  assert.equal(readAuthKeysFile(serverKeysPath).password_seal_key, encodeTestKey(5));
  assert.equal(readAuthKeysFile(serverKeysPath).session_hmac_key, encodeTestKey(6));
  assert.ok(auth.source.startsWith(serverKeysPath));
  assert.ok(auth.source.includes(`migrated from ${legacyKeysPath}`));
});

test("runtime process titles stay distinct and short enough for htop-style listings", () => {
  assert.equal(buildSupervisorProcessTitle(), "space-supervise");
  assert.equal(buildServeProcessTitle(), "space-serve");
  assert.equal(buildServeProcessTitle({ clusterPrimary: true }), "space-serve-p");
  assert.equal(buildServeProcessTitle({ workerNumber: 1 }), "space-serve-w1");
  assert.equal(buildServeProcessTitle({ workerNumber: 12 }), "space-serve-w12");
});
