import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findLastAssignmentValue,
  resolveConfiguredUpdateRemoteUrl
} from "../commands/lib/update_remote.js";
import { resolveUpdateSource } from "../commands/lib/supervisor/git_releases.js";

test("update remote prefers explicit then runtime assignment then env", () => {
  assert.equal(findLastAssignmentValue(["GIT_URL=https://a", "HOST=0.0.0.0"], "GIT_URL"), "https://a");
  assert.equal(
    resolveConfiguredUpdateRemoteUrl({
      explicitRemoteUrl: "https://explicit.example/repo.git",
      projectRoot: "/workspace/agent-one",
      runtimeArgs: ["GIT_URL=https://arg.example/repo.git"]
    }),
    "https://explicit.example/repo.git"
  );
  assert.equal(
    resolveConfiguredUpdateRemoteUrl({
      env: {
        GIT_URL: "https://env.example/repo.git"
      },
      projectRoot: "/workspace/agent-one",
      runtimeArgs: ["GIT_URL=https://arg.example/repo.git"]
    }),
    "https://arg.example/repo.git"
  );
});

test("update remote falls back to local git origin when runtime value is unset", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "space-update-remote-"));

  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init"], {
      cwd: tempDir,
      stdio: "ignore"
    });
    execFileSync("git", ["remote", "add", "origin", "https://origin.example/repo.git"], {
      cwd: tempDir,
      stdio: "ignore"
    });

    assert.equal(
      resolveConfiguredUpdateRemoteUrl({
        env: {},
        projectRoot: tempDir,
        runtimeArgs: []
      }),
      "https://origin.example/repo.git"
    );
  } finally {
    await fs.rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("supervisor update source uses runtime GIT_URL over local origin", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "space-update-source-"));

  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-b", "main"], {
      cwd: tempDir,
      stdio: "ignore"
    });
    execFileSync("git", ["config", "user.name", "Space Agent"], {
      cwd: tempDir,
      stdio: "ignore"
    });
    execFileSync("git", ["config", "user.email", "space-agent@example.com"], {
      cwd: tempDir,
      stdio: "ignore"
    });
    await fs.writeFile(path.join(tempDir, "README.md"), "test\n", "utf8");
    execFileSync("git", ["add", "README.md"], {
      cwd: tempDir,
      stdio: "ignore"
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: tempDir,
      stdio: "ignore"
    });
    execFileSync("git", ["remote", "add", "origin", "https://origin.example/repo.git"], {
      cwd: tempDir,
      stdio: "ignore"
    });

    const updateSource = await resolveUpdateSource({
      projectRoot: tempDir,
      runtimeArgs: ["GIT_URL=https://runtime.example/repo.git"]
    });

    assert.equal(updateSource.branchName, "main");
    assert.equal(updateSource.remoteUrl, "https://runtime.example/repo.git");
  } finally {
    await fs.rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});
