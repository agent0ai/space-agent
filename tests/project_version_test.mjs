import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_PROJECT_VERSION,
  normalizePackageVersionTag,
  resolveProjectVersion
} from "../server/lib/utils/project_version.js";

test("normalizePackageVersionTag formats release-style display tags", () => {
  assert.equal(normalizePackageVersionTag("0.55.0"), "v0.55");
  assert.equal(normalizePackageVersionTag("0.55.1"), "v0.55.1");
  assert.equal(normalizePackageVersionTag("v0.55"), "v0.55");
});

test("resolveProjectVersion falls back to package version outside a git checkout", async (testContext) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "space-version-"));

  testContext.after(async () => {
    await fs.rm(projectRoot, { force: true, recursive: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "space-version-test", version: "0.55.0" })
  );

  assert.equal(resolveProjectVersion(projectRoot), "v0.55");
});

test("resolveProjectVersion uses the default version when no source is available", async (testContext) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "space-version-empty-"));

  testContext.after(async () => {
    await fs.rm(projectRoot, { force: true, recursive: true });
  });

  assert.equal(resolveProjectVersion(projectRoot), DEFAULT_PROJECT_VERSION);
});
