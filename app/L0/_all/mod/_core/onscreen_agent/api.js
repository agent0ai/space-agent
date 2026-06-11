import * as config from "/mod/_core/onscreen_agent/config.js";
import * as llmParams from "/mod/_core/onscreen_agent/llm-params.js";
import { prepareOnscreenAgentCompletionRequest } from "/mod/_core/onscreen_agent/llm.js";
import { getHuggingFaceManager } from "/mod/_core/huggingface/manager.js";
import { CODEX_RESPONSES_ENDPOINT, applyCodexHeaders } from "/mod/_core/openai_codex/request.js";
import { chatToResponsesRequest } from "/mod/_core/openai_codex/request_shape.js";
import {
  CODEX_STREAM_DONE_MARKER,
  mapCodexEventToChatFrames
} from "/mod/_core/openai_codex/sse_adapter.js";

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

function parseCodexEventBlock(eventBlock, onDelta, meta) {
  const lines = eventBlock.split(/\r?\n/u);

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const value = line.slice(5).trim();

    if (!value) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(value);
    } catch {
      continue;
    }

    // `mapCodexEventToChatFrames` throws on response.failed / error events,
    // which bubbles up to the caller as a request failure. That is the
    // intended behavior for terminal upstream errors mid-stream.
    const frames = mapCodexEventToChatFrames(event);

    for (const frame of frames) {
      if (frame === CODEX_STREAM_DONE_MARKER) {
        meta.sawDoneMarker = true;
        return true;
      }

      const delta = extractStreamingDelta(frame);
      noteCompletionPayload(meta, frame, delta);

      if (delta) {
        onDelta(delta);
      }
    }
  }

  return false;
}

async function readCodexStreamingResponse(response, onDelta) {
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

      if (eventBlock && parseCodexEventBlock(eventBlock, onDelta, meta)) {
        return finalizeCompletionResponseMeta(meta);
      }

      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      const remaining = buffer.trim();

      if (remaining) {
        parseCodexEventBlock(remaining, onDelta, meta);
      }

      return finalizeCompletionResponseMeta(meta);
    }
  }
}

function normalizeCompletionMessagesForLocal(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role =
        message?.role === "system"
          ? "system"
          : message?.role === "assistant"
            ? "assistant"
            : message?.role === "user"
              ? "user"
              : "";
      const content = extractTextContent(message?.content || "");

      if (!role || !content.trim()) {
        return null;
      }

      return {
        content,
        role
      };
    })
    .filter(Boolean);
}

