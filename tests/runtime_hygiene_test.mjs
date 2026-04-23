import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createProcessedConversationMessage,
  normalizeAssistantEvaluation,
  resolveProcessedConversationMessage
} from "../app/L0/_all/mod/_core/agent-chat/runtime-hygiene.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

function createMessage(role, content, options = {}) {
  return {
    attachments: Array.isArray(options.attachments) ? options.attachments.slice() : [],
    content,
    id: options.id || `${role}-1`,
    kind: typeof options.kind === "string" ? options.kind : "",
    role
  };
}

test("normalizeAssistantEvaluation sanitizes logs and preserves runtime context", () => {
  const store = { id: "store-1" };
  const history = [
    createMessage("assistant", "first", { id: "assistant-1" })
  ];
  const evaluation = normalizeAssistantEvaluation({
    assistantContent: "Checking now...",
    history,
    logs: [
      { level: "warn", text: "keep this" },
      { level: "nope", text: "fallback level" },
      { level: "info", text: "   " }
    ],
    messageId: "assistant-2",
    store
  });

  assert.deepEqual(evaluation.history, history);
  assert.notEqual(evaluation.history, history);
  assert.notEqual(evaluation.history[0], history[0]);
  assert.deepEqual(evaluation.logs, [
    { level: "warn", text: "keep this" },
    { level: "log", text: "fallback level" }
  ]);
  assert.equal(evaluation.messageId, "assistant-2");
  assert.equal(evaluation.store, store);
});

test("resolveProcessedConversationMessage isolates hook mutations from original history and message", async () => {
  const originalHistory = [
    createMessage("user", "alpha", { id: "user-1" })
  ];
  const originalMessage = createMessage("user", "beta", { id: "user-2", kind: "submit" });

  const processedMessage = await resolveProcessedConversationMessage({
    history: originalHistory,
    message: originalMessage,
    phase: "submit",
    processMessage: async (context) => {
      context.history[0].content = "mutated history copy";
      context.message.content = "mutated message copy";
      return {
        ...context,
        message: {
          ...context.message,
          kind: "processed",
          meta: "kept"
        }
      };
    }
  });

  assert.equal(originalHistory[0].content, "alpha");
  assert.equal(originalMessage.content, "beta");
  assert.deepEqual(processedMessage.attachments, []);
  assert.equal(processedMessage.content, "mutated message copy");
  assert.equal(processedMessage.kind, "processed");
  assert.equal(processedMessage.meta, "kept");
});

test("createProcessedConversationMessage creates message then routes through processing hook", async () => {
  const processedMessage = await createProcessedConversationMessage({
    content: "execution result",
    context: {
      executionResults: [{ status: "success" }],
      phase: "execution-output"
    },
    createMessage,
    options: {
      kind: "execution-output"
    },
    processMessage: async (context) => ({
      ...context,
      message: {
        ...context.message,
        content: `${context.message.content}\n\n[hygiene ok]`
      }
    }),
    role: "user"
  });

  assert.equal(processedMessage.role, "user");
  assert.equal(processedMessage.kind, "execution-output");
  assert.match(processedMessage.content, /\[hygiene ok\]/u);
});

test("admin agent store exposes runtime hygiene seam for processed history messages", async () => {
  const storePath = path.join(ROOT_DIR, "app/L0/_all/mod/_core/admin/views/agent/store.js");
  const storeSource = await fs.readFile(storePath, "utf8");

  assert.match(storeSource, /processAdminAgentMessage/u);
  assert.match(storeSource, /createProcessedConversationMessage\(/u);
  assert.match(storeSource, /normalizeAssistantEvaluation\(context\)/u);
  assert.match(storeSource, /resolveProcessedConversationMessage\(/u);
  assert.match(storeSource, /phase: "assistant-response"/u);
  assert.match(storeSource, /phase: "history-compact"/u);
  assert.match(storeSource, /phase: "execution-output"/u);
  assert.match(storeSource, /phase: "submit"/u);
  assert.match(storeSource, /async consumeNextQueuedSubmissionMessage\(/u);
});
