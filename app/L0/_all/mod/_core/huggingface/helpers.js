export const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
export const DEFAULT_DTYPE = "q4";
export const LEGACY_DEFAULT_MODEL_INPUT = "onnx-community/gemma-4-E4B-it-ONNX";
export const DEFAULT_MODEL_INPUT = "onnx-community/Qwen3-0.6B-ONNX";
export const DEFAULT_MAX_NEW_TOKENS = 16384;
export const COMPATIBLE_MODELS_URL = "https://huggingface.co/onnx-community/models";
export const HUGGINGFACE_SAVED_MODELS_STORAGE_KEY = "space.huggingface.saved-models";
export const HUGGINGFACE_BROWSER_CACHE_KEY = "transformers-cache";

export const DTYPE_OPTIONS = [
  { label: "q4", value: "q4" },
  { label: "q4f16", value: "q4f16" },
  { label: "q8", value: "q8" },
  { label: "fp16", value: "fp16" },
  { label: "fp32", value: "fp32" }
];

function asFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function sanitizeText(value) {
  return String(value || "").trim();
}

export function normalizeHuggingFaceModelInput(value) {
  const rawValue = sanitizeText(value);

  if (!rawValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(rawValue);
    const hostname = parsedUrl.hostname.toLowerCase();
    const isHubHost = hostname === "huggingface.co"
      || hostname === "www.huggingface.co"
      || hostname === "hf.co";

    if (!isHubHost) {
      return rawValue;
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const scopedParts = pathParts[0] === "models" ? pathParts.slice(1) : pathParts;
    const stopIndex = scopedParts.findIndex((part) => (
      part === "blob"
      || part === "resolve"
      || part === "tree"
      || part === "raw"
      || part === "commit"
      || part === "discussions"
      || part === "pull"
    ));
    const relevantParts = stopIndex >= 0 ? scopedParts.slice(0, stopIndex) : scopedParts;

    return relevantParts.slice(0, 2).join("/");
  } catch {
    return rawValue.replace(/^https?:\/\//iu, "").replace(/\/+$/u, "");
  }
}

export function describeModelSelection(selection = {}) {
  return normalizeHuggingFaceModelInput(selection.modelInput || selection.modelId) || "model";
}

export function normalizeMaxNewTokens(value) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_MAX_NEW_TOKENS;
  }

  return Math.max(1, Math.min(16384, Math.round(parsedValue)));
}

export function validateModelSelection(selection = {}) {
  const modelId = normalizeHuggingFaceModelInput(selection.modelInput || selection.modelId);
  if (!modelId) {
    return "Enter a Hugging Face model id or Hub URL.";
  }

  const normalizedDtype = sanitizeText(selection.dtype || DEFAULT_DTYPE);
  if (!DTYPE_OPTIONS.some((option) => option.value === normalizedDtype)) {
    return "Choose a supported dtype.";
  }

  const normalizedMaxNewTokens = normalizeMaxNewTokens(selection.maxNewTokens);
  if (!Number.isFinite(normalizedMaxNewTokens) || normalizedMaxNewTokens <= 0) {
    return "Max new tokens must be greater than zero.";
  }

  return "";
}

export function createSavedModelEntry(selection = {}) {
  const modelId = normalizeHuggingFaceModelInput(selection.modelInput || selection.modelId);
  if (!modelId) {
    return null;
  }

  return {
    dtype: sanitizeText(selection.dtype || DEFAULT_DTYPE) || DEFAULT_DTYPE,
    modelId,
    modelInput: sanitizeText(selection.modelInput || modelId) || modelId,
    updatedAt: Date.now()
  };
}

export function mergeSavedModelEntries(existingEntries = [], nextEntry) {
  if (!nextEntry?.modelId) {
    return Array.isArray(existingEntries) ? existingEntries : [];
  }

  const filteredEntries = (Array.isArray(existingEntries) ? existingEntries : [])
    .filter((entry) => !(entry?.modelId === nextEntry.modelId && entry?.dtype === nextEntry.dtype));

  return [nextEntry, ...filteredEntries].slice(0, 16);
}

