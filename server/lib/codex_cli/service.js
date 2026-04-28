import { spawn } from "node:child_process";
import path from "node:path";
import { PassThrough } from "node:stream";

import { buildCodexPrompt } from "./prompt_format.js";

const DEFAULT_CODEX_HOME = "/Users/nutic/.codex";
const DEFAULT_CODEX_BINARY = "/Users/nutic/bin/codex-run";
const DEFAULT_WORKSPACE = "/Users/nutic/Workspaces/repos/space-agent";
const HERMES_SPACE_AGENT_WORKSPACE = "/Users/nutic/Hermes/space-agent";
const STDERR_LIMIT_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function createHttpError(message, statusCode = 500) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

function redactDiagnosticText(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*['"]?[^'"\s]+/giu, "$1=[redacted]");
}

function appendBounded(buffer, value, limit = STDERR_LIMIT_BYTES) {
  const next = `${buffer}${value}`;

  if (Buffer.byteLength(next) <= limit) {
    return next;
  }

  return next.slice(Math.max(0, next.length - limit));
}

function resolveRealPath(candidate) {
  return path.resolve(String(candidate || ""));
}

function isSameOrInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveAllowedWorkspaces(projectRoot) {
  return [...new Set([
    resolveRealPath(projectRoot || DEFAULT_WORKSPACE),
    DEFAULT_WORKSPACE,
    HERMES_SPACE_AGENT_WORKSPACE
  ].map(resolveRealPath))];
}

function resolveWorkspace(workspace, projectRoot) {
  const resolvedWorkspace = resolveRealPath(workspace || projectRoot || DEFAULT_WORKSPACE);
  const allowedWorkspaces = resolveAllowedWorkspaces(projectRoot);

  if (!allowedWorkspaces.some((allowedWorkspace) => isSameOrInside(resolvedWorkspace, allowedWorkspace))) {
    throw createHttpError("Codex workspace is not allowed.", 403);
  }

  return resolvedWorkspace;
}

function resolveSandbox(value) {
  const sandbox = normalizeText(value || "read-only");

  if (sandbox === "read-only" || sandbox === "workspace-write") {
    return sandbox;
  }

  if (sandbox === "danger-full-access") {
    throw createHttpError("Codex CLI provider does not allow danger-full-access.", 403);
  }

  throw createHttpError("Unsupported Codex sandbox mode.", 400);
}

function resolveCodexBinary(value) {
  return normalizeText(value || process.env.SPACE_CODEX_BINARY || DEFAULT_CODEX_BINARY) || "codex";
}

function parseCodexErrorMessage(message) {
  const rawMessage = normalizeText(message);

  if (!rawMessage) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawMessage);
    return normalizeText(parsed?.error?.message || parsed?.message || rawMessage);
  } catch {
    return rawMessage;
  }
}

function createSseData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function createContentChunk(content) {
  return {
    choices: [
      {
        delta: { content },
        finish_reason: null,
        index: 0
      }
    ]
  };
}

function createStopChunk(usage) {
  return {
    choices: [
      {
        delta: {},
        finish_reason: "stop",
        index: 0
      }
    ],
    ...(usage && typeof usage === "object" ? { usage } : {})
  };
}

function createErrorChunk(message) {
  return {
    error: {
      message: redactDiagnosticText(message || "Codex CLI request failed."),
      type: "codex_exec_failed"
    }
  };
}

function writeSse(stream, payload) {
  stream.write(createSseData(payload));
}

function finishSse(stream) {
  stream.write("data: [DONE]\n\n");
  stream.end();
}

function buildCodexArgs({ ephemeral, model, sandbox, skipGitRepoCheck, workspace }) {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    sandbox,
    "-C",
    workspace
  ];

  if (ephemeral) {
    args.push("--ephemeral");
  }

  if (skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  const normalizedModel = normalizeText(model);

  if (normalizedModel) {
    args.push("-m", normalizedModel);
  }

  args.push("-");
  return args;
}

export function createCodexChatStream(options = {}) {
  const stream = new PassThrough();
  const workspace = resolveWorkspace(options.workspace, options.projectRoot);
  const sandbox = resolveSandbox(options.sandbox);
  const prompt = buildCodexPrompt({
    messages: options.messages,
    promptText: options.promptText,
    surface: options.surface
  });
  const codexPath = resolveCodexBinary(options.codexPath);
  const args = buildCodexArgs({
    ephemeral: normalizeBoolean(options.ephemeral, true),
    model: options.model,
    sandbox,
    skipGitRepoCheck: normalizeBoolean(options.skipGitRepoCheck, true),
    workspace
  });
  const env = {
    ...process.env,
    CODEX_HOME: normalizeText(options.codexHome || process.env.CODEX_HOME || DEFAULT_CODEX_HOME)
  };
  const child = spawn(codexPath, args, {
    cwd: workspace,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalText = "";
  let sawTerminalEvent = false;
  let failureMessage = "";
  let settled = false;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1_000, Number(options.timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    failureMessage = `Codex CLI request timed out after ${timeoutMs} ms.`;
    child.kill("SIGTERM");
  }, timeoutMs);

  const settleFailure = (message) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timeout);
    writeSse(stream, createErrorChunk(message));
    finishSse(stream);
  };

  const settleSuccess = (usage) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timeout);
    writeSse(stream, createStopChunk(usage));
    finishSse(stream);
  };

  const handleEvent = (event) => {
    if (!event || typeof event !== "object") {
      return;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      const text = typeof event.item.text === "string" ? event.item.text : "";

      if (text) {
        finalText += text;
        writeSse(stream, createContentChunk(text));
      }

      return;
    }

    if (event.type === "error") {
      failureMessage = parseCodexErrorMessage(event.message) || failureMessage;
      return;
    }

    if (event.type === "turn.failed") {
      sawTerminalEvent = true;
      failureMessage =
        parseCodexErrorMessage(event.error?.message) ||
        failureMessage ||
        "Codex CLI turn failed.";
      settleFailure(failureMessage);
      return;
    }

    if (event.type === "turn.completed") {
      sawTerminalEvent = true;
      settleSuccess(event.usage);
    }
  };

  const consumeStdoutLine = (line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    try {
      handleEvent(JSON.parse(trimmedLine));
    } catch (error) {
      failureMessage = `Invalid Codex JSONL event: ${error.message}`;
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newlineIndex = stdoutBuffer.indexOf("\n");

    while (newlineIndex !== -1) {
      consumeStdoutLine(stdoutBuffer.slice(0, newlineIndex));
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer = appendBounded(stderrBuffer, chunk);
  });

  child.once("error", (error) => {
    settleFailure(`Unable to start Codex CLI: ${error.message}`);
  });

  child.once("close", (code, signal) => {
    clearTimeout(timeout);

    if (settled) {
      return;
    }

    if (stdoutBuffer.trim()) {
      consumeStdoutLine(stdoutBuffer);
    }

    if (settled) {
      return;
    }

    if (code === 0) {
      if (!sawTerminalEvent) {
        settleSuccess({
          warning: "codex exited without turn.completed"
        });
      }
      return;
    }

    const detail = failureMessage || stderrBuffer || `Codex CLI exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
    settleFailure(detail);
  });

  stream.once("close", () => {
    clearTimeout(timeout);

    if (!settled && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  });

  child.stdin.end(prompt);

  stream.codexMeta = {
    args,
    codexPath,
    getFinalText: () => finalText,
    workspace
  };

  return stream;
}
