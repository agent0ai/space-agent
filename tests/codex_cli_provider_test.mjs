import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { post } from "../server/api/codex_chat.js";
import { buildCodexPrompt } from "../server/lib/codex_cli/prompt_format.js";

async function readStream(stream) {
  let output = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output += chunk;
  });

  await new Promise((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });

  return output;
}

async function createFakeCodexBinary() {
  const directory = await mkdtemp(path.join(tmpdir(), "space-agent-codex-test-"));
  const binaryPath = path.join(directory, "codex");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  if (!process.argv.includes("exec") || !process.argv.includes("--json") || !process.argv.includes("-")) {
    console.error("missing expected codex exec arguments");
    process.exit(2);
  }

  if (!prompt.includes("Reply exactly: ok")) {
    console.error("missing prompt text");
    process.exit(3);
  }

  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "ok"
    }
  }));
  console.log(JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 1,
      output_tokens: 1
    }
  }));
});
`
  );
  await chmod(binaryPath, 0o755);
  return {
    binaryPath,
    cleanup: () => rm(directory, { force: true, recursive: true })
  };
}

function assertThrowsStatus(fn, statusCode, messagePattern) {
  assert.throws(
    fn,
    (error) => {
      assert.equal(error.statusCode, statusCode);
      assert.match(error.message, messagePattern);
      return true;
    }
  );
}

const projectRoot = process.cwd();

const prompt = buildCodexPrompt({
  messages: [
    { role: "system", content: "System contract." },
    { role: "user", content: "Reply exactly: ok" }
  ],
  surface: "test"
});
assert.match(prompt, /local Codex CLI worker/u);
assert.match(prompt, /<message index="2" role="user">/u);
assert.match(prompt, /Reply exactly: ok/u);

assertThrowsStatus(
  () => post({
    body: {
      promptText: "Reply exactly: ok",
      sandbox: "danger-full-access",
      workspace: projectRoot
    },
    projectRoot
  }),
  403,
  /danger-full-access/u
);

assertThrowsStatus(
  () => post({
    body: {
      messages: [],
      sandbox: "read-only",
      workspace: projectRoot
    },
    projectRoot
  }),
  400,
  /empty/u
);

const fakeCodex = await createFakeCodexBinary();

try {
  const response = post({
    body: {
      codexPath: fakeCodex.binaryPath,
      messages: [
        { role: "system", content: "System contract." },
        { role: "user", content: "Reply exactly: ok" }
      ],
      sandbox: "read-only",
      surface: "test",
      workspace: projectRoot
    },
    projectRoot
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "text/event-stream; charset=utf-8");
  assert.deepEqual(response.stream.codexMeta.args.slice(0, 5), [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "-C"
  ]);
  assert.equal(response.stream.codexMeta.workspace, projectRoot);

  const output = await readStream(response.stream);
  assert.match(output, /"content":"ok"/u);
  assert.match(output, /"finish_reason":"stop"/u);
  assert.match(output, /data: \[DONE\]/u);
} finally {
  await fakeCodex.cleanup();
}

console.log("codex_cli_provider_test: ok");
