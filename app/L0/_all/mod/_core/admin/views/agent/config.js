import { DEFAULT_PROMPT_BUDGET_RATIOS, normalizePromptBudgetRatios } from "/mod/_core/agent_prompt/prompt-items.js";

export const ADMIN_CHAT_CONFIG_PATH = "~/conf/admin-chat.yaml";
export const ADMIN_CHAT_HISTORY_PATH = "~/hist/admin-chat.json";
export const DEFAULT_ADMIN_CHAT_MAX_TOKENS = 120_000;
export const ADMIN_CHAT_LLM_PROVIDER = {
  API: "api",
  LOCAL: "local"
};

export const ADMIN_CHAT_LOCAL_PROVIDER = {
  HUGGINGFACE: "huggingface"
};

export const DEFAULT_ADMIN_CHAT_SETTINGS = {
  apiEndpoint: "https://openrouter.ai/api/v1/chat/completions",
  apiKey: "",
  huggingfaceDtype: "q4",
  huggingfaceModel: "",
  localProvider: ADMIN_CHAT_LOCAL_PROVIDER.HUGGINGFACE,
  maxTokens: DEFAULT_ADMIN_CHAT_MAX_TOKENS,
  model: "openai/gpt-5.4-mini",
  paramsText: "temperature:0.2",
  promptBudgetRatios: { ...DEFAULT_PROMPT_BUDGET_RATIOS },
  provider: ADMIN_CHAT_LLM_PROVIDER.API,
  supportsVision: true
};

export function normalizeAdminChatLlmProvider(value) {
  return value === ADMIN_CHAT_LLM_PROVIDER.LOCAL
    ? ADMIN_CHAT_LLM_PROVIDER.LOCAL
    : ADMIN_CHAT_LLM_PROVIDER.API;
}

export function normalizeAdminChatLocalProvider(value) {
  return ADMIN_CHAT_LOCAL_PROVIDER.HUGGINGFACE;
}

export function normalizeAdminChatSupportsVision(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function createAdminChatHuggingFaceSelectionValue(modelId, dtype) {
  const normalizedModelId = String(modelId || "").trim();
  const normalizedDtype = String(dtype || "").trim();

  if (!normalizedModelId || !normalizedDtype) {
    return "";
  }

  return JSON.stringify({
    dtype: normalizedDtype,
    modelId: normalizedModelId
  });
}

export function parseAdminChatHuggingFaceSelectionValue(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return {
      dtype: "",
      modelId: ""
    };
  }

  try {
    const parsedValue = JSON.parse(rawValue);

    return {
      dtype: String(parsedValue?.dtype || "").trim(),
      modelId: String(parsedValue?.modelId || "").trim()
    };
  } catch {
    return {
      dtype: "",
      modelId: ""
    };
  }
}

export function getAdminChatLocalModelSelection(settings = {}) {
  const provider = normalizeAdminChatLocalProvider(settings.localProvider);

  return {
    dtype: String(settings.huggingfaceDtype || "").trim(),
    modelId: String(settings.huggingfaceModel || "").trim(),
    provider
  };
}

function normalizeMaxTokensText(value) {
  return String(value ?? "")
    .trim()
    .replace(/[,_\s]+/gu, "");
}

export function parseAdminChatMaxTokens(value) {
  const normalizedValue = normalizeMaxTokensText(value);

  if (!normalizedValue) {
    return DEFAULT_ADMIN_CHAT_MAX_TOKENS;
  }

  if (!/^\d+$/u.test(normalizedValue)) {
    throw new Error("Max tokens must be a positive whole number.");
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw new Error("Max tokens must be a positive whole number.");
  }

  return parsedValue;
}

export function normalizeAdminChatMaxTokens(value) {
  try {
    return parseAdminChatMaxTokens(value);
  } catch {
    return DEFAULT_ADMIN_CHAT_MAX_TOKENS;
  }
}

export function normalizeAdminChatPromptBudgetRatios(value = {}) {
  return normalizePromptBudgetRatios(value);
}

export function formatAdminChatTokenCount(tokenCount) {
  const normalizedCount = Number.isFinite(tokenCount) ? Math.max(0, Math.round(tokenCount)) : 0;

  if (normalizedCount > 100_000) {
    return `${Math.round(normalizedCount / 1000)}k`;
  }

  if (normalizedCount > 1000) {
    return `${(normalizedCount / 1000).toFixed(1)}k`;
  }

  return String(normalizedCount);
}
