import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { EventStreamDecoder } from "./eventstream.js";
import { resolveBedrockCredentials, signBedrockRequest } from "./sigv4.js";

const DEFAULT_MAX_TOKENS = 4096;

function extractText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
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

function translateOpenAiMessages(openaiPayload) {
  const messages = Array.isArray(openaiPayload?.messages) ? openaiPayload.messages : [];
  const systemParts = [];
  const converseMessages = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const text = extractText(message.content);

    if (!text) {
      continue;
    }

    if (message.role === "system") {
      systemParts.push({ text });
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      converseMessages.push({
        role: message.role,
        content: [{ text }]
      });
    }
  }

  return { converseMessages, systemParts };
}

function modelRejectsTemperature(modelId) {
  const normalized = String(modelId || "").toLowerCase();
  if (!normalized.includes("anthropic")) return false;
  // Claude 4.5+ (sonnet/opus/haiku) deprecates temperature and top_p on
  // Bedrock Converse. Strip both for those models; pass through for everything else.
  return /claude-(opus-4-[6-9]|opus-4-[1-9]\d|sonnet-4-[6-9]|sonnet-4-[1-9]\d|haiku-4-[5-9]|haiku-4-[1-9]\d)/u.test(normalized);
}

function buildInferenceConfig(openaiPayload) {
  const config = {};
  const dropTempAndTopP = modelRejectsTemperature(openaiPayload?.model);

  const maxTokens = Number(openaiPayload?.max_tokens ?? openaiPayload?.max_completion_tokens);
  config.maxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS;

  const temperature = Number(openaiPayload?.temperature);
  if (!dropTempAndTopP && Number.isFinite(temperature)) {
    config.temperature = temperature;
  }

  const topP = Number(openaiPayload?.top_p);
  if (!dropTempAndTopP && Number.isFinite(topP)) {
    config.topP = topP;
  }

  const stopRaw = openaiPayload?.stop;
  const stopSequences = Array.isArray(stopRaw)
    ? stopRaw.filter((value) => typeof value === "string" && value.length)
    : typeof stopRaw === "string" && stopRaw.length
      ? [stopRaw]
      : [];

  if (stopSequences.length) {
    config.stopSequences = stopSequences;
  }

  return config;
}

function buildConverseBody(openaiPayload) {
  const { converseMessages, systemParts } = translateOpenAiMessages(openaiPayload);

  const body = {
    messages: converseMessages,
    inferenceConfig: buildInferenceConfig(openaiPayload)
  };

  if (systemParts.length) {
    body.system = systemParts;
  }

  return body;
}

function mapStopReason(reason) {
  if (!reason) {
    return "stop";
  }

  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "content_filtered":
      return "content_filter";
    default:
      return "stop";
  }
}

function formatOpenAiSseChunk({ content, created, finishReason, id, model }) {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: finishReason || null
      }
    ]
  };

  return `data: ${JSON.stringify(payload)}\n\n`;
}

function formatOpenAiCompletion({ created, finishReason, id, model, text, usage }) {
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        finish_reason: finishReason || "stop",
        message: {
          role: "assistant",
          content: text
        }
      }
    ],
    usage: usage || undefined
  };
}

async function executeSignedBedrockRequest({ body, method, path, region, streamResponse }) {
  const credentials = await resolveBedrockCredentials();
  const url = new URL(`https://bedrock-runtime.${region}.amazonaws.com${path}`);
  const bodyBuffer = Buffer.from(JSON.stringify(body), "utf8");

  const signed = signBedrockRequest({
    body: bodyBuffer,
    credentials,
    headers: {
      "content-type": "application/json",
      accept: streamResponse ? "application/vnd.amazon.eventstream" : "application/json"
    },
    method,
    region,
    url
  });

  const upstream = await fetch(url, {
    body: signed.body,
    headers: signed.headers,
    method
  });

  return upstream;
}