export function removeSavedModelEntries(existingEntries = [], selection = {}, options = {}) {
  const modelId = normalizeHuggingFaceModelInput(selection.modelId || selection.modelInput);
  const dtype = sanitizeText(selection.dtype || DEFAULT_DTYPE) || DEFAULT_DTYPE;
  const removeAllDtypesForModel = options.removeAllDtypesForModel !== false;

  return (Array.isArray(existingEntries) ? existingEntries : [])
    .filter((entry) => {
      if (entry?.modelId !== modelId) {
        return true;
      }

      if (removeAllDtypesForModel) {
        return false;
      }

      return entry?.dtype !== dtype;
    })
    .map((entry) => createSavedModelEntry(entry))
    .filter(Boolean);
}

export function getSavedModelEntryKey(selection = {}) {
  const modelId = normalizeHuggingFaceModelInput(selection.modelId || selection.modelInput);
  const dtype = sanitizeText(selection.dtype || DEFAULT_DTYPE) || DEFAULT_DTYPE;

  if (!modelId) {
    return "";
  }

  return `${modelId}:${dtype}`;
}

function getCacheMatchPrefixes(modelId) {
  const normalizedModelId = normalizeHuggingFaceModelInput(modelId);
  if (!normalizedModelId) {
    return [];
  }

  return [
    new URL(`${normalizedModelId}/resolve/`, "https://huggingface.co/").href,
    new URL(`${normalizedModelId}/resolve/`, "https://www.huggingface.co/").href,
    new URL(`${normalizedModelId}/resolve/`, "https://hf.co/").href
  ];
}

export async function discardCachedModelEntries(modelId) {
  const normalizedModelId = normalizeHuggingFaceModelInput(modelId);
  if (!normalizedModelId) {
    return {
      deletedCount: 0,
      modelId: ""
    };
  }

  if (typeof globalThis.caches?.open !== "function") {
    throw new Error("Browser cache access is unavailable in this context.");
  }

  const cache = await globalThis.caches.open(HUGGINGFACE_BROWSER_CACHE_KEY);
  const requests = await cache.keys();
  const prefixes = getCacheMatchPrefixes(normalizedModelId);
  let deletedCount = 0;

  for (const request of requests) {
    const requestUrl = String(request?.url || "");
    if (!requestUrl || !prefixes.some((prefix) => requestUrl.startsWith(prefix))) {
      continue;
    }

    if (await cache.delete(request)) {
      deletedCount += 1;
    }
  }

  return {
    deletedCount,
    modelId: normalizedModelId
  };
}

export function readSavedModelEntries() {
  try {
    const rawValue = globalThis.localStorage?.getItem(HUGGINGFACE_SAVED_MODELS_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    const nextEntries = parsedValue
      .map((entry) => createSavedModelEntry(entry))
      .filter((entry) => entry?.modelId !== LEGACY_DEFAULT_MODEL_INPUT)
      .filter(Boolean);

    if (nextEntries.length !== parsedValue.length) {
      try {
        globalThis.localStorage?.setItem(
          HUGGINGFACE_SAVED_MODELS_STORAGE_KEY,
          JSON.stringify(nextEntries)
        );
      } catch {
        // Ignore storage write failures and still return the sanitized list.
      }
    }

    return nextEntries;
  } catch {
    return [];
  }
}

export function persistSavedModelEntries(entries) {
  try {
    globalThis.localStorage?.setItem(HUGGINGFACE_SAVED_MODELS_STORAGE_KEY, JSON.stringify(Array.isArray(entries) ? entries : []));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function createChatMessage(role, content = "") {
  return {
    content: String(content || ""),
    finishReason: "",
    id: crypto.randomUUID(),
    isStreaming: false,
    metrics: null,
    modelId: "",
    role: role === "assistant" ? "assistant" : "user"
  };
}

function normalizeHuggingFaceChatRole(role = "") {
  return role === "system" || role === "assistant" || role === "user" ? role : "";
}

function normalizeHuggingFaceChatContent(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n").trim();
}

function joinHuggingFaceMessageContent(left = "", right = "") {
  return [left, right].filter((content) => typeof content === "string" && content.length).join("\n\n");
}

function mergeHuggingFaceChatMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).reduce((mergedMessages, message) => {
    const previousMessage = mergedMessages[mergedMessages.length - 1];

    if (
      previousMessage
      && previousMessage.role === message.role
      && (message.role === "user" || message.role === "assistant")
    ) {
      previousMessage.content = joinHuggingFaceMessageContent(previousMessage.content, message.content);
      return mergedMessages;
    }

    mergedMessages.push({
      ...message
    });
    return mergedMessages;
  }, []);
}

export function normalizeHuggingFaceChatMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => {
      const role = normalizeHuggingFaceChatRole(message?.role);
      const content = normalizeHuggingFaceChatContent(message?.content);

      if (!role || !content) {
        return null;
      }

      return {
        content,
        role
      };
    })
    .filter(Boolean);
}

