import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createServerBootstrap } from "../server/app.js";
import {
  AUTH_DATA_DIR_ENV_NAME,
  buildAuthDataDir
} from "../server/lib/auth/keys_manage.js";

const require = createRequire(import.meta.url);
const {
  resolveDesktopAuthDataDir,
  resolveDesktopServerTmpDir
} = require("../packaging/desktop/server_storage_paths.js");
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, "..");

test("packaged desktop uses an OS temp directory outside the bundled server tree", () => {
  assert.equal(resolveDesktopServerTmpDir({ isPackaged: false, tempPath: "/tmp/ignored" }), "");
  assert.equal(
    resolveDesktopServerTmpDir({
      isPackaged: true,
      tempPath: "/run/user/1000"
    }),
    path.join("/run/user/1000", "space-agent", "server-tmp")
  );
});

test("packaged desktop temp directory falls back to the host temp root", () => {
  assert.equal(
    resolveDesktopServerTmpDir({
      isPackaged: true,
      tempPath: ""
    }),
    path.join(os.tmpdir(), "space-agent", "server-tmp")
  );
});

test("packaged desktop auth data moves to the user-data tree", () => {
  const userDataPath = "/home/alessandro/.config/Space Agent";

  assert.equal(
    resolveDesktopAuthDataDir({
      isPackaged: true,
      userDataPath
    }),
    path.join(userDataPath, "server", "data")
  );
  assert.equal(
    buildAuthDataDir("/tmp/.mount_Space-abc123/resources/app", {
      [AUTH_DATA_DIR_ENV_NAME]: path.join(userDataPath, "server", "data")
    }),
    path.join(userDataPath, "server", "data")
  );
});

test("server bootstrap honors a packaged desktop tmpDir override", async (testContext) => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "space-desktop-bootstrap-"));
  const tmpDir = path.join(runtimeRoot, "runtime", "space-agent", "server-tmp");

  testContext.after(async () => {
    await fs.rm(runtimeRoot, {
      force: true,
      recursive: true
    });
  });

  const bootstrap = await createServerBootstrap({
    projectRoot: PROJECT_ROOT,
    runtimeParamEnv: {},
    runtimeParamOverrides: {
      CUSTOMWARE_PATH: path.join(runtimeRoot, "customware"),
      HOST: "127.0.0.1",
      PORT: "0",
      SINGLE_USER_APP: "true",
      WORKERS: "1"
    },
    tmpDir
  });

  const stats = await fs.stat(tmpDir);

  assert.equal(bootstrap.tmpDir, tmpDir);
  assert.equal(stats.isDirectory(), true);
});
