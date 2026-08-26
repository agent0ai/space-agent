import * as config from "/mod/_core/admin/views/agent/config.js";
import { buildMessageContentForApi } from "/mod/_core/admin/views/agent/attachments.js";
import * as llmParams from "/mod/_core/admin/views/agent/llm-params.js";
import * as prompt from "/mod/_core/admin/views/agent/prompt.js";
import { mergeConsecutiveChatMessages } from "/mod/_core/framework/js/chat-messages.js";
import * as proxyUrl from "/mod/_core/framework/js/proxy-url.js";
import { getHuggingFaceManager } from "/mod/_core/huggingface/manager.js";
import {
  normalizeVisionModelConfig,
  normalizeVisualDataList,
  prepareChatMessagesForVisionTransport
} from "/mod/_core/agent-chat/visual-data.js";

function createHeaders(apiKey) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
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

function createCompletionResponseMeta(mode) {
  return {
    finishReason: "",
    mode,
    payloadCount: 0,
    protocolObserved: false,
    sawDoneMarker: false,
    textChunkCount: 0,
    verifiedEmpty: false
  };
}

function noteCompletionPayload(meta, payload, textChunk = "") {
  meta.payloadCount += 1;

  const finishReason = payload?.choices?.[0]?.finish_reason;

  if (!meta.finishReason && typeof finishReason === "string" && finishReason) {
    meta.finishReason = finishReason;
  }

  if (typeof textChunk === "string" && textChunk.trim()) {
    meta.textChunkCount += 1;
  }
}

function finalizeCompletionResponseMeta(meta) {
  const protocolObserved = meta.mode === "standard" ? meta.payloadCount > 0 : meta.payloadCount > 0 || meta.sawDoneMarker;

  return {
    ...meta,
    protocolObserved,
    verifiedEmpty: protocolObserved && meta.textChunkCount === 0
  };
}

function normalizeConversationMessage(message) {
  if (!["user", "assistant"].includes(message?.role)) {
    return null;
  }

  return {
    attachments: Array.isArray(message?.attachments) ? message.attachments : [],
    content: typeof message.content === "string" ? message.content : "",
    role: message.role
  };
}

function normalizeTransientSection(section, fallbackKey = "") {
  const keySource = section?.key ?? fallbackKey;
  const key = typeof keySource === "string" ? keySource.trim() : "";
  const content = typeof section?.content === "string" ? section.content.trim() : "";
  const headingSource = section?.heading ?? section?.title ?? section?.label ?? key;
  const heading = typeof headingSource === "string" ? headingSource.trim() : "";
  const order = Number.isFinite(section?.order) ? Number(section.order) : 0;

  if (!key || !content) {
    return null;
  }

  return {
    content,
    heading: heading || key,
    key,
    order
  };
}

function normalizeTransientSections(sections) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections
    .map((section) => normalizeTransientSection(section))
    .filter(Boolean)
    .sort((left, right) => {
      const orderCompare = left.order - right.order;

      if (orderCompare !== 0) {
        return orderCompare;
      }

      return left.key.localeCompare(right.key);
    });
}