export function buildHuggingFaceFallbackPrompt(messages = []) {
  const normalizedMessages = mergeHuggingFaceChatMessages(normalizeHuggingFaceChatMessages(messages));
  const systemMessages = normalizedMessages.filter((message) => message.role === "system");
  const conversationMessages = normalizedMessages.filter((message) => message.role !== "system");
  const promptBlocks = [
    "You are continuing a chat conversation.",
    "Answer with only the next assistant message.",
    "Do not repeat the system instructions.",
    "Do not emit role labels such as User: or Assistant:.",
    "Do not continue the transcript beyond the assistant reply.",
    ""
  ];

  if (systemMessages.length) {
    promptBlocks.push("System instructions:");
    promptBlocks.push(systemMessages.map((message) => message.content).join("\n\n"));
    promptBlocks.push("");
  }

  if (conversationMessages.length) {
    promptBlocks.push("Conversation:");
    promptBlocks.push("");

    for (const message of conversationMessages) {
      promptBlocks.push(message.role === "assistant" ? "Assistant:" : "User:");
      promptBlocks.push(message.content);
      promptBlocks.push("");
    }
  }

  promptBlocks.push("Assistant:");
  return promptBlocks.join("\n");
}

export function buildChatMessages(systemPrompt, messages = []) {
  const normalizedSystemPrompt = sanitizeText(systemPrompt);

  return mergeHuggingFaceChatMessages([
    ...(normalizedSystemPrompt
      ? [{
          content: normalizedSystemPrompt,
          role: "system"
        }]
      : []),
    ...normalizeHuggingFaceChatMessages(messages)
  ]);
}

export function normalizeUsageMetrics(metrics = {}) {
  const promptTokens = Number(metrics.promptTokens);
  const completionTokens = Number(metrics.completionTokens);
  const totalTokens = Number(metrics.totalTokens);
  const tokensPerSecond = Number(metrics.tokensPerSecond);

  return {
    completionTokens: asFiniteNumber(completionTokens),
    endToEndLatencySeconds: asFiniteNumber(Number(metrics.endToEndLatencySeconds)),
    promptTokens: asFiniteNumber(promptTokens),
    timeToFirstTokenSeconds: asFiniteNumber(Number(metrics.timeToFirstTokenSeconds)),
    tokensPerMinute: Number.isFinite(tokensPerSecond) ? tokensPerSecond * 60 : null,
    tokensPerSecond: asFiniteNumber(tokensPerSecond),
    totalTokens: asFiniteNumber(totalTokens)
  };
}

export function formatNumber(value, digits = 1) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return "-";
  }

  return normalizedValue.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

export function formatTokenRate(value) {
  return `${formatNumber(value, value >= 100 ? 0 : 1)}`;
}

export function formatDurationSeconds(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return "-";
  }

  return `${formatNumber(normalizedValue, normalizedValue >= 10 ? 1 : 2)}s`;
}
