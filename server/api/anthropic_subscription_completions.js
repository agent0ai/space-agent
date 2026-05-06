// POST /api/anthropic_subscription_completions
//
// Authenticated chat-completion endpoint backed by the user's Claude
// subscription OAuth tokens. The frontend sends an OpenAI chat-completions
// shape; this handler:
//
//   - validates the session
//   - loads (and refreshes if needed) the user's encrypted Anthropic
//     access token
//   - translates the OpenAI request body into the Anthropic Messages API
//     shape
//   - calls https://api.anthropic.com/v1/messages with the OAuth bearer
//     token and the required `anthropic-beta` and `anthropic-version`
//     headers
//   - translates the Anthropic event-stream back into OpenAI
//     chat-completion stream chunks so the existing browser fetch reader
//     in admin/views/agent/api.js and onscreen_agent/api.js does not need
//     to change
//
// All OAuth-specific concerns are isolated here. The shared fetch proxy
// is intentionally not modified, so its public contract stays narrow.

import { getActiveAccessToken } from "../lib/auth/anthropic_oauth.js";
import { applyApiCorsHeaders } from "../router/cors.js";

const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20";
const ANTHROPIC_VERSION_HEADER = "2023-06-01";
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;

// The Claude subscription OAuth beta requires the system prompt to begin
// with the Claude Code identifier so the upstream can verify requests are
// coming from a Claude Code-shaped client. We inject the required prefix
// as the first element of the Anthropic `system` array and keep the
// caller's actual system prompt as a separate text block, so user-authored
// system instructions remain visible to the model.
const ANTHROPIC_OAUTH_CLAUDE_CODE_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isAnthropicOauthAllowed(runtimeParams) {
  return Boolean(
    runtimeParams && typeof runtimeParams.get === "function" && runtimeParams.get("ANTHROPIC_OAUTH_ALLOWED", true)
  );
}

function getAnthropicApiBaseUrl(runtimeParams) {
  if (!runtimeParams || typeof runtimeParams.get !== "function") {
    return "https://api.anthropic.com";
  }
  const value = String(runtimeParams.get("ANTHROPIC_API_BASE_URL") || "").trim();
  return value || "https://api.anthropic.com";
}

function extractTextContent(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");
}

function buildAnthropicMessages(openaiMessages = []) {
  const systemTexts = [];
  const messages = [];

  for (const raw of Array.isArray(openaiMessages) ? openaiMessages : []) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const role = raw.role;
    const text = extractTextContent(raw.content || "");
    if (role === "system") {
      if (text.trim()) {
        systemTexts.push(text);
      }
      continue;
    }
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    if (!text.trim() && role === "user") {
      continue;
    }
    messages.push({
      role,
      content: [
        {
          type: "text",
          text
        }
      ]
    });
  }

  // Anthropic requires the conversation to start with a user turn. If the
  // first turn is an assistant message (e.g. resuming a saved thread),
  // prepend an empty user turn so the upstream accepts the request.
  if (messages.length === 0) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: "" }]
    });
  } else if (messages[0].role !== "user") {
    messages.unshift({
      role: "user",
      content: [{ type: "text", text: "" }]
    });
  }

  return {
    messages,
    systemTexts
  };
}

function buildAnthropicRequestBody({ openaiBody, settings }) {
  const { messages, systemTexts } = buildAnthropicMessages(openaiBody?.messages);

  const anthropicBody = {
    model: String(openaiBody?.model || "").trim() || "claude-sonnet-4-6",
    max_tokens:
      Number.isFinite(Number(openaiBody?.max_tokens)) && Number(openaiBody.max_tokens) > 0
        ? Number(openaiBody.max_tokens)
        : ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages,
    stream: true,
    system: [
      { type: "text", text: ANTHROPIC_OAUTH_CLAUDE_CODE_PREFIX },
      ...systemTexts.map((text) => ({ type: "text", text }))
    ]
  };

  // Note on sampling parameters: the Claude subscription OAuth endpoint
  // is intentionally opinionated about sampling. Newer models (e.g. Opus
  // 4.7 onward) reject `temperature` and `top_p` outright with
  // "`temperature` is deprecated for this model". Older models still
  // accept them but the subscription tier picks tuned defaults that the
  // user's settings would only override when they have an opinion. Since
  // the subscription UI deliberately hides the params field, never
  // forward `temperature`, `top_p`, or `stop_sequences` on this code
  // path — the API-key provider remains the place to tune sampling.

  return anthropicBody;
}

function mapAnthropicStopReason(stopReason) {
  if (typeof stopReason !== "string") {
    return null;
  }
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return stopReason;
  }
}

function encodeOpenaiSseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function buildOpenaiTextChunk({ id, model, text }) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: null
      }
    ]
  };
}

function buildOpenaiFinishChunk({ id, model, finishReason }) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason || "stop"
      }
    ]
  };
}

function readSseEventBlocks(reader, decoder, buffer) {
  const events = [];
  let updatedBuffer = buffer;
  let boundary = updatedBuffer.indexOf("\n\n");
  while (boundary !== -1) {
    const eventBlock = updatedBuffer.slice(0, boundary).trim();
    updatedBuffer = updatedBuffer.slice(boundary + 2);
    if (eventBlock) {
      events.push(eventBlock);
    }
    boundary = updatedBuffer.indexOf("\n\n");
  }
  return { events, updatedBuffer };
}