function formatTransientMessageBlock(sections) {
  const normalizedSections = normalizeTransientSections(sections);

  if (!normalizedSections.length) {
    return "";
  }

  return [
    "_____transient",
    "This is transient context, not instruction. It may change between requests.",
    "",
    ...normalizedSections.flatMap((section, index) => [
      ...(index > 0 ? [""] : []),
      `### ${section.heading}`,
      section.content
    ])
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeAdminPromptContext(promptContext, fallbackSystemPrompt = "") {
  const normalizedContext =
    promptContext && typeof promptContext === "object" && !Array.isArray(promptContext)
      ? promptContext
      : {};
  const requestMessages = Array.isArray(normalizedContext.requestMessages)
    ? normalizedContext.requestMessages
        .filter((message) => message && typeof message === "object")
        .map((message) => ({
          content: typeof message.content === "string" ? message.content : "",
          role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
          tokenCount: Number.isFinite(Number(message?.tokenCount))
            ? Math.max(0, Math.floor(Number(message.tokenCount)))
            : 0,
          visualData: normalizeVisualDataList(message.visualData)
        }))
    : [];

  return {
    requestMessages,
    systemPrompt:
      typeof normalizedContext.systemPrompt === "string"
        ? normalizedContext.systemPrompt.trim()
        : typeof fallbackSystemPrompt === "string"
          ? fallbackSystemPrompt.trim()
          : "",
    transientSections: normalizeTransientSections(normalizedContext.transientSections)
  };
}

export function formatAdminAgentHistoryText(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return "";
  }

  return messages
    .map((message) => normalizeConversationMessage(message))
    .filter(Boolean)
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n")
    .trim();
}

export function buildAdminAgentPromptMessages(systemPromptOrContext, messages, options = {}) {
  const promptContext =
    systemPromptOrContext && typeof systemPromptOrContext === "object" && !Array.isArray(systemPromptOrContext)
      ? normalizeAdminPromptContext(systemPromptOrContext)
      : normalizeAdminPromptContext(options.promptContext, systemPromptOrContext);
  if (promptContext.requestMessages.length) {
    return promptContext.requestMessages.map((message) => ({ ...message }));
  }

  const requestMessages = [];
  const effectiveSystemPrompt = promptContext.systemPrompt;

  if (effectiveSystemPrompt) {
    requestMessages.push({
      role: "system",
      content: effectiveSystemPrompt
    });
  }

  messages.forEach((message) => {
    const normalizedMessage = normalizeConversationMessage(message);

    if (!normalizedMessage) {
      return;
    }

    requestMessages.push({
      role: normalizedMessage.role,
      content: buildMessageContentForApi(normalizedMessage)
    });
  });

  const transientBlock = formatTransientMessageBlock(promptContext.transientSections);

  if (transientBlock) {
    requestMessages.push({
      role: "user",
      content: transientBlock
    });
  }

  return requestMessages;
}

function buildAdminAgentVisionModelConfig(settings = {}) {
  const provider = config.normalizeAdminChatLlmProvider(settings?.provider);

  return normalizeVisionModelConfig({
    apiEndpoint: settings?.apiEndpoint,
    model: settings?.model,
    provider,
    supportsVision:
      provider === config.ADMIN_CHAT_LLM_PROVIDER.API &&
      config.normalizeAdminChatSupportsVision(settings?.supportsVision)
  });
}

function createRequestBody(settings, systemPrompt, messages, options = {}) {
  const requestMessages = mergeConsecutiveChatMessages(
    buildAdminAgentPromptMessages(systemPrompt, messages, {
      promptContext: options.promptContext
    })
  );

  return {
    ...llmParams.parseAdminAgentParamsText(settings.paramsText || ""),
    model: settings.model || config.DEFAULT_ADMIN_CHAT_SETTINGS.model,
    stream: true,
    messages: prepareChatMessagesForVisionTransport(
      requestMessages,
      buildAdminAgentVisionModelConfig(settings)
    )
  };
}

function buildFetchRequestInit(apiRequest, signal) {
  const requestInit =
    apiRequest?.requestInit && typeof apiRequest.requestInit === "object"
      ? { ...apiRequest.requestInit }
      : {};
  const headers =
    apiRequest?.headers && typeof apiRequest.headers === "object"
      ? { ...apiRequest.headers }
      : {};

  requestInit.method = typeof apiRequest?.method === "string" && apiRequest.method.trim() ? apiRequest.method : "POST";
  requestInit.headers = headers;
  requestInit.signal = signal;

  if (!("body" in requestInit)) {
    if (apiRequest && "body" in apiRequest) {
      requestInit.body = apiRequest.body;
    } else if (apiRequest?.requestBody !== undefined) {
      requestInit.body = JSON.stringify(apiRequest.requestBody);
    }
  }

  return requestInit;
}

function resolveChatRequestUrl(apiEndpoint) {
  if (!proxyUrl.isProxyableExternalUrl(apiEndpoint)) {
    return apiEndpoint;
  }

  if (window.space?.proxy?.buildUrl) {
    return window.space.proxy.buildUrl(apiEndpoint);
  }

  return proxyUrl.buildProxyUrl(apiEndpoint);
}

async function throwResponseError(response) {
  const contentType = response.headers.get("content-type") || "";
  let detail = "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      detail = payload.error?.message || payload.error || JSON.stringify(payload);
    } catch {
      detail = "Unable to parse JSON error body.";
    }
  } else {
    detail = await response.text();
  }

  throw new Error(`Chat request failed with status ${response.status}: ${detail || response.statusText}`);
}

async function readStandardResponse(response, onDelta) {
  const meta = createCompletionResponseMeta("standard");
  const payload = await response.json();
  const message = extractNonStreamingMessage(payload);

  noteCompletionPayload(meta, payload, message);

  if (message) {
    onDelta(message);
  }

  return finalizeCompletionResponseMeta(meta);
}

