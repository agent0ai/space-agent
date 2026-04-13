import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentServer } from "../server/app.js";

test("file APIs use router-supplied request context fields", async (testContext) => {
  const customwarePath = await mkdtemp(path.join(os.tmpdir(), "space-file-api-"));
  const runtime = await createAgentServer({
    runtimeParamOverrides: {
      CUSTOMWARE_PATH: customwarePath,
      PORT: "0",
      SINGLE_USER_APP: "true"
    }
  });

  testContext.after(async () => {
    await runtime.close();
    await rm(customwarePath, { recursive: true, force: true });
  });

  await runtime.listen();

  const postJson = async (pathname, body) => {
    const response = await fetch(`${runtime.browserUrl}${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    return {
      body: await response.json(),
      response
    };
  };

  const writeResult = await postJson("/api/file_write", {
    content: "hello",
    path: "~/hello.txt"
  });
  assert.equal(writeResult.response.status, 200);
  assert.equal(writeResult.body.path, "L2/user/hello.txt");

  const listResult = await postJson("/api/file_list", {
    path: "~/"
  });
  assert.equal(listResult.response.status, 200);
  assert.ok(Array.isArray(listResult.body.paths));
  assert.ok(listResult.body.paths.includes("L2/user/hello.txt"));

  const readResult = await postJson("/api/file_read", {
    path: "~/hello.txt"
  });
  assert.equal(readResult.response.status, 200);
  assert.deepEqual(readResult.body, {
    content: "hello",
    encoding: "utf8",
    path: "L2/user/hello.txt"
  });

  const infoResult = await postJson("/api/file_info", {
    path: "~/hello.txt"
  });
  assert.equal(infoResult.response.status, 200);
  assert.equal(infoResult.body.path, "L2/user/hello.txt");
  assert.equal(infoResult.body.isDirectory, false);
  assert.equal(infoResult.body.size, Buffer.byteLength("hello"));
});
