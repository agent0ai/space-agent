import { DEFAULT_PROMPT_BUDGET_RATIOS, normalizePromptBudgetRatios } from "/mod/_core/agent_prompt/prompt-items.js";

export const ONSCREEN_AGENT_CONFIG_PATH = "~/conf/onscreen-agent.yaml";
export const ONSCREEN_AGENT_HISTORY_PATH = "~/hist/onscreen-agent.json";
export const ONSCREEN_AGENT_UI_STATE_STORAGE_KEY = "space.onscreenAgent.uiState";
export const DEFAULT_ONSCREEN_AGENT_MAX_TOKENS = 120_000;
export const ONSCREEN_AGENT_LLM_PROVIDER = Object.freeze({
  API: "api",
  LOCAL: "local"
});
export const ONSCREEN_AGENT_LOCAL_PROVIDER = Object.freeze({
  HUGGINGFACE: "huggingface"
});
export const ONSCREEN_AGENT_HIDDEN_EDGE = Object.freeze({
  BOTTOM: "bottom",
  LEFT: "left",
  RIGHT: "right",
  TOP: "top"
});

export const DEFAULT_ONSCREEN_AGENT_SETTINGS = {
  apiEndpoint: "https://openrouter.ai/api/v1/chat/completions",
  apiKey: "",
  huggingfaceDtype: "q4",
  huggingfaceModel: "",
  localProvider: ONSCREEN_AGENT_LOCAL_PROVIDER.HUGGINGFACE,
  maxTokens: DEFAULT_ONSCREEN_AGENT_MAX_TOKENS,
  model: "anthropic/claude-sonnet-4.6",
  paramsText: "temperature:0.2",
  promptBudgetRatios: { ...DEFAULT_PROMPT_BUDGET_RATIOS },
  provider: ONSCREEN_AGENT_LLM_PROVIDER.API,
  supportsVision: true
};

function normalizeOnscreenAgentSettingText(value) {
  return String(value ?? "").trim();
}

export function normalizeOnscreenAgentLlmProvider(value) {
  return value === ONSCREEN_AGENT_LLM_PROVIDER.LOCAL
    ? ONSCREEN_AGENT_LLM_PROVIDER.LOCAL
    : ONSCREEN_AGENT_LLM_PROVIDER.API;
}

export function normalizeOnscreenAgentLocalProvider(value) {
  return ONSCREEN_AGENT_LOCAL_PROVIDER.HUGGINGFACE;
}

export function normalizeOnscreenAgentSupportsVision(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function createOnscreenAgentHuggingFaceSelectionValue(modelId, dtype) {
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

export function parseOnscreenAgentHuggingFaceSelectionValue(value) {
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

export function getOnscreenAgentLocalModelSelection(settings = {}) {
  const provider = normalizeOnscreenAgentLocalProvider(settings.localProvider);

  return {
    dtype: String(settings.huggingfaceDtype || "").trim(),
    modelId: String(settings.huggingfaceModel || "").trim(),
    provider
  };
}

export function isDefaultOnscreenAgentLlmSettings(settings) {
  const normalizedSettings = settings && typeof settings === "object" ? settings : {};

  return (
    normalizeOnscreenAgentLlmProvider(normalizedSettings.provider) ===
      DEFAULT_ONSCREEN_AGENT_SETTINGS.provider &&
    normalizeOnscreenAgentSettingText(normalizedSettings.apiEndpoint) ===
      normalizeOnscreenAgentSettingText(DEFAULT_ONSCREEN_AGENT_SETTINGS.apiEndpoint) &&
    normalizeOnscreenAgentSettingText(normalizedSettings.model) ===
      normalizeOnscreenAgentSettingText(DEFAULT_ONSCREEN_AGENT_SETTINGS.model) &&
    normalizeOnscreenAgentMaxTokens(normalizedSettings.maxTokens) === DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens &&
    normalizeOnscreenAgentSettingText(normalizedSettings.paramsText) ===
      normalizeOnscreenAgentSettingText(DEFAULT_ONSCREEN_AGENT_SETTINGS.paramsText) &&
    normalizeOnscreenAgentSupportsVision(normalizedSettings.supportsVision) ===
      DEFAULT_ONSCREEN_AGENT_SETTINGS.supportsVision
  );
}

export function normalizeOnscreenAgentHistoryHeight(value) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.round(parsedValue);
}

export function normalizeOnscreenAgentHiddenEdge(value) {
  switch (value) {
    case ONSCREEN_AGENT_HIDDEN_EDGE.LEFT:
    case ONSCREEN_AGENT_HIDDEN_EDGE.RIGHT:
    case ONSCREEN_AGENT_HIDDEN_EDGE.BOTTOM:
      return value;
    default:
      return "";
  }
}

function normalizeMaxTokensText(value) {
  return String(value ?? "")
    .trim()
    .replace(/[,_\s]+/gu, "");
}

export function parseOnscreenAgentMaxTokens(value) {
  const normalizedValue = normalizeMaxTokensText(value);

  if (!normalizedValue) {
    return DEFAULT_ONSCREEN_AGENT_MAX_TOKENS;
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

export function normalizeOnscreenAgentMaxTokens(value) {
  try {
    return parseOnscreenAgentMaxTokens(value);
  } catch {
    return DEFAULT_ONSCREEN_AGENT_MAX_TOKENS;
  }
}

export function normalizeOnscreenAgentPromptBudgetRatios(value = {}) {
  return normalizePromptBudgetRatios(value);
}

export function formatOnscreenAgentTokenCount(tokenCount) {
  const normalizedCount = Number.isFinite(tokenCount) ? Math.max(0, Math.round(tokenCount)) : 0;

  if (normalizedCount > 100_000) {
    return `${Math.round(normalizedCount / 1000)}k`;
  }

  if (normalizedCount > 1000) {
    return `${(normalizedCount / 1000).toFixed(1)}k`;
  }

  return String(normalizedCount);
}