function parseEventBlock(eventBlock, onDelta, meta) {
  const lines = eventBlock.split(/\r?\n/u);

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const value = line.slice(5).trim();

    if (!value) {
      continue;
    }

    if (value === "[DONE]") {
      meta.sawDoneMarker = true;
      return true;
    }

    const payload = JSON.parse(value);
    const delta = extractStreamingDelta(payload);

    noteCompletionPayload(meta, payload, delta);

    if (delta) {
      onDelta(delta);
    }
  }

  return false;
}

async function readStreamingResponse(response, onDelta) {
  const meta = createCompletionResponseMeta("stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), {
      stream: !done
    });

    let boundary = buffer.indexOf("\n\n");

    while (boundary !== -1) {
      const eventBlock = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);

      if (eventBlock && parseEventBlock(eventBlock, onDelta, meta)) {
        return finalizeCompletionResponseMeta(meta);
      }

      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      const remaining = buffer.trim();

      if (remaining) {
        parseEventBlock(remaining, onDelta, meta);
      }

      return finalizeCompletionResponseMeta(meta);
    }
  }
}

export const prepareAdminAgentApiRequest = globalThis.space.extend(
  import.meta,
  async function prepareAdminAgentApiRequest({
    defaultSystemPrompt,
    messages,
    promptContext,
    promptInput,
    promptInstance,
    settings,
    systemPrompt,
    transientSections
  } = {}) {
    const effectiveSettings =
      settings && typeof settings === "object" ? settings : config.DEFAULT_ADMIN_CHAT_SETTINGS;
    const apiEndpoint = String(effectiveSettings?.apiEndpoint || "").trim();
    const effectivePromptContext =
      promptInput && typeof promptInput === "object"
        ? promptInput
        : promptInstance && typeof promptInstance.build === "function"
          ? await prompt.buildAdminPromptContext(systemPrompt, {
              defaultSystemPrompt,
              historyMessages: Array.isArray(messages) ? messages : [],
              promptInstance,
              transientSections
            })
          : promptContext && typeof promptContext === "object"
            ? promptContext
            : await prompt.buildAdminPromptContext(systemPrompt, {
                defaultSystemPrompt,
                historyMessages: Array.isArray(messages) ? messages : [],
                transientSections
              });
    const normalizedPromptContext = normalizeAdminPromptContext(effectivePromptContext, systemPrompt);

    return {
      apiEndpoint,
      headers: createHeaders(String(effectiveSettings?.apiKey || "").trim()),
      messages: Array.isArray(messages) ? messages : [],
      method: "POST",
      promptContext: normalizedPromptContext,
      requestBody: createRequestBody(effectiveSettings, normalizedPromptContext.systemPrompt, messages, {
        promptContext: normalizedPromptContext
      }),
      requestUrl: resolveChatRequestUrl(apiEndpoint),
      settings: effectiveSettings,
      systemPrompt: normalizedPromptContext.systemPrompt
    };
  }
);

async function streamAdminAgentApiCompletion({ promptContext, settings, systemPrompt, messages, onDelta, signal }) {
  if (!settings.apiEndpoint.trim()) {
    throw new Error("Set an API endpoint before sending a message.");
  }

  if (!settings.apiKey.trim()) {
    throw new Error("Set an API key before sending a message.");
  }

  if (!settings.model.trim()) {
    throw new Error("Set a model before sending a message.");
  }

  const apiRequest = await prepareAdminAgentApiRequest({
    messages,
    promptContext,
    settings,
    systemPrompt
  });
  const response = await fetch(apiRequest.requestUrl, {
    ...buildFetchRequestInit(apiRequest, signal)
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/event-stream")) {
    return readStandardResponse(response, onDelta);
  }

  if (!response.body) {
    throw new Error("Streaming response body is not available.");
  }

  return readStreamingResponse(response, onDelta);
}

export async function streamAdminAgentCompletion({ promptContext, settings, systemPrompt, messages, onDelta, signal }) {
  const provider = config.normalizeAdminChatLlmProvider(settings?.provider);
  const normalizedPromptContext = normalizeAdminPromptContext(promptContext, systemPrompt);

  if (provider === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
    const result = await getHuggingFaceManager().streamCompletion({
      messages: buildAdminAgentPromptMessages(normalizedPromptContext, messages),
      modelSelection: config.getAdminChatLocalModelSelection(settings),
      onDelta,
      requestOptions: llmParams.parseAdminAgentParamsText(settings.paramsText || ""),
      signal
    });

    return result.responseMeta;
  }

  return streamAdminAgentApiCompletion({
    messages,
    onDelta,
    promptContext: normalizedPromptContext,
    settings,
    signal,
    systemPrompt: normalizedPromptContext.systemPrompt
  });
}