function createApiRequestHeaders(apiKey) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function createApiRequestBody(settings, preparedRequest) {
  if (preparedRequest?.requestBody && typeof preparedRequest.requestBody === "object") {
    return {
      ...preparedRequest.requestBody
    };
  }

  const requestMessages = Array.isArray(preparedRequest?.messages) ? preparedRequest.messages : [];

  return {
    ...llmParams.parseOnscreenAgentParamsText(settings?.paramsText || ""),
    model: settings?.model || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.model,
    stream: true,
    messages: requestMessages
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

export class OnscreenAgentLlmClient {
  constructor(options = {}) {
    this.settings =
      options.settings && typeof options.settings === "object"
        ? options.settings
        : config.DEFAULT_ONSCREEN_AGENT_SETTINGS;
  }

  async resolvePreparedRequest(options = {}) {
    if (options.preparedRequest && typeof options.preparedRequest === "object") {
      return options.preparedRequest;
    }

    const promptOptions =
      options.promptOptions && typeof options.promptOptions === "object"
        ? options.promptOptions
        : {};

    return prepareOnscreenAgentCompletionRequest({
      messages: options.messages,
      options: promptOptions,
      promptInput: options.promptInput,
      settings: this.settings,
      systemPrompt: options.systemPrompt
    });
  }

  async streamCompletion() {
    throw new Error("LLM client subclasses must implement streamCompletion().");
  }
}

export class OnscreenAgentApiLlmClient extends OnscreenAgentLlmClient {
  validateSettings(settings = this.settings) {
    if (!settings?.apiEndpoint?.trim()) {
      throw new Error("Set an API endpoint before sending a message.");
    }

    if (!settings.apiKey.trim()) {
      throw new Error("Set an API key before sending a message.");
    }

    if (!settings.model.trim()) {
      throw new Error("Set a model before sending a message.");
    }
  }

  async resolveApiRequest(options = {}) {
    const preparedRequest = await this.resolvePreparedRequest(options);
    const effectiveSettings =
      preparedRequest?.settings && typeof preparedRequest.settings === "object"
        ? preparedRequest.settings
        : this.settings;

    return prepareOnscreenAgentApiRequest({
      preparedRequest,
      settings: effectiveSettings
    });
  }

  async streamCompletion(options = {}) {
    const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
    const effectiveRequest = await this.resolveApiRequest(options);
    const effectiveSettings =
      effectiveRequest?.settings && typeof effectiveRequest.settings === "object"
        ? effectiveRequest.settings
        : this.settings;

    this.validateSettings(effectiveSettings);

    const response = await fetch(effectiveRequest.requestUrl, {
      ...buildFetchRequestInit(effectiveRequest, options.signal)
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
}

export class OnscreenAgentCodexLlmClient extends OnscreenAgentLlmClient {
  validateSettings(settings = this.settings) {
    // The Codex-provider path selects the model from `settings.codexModel`;
    // `settings.model` is the API-tab field and may still hold the unrelated
    // OpenRouter default (`anthropic/claude-sonnet-4.6`). The hook only falls
    // back to `settings.model` if `codexModel` is empty, so require
    // `codexModel` here and keep `settings.model` as a last-resort fallback
    // that mirrors the admin-side validation.
    if (!settings?.codexModel?.trim() && !settings?.model?.trim()) {
      throw new Error("Choose a Codex model before sending a message.");
    }

    const tokens = parseCodexTokensFromSettings(settings);

    if (!tokens?.accessToken) {
      const error = new Error("Sign in with ChatGPT before sending a message.");
      error.requiresCodexLogin = true;
      throw error;
    }
  }

  async resolveApiRequest(options = {}) {
    const preparedRequest = await this.resolvePreparedRequest(options);
    const effectiveSettings =
      preparedRequest?.settings && typeof preparedRequest.settings === "object"
        ? preparedRequest.settings
        : this.settings;

    return prepareOnscreenAgentApiRequest({
      preparedRequest,
      settings: effectiveSettings
    });
  }

  async streamCompletion(options = {}) {
    const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
    const effectiveRequest = await this.resolveApiRequest(options);
    const effectiveSettings =
      effectiveRequest?.settings && typeof effectiveRequest.settings === "object"
        ? effectiveRequest.settings
        : this.settings;

    this.validateSettings(effectiveSettings);

    const response = await fetch(effectiveRequest.requestUrl, {
      ...buildFetchRequestInit(effectiveRequest, options.signal)
    });

    if (!response.ok) {
      await throwResponseError(response);
    }

    if (!response.body) {
      throw new Error("Streaming response body is not available.");
    }

    return readCodexStreamingResponse(response, onDelta);
  }
}

function parseCodexTokensFromSettings(settings = {}) {
  const raw = settings?.codexTokens;

  if (!raw) {
    return null;
  }

  if (typeof raw === "object") {
    return raw;
  }

  if (typeof raw !== "string") {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class OnscreenAgentLocalLlmClient extends OnscreenAgentLlmClient {
  validateSettings(settings = this.settings) {
    const selection = config.getOnscreenAgentLocalModelSelection(settings);

    if (selection.provider !== config.ONSCREEN_AGENT_LOCAL_PROVIDER.HUGGINGFACE) {
      throw new Error("Choose a supported local LLM provider.");
    }

    if (!selection.modelId.trim()) {
      throw new Error("Choose a Hugging Face model before sending a message.");
    }

    if (!selection.dtype.trim()) {
      throw new Error("Choose a Hugging Face dtype before sending a message.");
    }
  }

  getCompletionMessages(preparedRequest) {
    const requestBodyMessages = Array.isArray(preparedRequest?.requestBody?.messages)
      ? preparedRequest.requestBody.messages
      : [];
    const requestMessages = Array.isArray(preparedRequest?.messages) ? preparedRequest.messages : [];

    // Local generation should reuse the same final transport message shape as the API path.
    return normalizeCompletionMessagesForLocal(requestBodyMessages.length ? requestBodyMessages : requestMessages);
  }

  async streamCompletion(options = {}) {
    const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
    const effectiveRequest = await this.resolvePreparedRequest(options);
    const effectiveSettings =
      effectiveRequest?.settings && typeof effectiveRequest.settings === "object"
        ? effectiveRequest.settings
        : this.settings;

    this.validateSettings(effectiveSettings);

    const result = await getHuggingFaceManager().streamCompletion({
      messages: this.getCompletionMessages(effectiveRequest),
      modelSelection: config.getOnscreenAgentLocalModelSelection(effectiveSettings),
      onDelta,
      requestOptions: llmParams.parseOnscreenAgentParamsText(effectiveSettings.paramsText || ""),
      signal: options.signal
    });

    return result.responseMeta;
  }
}

export const prepareOnscreenAgentApiRequest = globalThis.space.extend(
  import.meta,
  async function prepareOnscreenAgentApiRequest({ preparedRequest, settings } = {}) {
    const effectivePreparedRequest =
      preparedRequest && typeof preparedRequest === "object" ? preparedRequest : {};
    const effectiveSettings =
      settings && typeof settings === "object"
        ? settings
        : effectivePreparedRequest?.settings && typeof effectivePreparedRequest.settings === "object"
          ? effectivePreparedRequest.settings
          : config.DEFAULT_ONSCREEN_AGENT_SETTINGS;
    const apiEndpoint = String(effectiveSettings?.apiEndpoint || "").trim();

    return {
      apiEndpoint,
      headers: createApiRequestHeaders(String(effectiveSettings?.apiKey || "").trim()),
      messages: Array.isArray(effectivePreparedRequest?.messages) ? effectivePreparedRequest.messages : [],
      method: "POST",
      preparedRequest: effectivePreparedRequest,
      promptInput:
        effectivePreparedRequest?.promptInput && typeof effectivePreparedRequest.promptInput === "object"
          ? effectivePreparedRequest.promptInput
          : null,
      requestBody: createApiRequestBody(effectiveSettings, effectivePreparedRequest),
      requestUrl:
        typeof effectivePreparedRequest?.requestUrl === "string" && effectivePreparedRequest.requestUrl.trim()
          ? effectivePreparedRequest.requestUrl
          : apiEndpoint,
      settings: effectiveSettings,
      systemPrompt:
        typeof effectivePreparedRequest?.systemPrompt === "string" ? effectivePreparedRequest.systemPrompt : ""
    };
  }
);

export function createOnscreenAgentLlmClient(settings = config.DEFAULT_ONSCREEN_AGENT_SETTINGS) {
  const provider = config.normalizeOnscreenAgentLlmProvider(settings?.provider);

  if (provider === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
    return new OnscreenAgentLocalLlmClient({
      settings
    });
  }

  if (provider === config.ONSCREEN_AGENT_LLM_PROVIDER.CODEX) {
    return new OnscreenAgentCodexLlmClient({
      settings
    });
  }

  return new OnscreenAgentApiLlmClient({
    settings
  });
}

export const streamOnscreenAgentCompletion = globalThis.space.extend(
  import.meta,
  async function streamOnscreenAgentCompletion({
    messages,
    onDelta,
    preparedRequest,
    promptOptions,
    promptInput,
    settings,
    signal,
    systemPrompt
  }) {
    const normalizedSettings =
      settings && typeof settings === "object" ? settings : preparedRequest?.settings;
    const client = createOnscreenAgentLlmClient(normalizedSettings);

    return client.streamCompletion({
      messages,
      onDelta,
      preparedRequest,
      promptOptions,
      promptInput,
      signal,
      systemPrompt
    });
  }
);
