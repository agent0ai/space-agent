import { createCodexChatStream } from "../lib/codex_cli/service.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function resolveMessages(payload) {
  if (Array.isArray(payload.messages)) {
    return payload.messages;
  }

  if (Array.isArray(payload.requestBody?.messages)) {
    return payload.requestBody.messages;
  }

  if (Array.isArray(payload.preparedRequest?.requestBody?.messages)) {
    return payload.preparedRequest.requestBody.messages;
  }

  if (Array.isArray(payload.preparedRequest?.messages)) {
    return payload.preparedRequest.messages;
  }

  return [];
}

function resolveModel(payload) {
  return String(payload.codexModel || payload.model || payload.settings?.codexModel || "").trim();
}

export function post(context) {
  const payload = readPayload(context);
  const stream = createCodexChatStream({
    codexHome: payload.codexHome,
    codexPath: payload.codexPath,
    ephemeral: payload.ephemeral,
    messages: resolveMessages(payload),
    model: resolveModel(payload),
    projectRoot: context.projectRoot,
    promptText: payload.promptText,
    sandbox: payload.sandbox || payload.settings?.codexSandbox,
    skipGitRepoCheck: payload.skipGitRepoCheck,
    surface: payload.surface,
    timeoutMs: payload.timeoutMs,
    workspace: payload.workspace || payload.settings?.codexWorkspace
  });

  return {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no"
    },
    stream
  };
}