async function streamConverseToOpenAiSse(req, res, { openaiPayload, region }) {
  const modelId = String(openaiPayload?.model || "").trim();

  if (!modelId) {
    throw new Error("A Bedrock model ID is required (set the `model` field in the request body).");
  }

  const body = buildConverseBody(openaiPayload);
  const path = `/model/${encodeURIComponent(modelId)}/converse-stream`;

  const upstream = await executeSignedBedrockRequest({
    body,
    method: "POST",
    path,
    region,
    streamResponse: true
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    res.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          message: `Bedrock converse-stream failed (${upstream.status}): ${text}`,
          type: "bedrock_error"
        }
      })
    );
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = modelId;
  const decoder = new EventStreamDecoder();
  let finishReason = null;

  const nodeStream = Readable.fromWeb(upstream.body);

  await new Promise((resolve, reject) => {
    nodeStream.on("data", (chunk) => {
      try {
        const frames = decoder.push(chunk);

        for (const frame of frames) {
          const eventType = frame.headers?.[":event-type"];
          const messageType = frame.headers?.[":message-type"];

          if (messageType === "exception" || messageType === "error") {
            const errText = frame.payload.toString("utf8");
            res.write(formatOpenAiSseChunk({
              created,
              finishReason: "stop",
              id,
              model,
              content: `[Bedrock error] ${errText}`
            }));
            continue;
          }

          if (!frame.payload.length) {
            continue;
          }

          const event = JSON.parse(frame.payload.toString("utf8"));

          if (eventType === "contentBlockDelta") {
            const text = event?.delta?.text || "";
            if (text) {
              res.write(formatOpenAiSseChunk({ content: text, created, id, model }));
            }
          } else if (eventType === "messageStop") {
            finishReason = mapStopReason(event?.stopReason);
            res.write(formatOpenAiSseChunk({ created, finishReason, id, model }));
          }
        }
      } catch (error) {
        reject(error);
      }
    });

    nodeStream.on("error", reject);
    nodeStream.on("end", () => {
      if (!finishReason) {
        res.write(formatOpenAiSseChunk({ created, finishReason: "stop", id, model }));
      }
      res.write("data: [DONE]\n\n");
      res.end();
      resolve();
    });
  });
}

async function converseNonStreaming(res, { openaiPayload, region }) {
  const modelId = String(openaiPayload?.model || "").trim();

  if (!modelId) {
    throw new Error("A Bedrock model ID is required (set the `model` field in the request body).");
  }

  const body = buildConverseBody(openaiPayload);
  const path = `/model/${encodeURIComponent(modelId)}/converse`;

  const upstream = await executeSignedBedrockRequest({
    body,
    method: "POST",
    path,
    region,
    streamResponse: false
  });

  const rawText = await upstream.text();

  if (!upstream.ok) {
    res.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          message: `Bedrock converse failed (${upstream.status}): ${rawText}`,
          type: "bedrock_error"
        }
      })
    );
    return;
  }

  const parsed = JSON.parse(rawText);
  const text = (parsed?.output?.message?.content || [])
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .join("");

  const usage = parsed?.usage
    ? {
        prompt_tokens: parsed.usage.inputTokens ?? 0,
        completion_tokens: parsed.usage.outputTokens ?? 0,
        total_tokens: parsed.usage.totalTokens ?? 0
      }
    : undefined;

  const completion = formatOpenAiCompletion({
    created: Math.floor(Date.now() / 1000),
    finishReason: mapStopReason(parsed?.stopReason),
    id: `chatcmpl-${randomUUID()}`,
    model: modelId,
    text,
    usage
  });

  const responseBody = JSON.stringify(completion);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(responseBody)
  });
  res.end(responseBody);
}

export async function handleConverseOpenAiRequest(req, res, { openaiPayload, region }) {
  if (openaiPayload?.stream) {
    await streamConverseToOpenAiSse(req, res, { openaiPayload, region });
    return;
  }

  await converseNonStreaming(res, { openaiPayload, region });
}
