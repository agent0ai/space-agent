import { DEFAULT_CHAT_SETTINGS } from "./storage.js";
import { buildMessageContentForApi } from "./attachments.js";
import { buildProxyUrl, isProxyableExternalUrl } from "/mod/_core/framework/proxy-url.js";
import { parseLlmParamsText } from "./llm-params.js";

function createHeaders(endpoint, apiKey) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (endpoint.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "Agent One";
  }

  return headers;
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

function extractStreamingDelta(payload) {
  const choice = payload.choices?.[0];
  if (!choice) {
    return "";
  }

  const delta = choice.delta || choice.message || {};
  return extractTextContent(delta.content || choice.text || "");
}

function extractNonStreamingMessage(payload) {
  const choice = payload.choices?.[0];
  if (!choice) {
    return "";
  }

  const message = choice.message || {};
  return extractTextContent(message.content || choice.text || "");
}

export function buildPromptMessages(systemPrompt, messages) {
  const requestMessages = [];
  const effectiveSystemPrompt = typeof systemPrompt === "string" ? systemPrompt.trim() : "";

  if (effectiveSystemPrompt.trim()) {
    requestMessages.push({
      role: "system",
      content: effectiveSystemPrompt.trim()
    });
  }

  messages.forEach((message) => {
    if (!["user", "assistant"].includes(message.role)) {
      return;
    }

    requestMessages.push({
      role: message.role,
      content: buildMessageContentForApi(message)
    });
  });

  return requestMessages;
}

function createRequestBody(settings, systemPrompt, messages) {
  const requestMessages = buildPromptMessages(systemPrompt, messages);
  const requestParams = parseLlmParamsText(settings.paramsText || "");

  return {
    ...requestParams,
    model: settings.model || DEFAULT_CHAT_SETTINGS.model,
    stream: true,
    messages: requestMessages
  };
}

function resolveChatRequestUrl(apiEndpoint) {
  if (!isProxyableExternalUrl(apiEndpoint)) {
    return apiEndpoint;
  }

  if (window.A1?.proxy?.buildUrl) {
    return window.A1.proxy.buildUrl(apiEndpoint);
  }

  return buildProxyUrl(apiEndpoint);
}

async function throwResponseError(response) {
  const contentType = response.headers.get("content-type") || "";
  let detail = "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      detail = payload.error?.message || payload.error || JSON.stringify(payload);
    } catch (error) {
      detail = "Unable to parse JSON error body.";
    }
  } else {
    detail = await response.text();
  }

  throw new Error(`Chat request failed with status ${response.status}: ${detail || response.statusText}`);
}

async function readStandardResponse(response, onDelta) {
  const payload = await response.json();
  const message = extractNonStreamingMessage(payload);

  if (message) {
    onDelta(message);
  }
}

function parseEventBlock(eventBlock, onDelta) {
  const lines = eventBlock.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const value = line.slice(5).trim();
    if (!value) {
      continue;
    }

    if (value === "[DONE]") {
      return true;
    }

    const payload = JSON.parse(value);
    const delta = extractStreamingDelta(payload);

    if (delta) {
      onDelta(delta);
    }
  }

  return false;
}

async function readStreamingResponse(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const eventBlock = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);

      if (eventBlock && parseEventBlock(eventBlock, onDelta)) {
        return;
      }

      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      const remaining = buffer.trim();
      if (remaining) {
        parseEventBlock(remaining, onDelta);
      }
      return;
    }
  }
}

export async function streamChatCompletion({ settings, systemPrompt, messages, onDelta }) {
  if (!settings.apiEndpoint.trim()) {
    throw new Error("Set an API endpoint before sending a message.");
  }

  if (!settings.apiKey.trim()) {
    throw new Error("Set an API key before sending a message.");
  }

  if (!settings.model.trim()) {
    throw new Error("Set a model before sending a message.");
  }

  const requestUrl = resolveChatRequestUrl(settings.apiEndpoint);

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: createHeaders(settings.apiEndpoint, settings.apiKey.trim()),
    body: JSON.stringify(createRequestBody(settings, systemPrompt, messages))
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    await readStandardResponse(response, onDelta);
    return;
  }

  if (!response.body) {
    throw new Error("Streaming response body is not available.");
  }

  await readStreamingResponse(response, onDelta);
}