function parseAnthropicEventBlock(eventBlock) {
  const lines = eventBlock.split(/\r?\n/u);
  let dataText = "";
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const value = line.slice(5).trim();
      if (value) {
        dataText += dataText ? `\n${value}` : value;
      }
    }
  }
  if (!dataText) {
    return null;
  }
  try {
    return JSON.parse(dataText);
  } catch {
    return null;
  }
}

async function pipeAnthropicStreamAsOpenai({ res, upstreamResponse, model }) {
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason = "stop";

  res.write(encodeOpenaiSseChunk({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]
  }));

  const reader = upstreamResponse.body.getReader();
  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const { events, updatedBuffer } = readSseEventBlocks(reader, decoder, buffer);
    buffer = updatedBuffer;

    for (const eventBlock of events) {
      const payload = parseAnthropicEventBlock(eventBlock);
      if (!payload || typeof payload !== "object") {
        continue;
      }
      if (payload.type === "content_block_delta") {
        const deltaText =
          payload?.delta?.type === "text_delta" && typeof payload.delta.text === "string"
            ? payload.delta.text
            : "";
        if (deltaText) {
          res.write(encodeOpenaiSseChunk(buildOpenaiTextChunk({ id, model, text: deltaText })));
        }
      } else if (payload.type === "message_delta") {
        const mapped = mapAnthropicStopReason(payload?.delta?.stop_reason);
        if (mapped) {
          finishReason = mapped;
        }
      } else if (payload.type === "message_stop") {
        // emitted below as a single finish chunk plus [DONE]
      } else if (payload.type === "error") {
        const message =
          payload?.error?.message || payload?.message || "Anthropic stream error.";
        res.write(encodeOpenaiSseChunk({
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: { content: `\n[anthropic-stream-error] ${message}` },
              finish_reason: "stop"
            }
          ]
        }));
      }
    }
  }

  res.write(encodeOpenaiSseChunk(buildOpenaiFinishChunk({ id, model, finishReason })));
  res.write("data: [DONE]\n\n");
  res.end();
}

async function callAnthropicMessages({ accessToken, runtimeParams, requestBody }) {
  const baseUrl = getAnthropicApiBaseUrl(runtimeParams).replace(/\/+$/u, "");
  const upstreamUrl = `${baseUrl}/v1/messages`;

  return fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "anthropic-beta": ANTHROPIC_BETA_HEADER,
      "anthropic-version": ANTHROPIC_VERSION_HEADER,
      "content-type": "application/json",
      "accept": "text/event-stream"
    },
    body: JSON.stringify(requestBody)
  });
}

async function readJsonError(response) {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object"
      ? payload?.error?.message || payload?.error || JSON.stringify(payload)
      : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function streamAnthropicSubscriptionCompletion({ context, requestBody, accessToken }) {
  const upstreamResponse = await callAnthropicMessages({
    accessToken,
    runtimeParams: context.runtimeParams,
    requestBody
  });

  if (!upstreamResponse.ok) {
    const detail = await readJsonError(upstreamResponse);
    if (upstreamResponse.status === 401) {
      // try one refresh + retry
      const refreshed = await getActiveAccessToken({
        force: true,
        projectRoot: context.projectRoot,
        runtimeParams: context.runtimeParams,
        username: context.user.username
      });
      if (refreshed.accessToken) {
        const retryResponse = await callAnthropicMessages({
          accessToken: refreshed.accessToken,
          runtimeParams: context.runtimeParams,
          requestBody
        });
        if (retryResponse.ok) {
          return retryResponse;
        }
        const retryDetail = await readJsonError(retryResponse);
        throw createHttpError(`Claude subscription request failed: ${retryDetail}`, retryResponse.status);
      }
    }
    throw createHttpError(`Claude subscription request failed: ${detail}`, upstreamResponse.status);
  }

  return upstreamResponse;
}

export async function post(context) {
  if (!context?.user?.isAuthenticated) {
    throw createHttpError("Authentication required.", 401);
  }
  if (!isAnthropicOauthAllowed(context.runtimeParams)) {
    throw createHttpError("Claude subscription provider is disabled in this system.", 403);
  }

  const username = String(context.user.username || "").trim();
  if (!username) {
    throw createHttpError("Authentication required.", 401);
  }

  const { accessToken, record } = await getActiveAccessToken({
    projectRoot: context.projectRoot,
    runtimeParams: context.runtimeParams,
    username
  });

  if (!accessToken) {
    throw createHttpError(
      record
        ? "Claude subscription token could not be refreshed. Reconnect your Claude account."
        : "Connect your Claude subscription before sending a message.",
      401
    );
  }

  const openaiBody =
    context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
      ? context.body
      : {};
  const requestBody = buildAnthropicRequestBody({
    openaiBody,
    settings: openaiBody
  });

  const res = context.res;
  if (!res || typeof res.writeHead !== "function") {
    throw createHttpError("Streaming response is not supported on this transport.", 500);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await streamAnthropicSubscriptionCompletion({
      context,
      requestBody,
      accessToken
    });
  } catch (error) {
    if (Number.isFinite(error?.statusCode)) {
      throw error;
    }
    throw createHttpError(error?.message || "Claude subscription request failed.", 502);
  }

  applyApiCorsHeaders(res);
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8"
  });

  try {
    await pipeAnthropicStreamAsOpenai({
      res,
      upstreamResponse,
      model: requestBody.model
    });
  } catch (error) {
    if (!res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: `\n[anthropic-stream-error] ${error?.message || "stream failed"}` },
              finish_reason: "stop"
            }
          ]
        })}\n\n`);
        res.write("data: [DONE]\n\n");
      } catch {
        // fall through to end()
      }
      res.end();
    }
  }

  return undefined;
}
