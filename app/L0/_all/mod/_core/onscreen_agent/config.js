import { DEFAULT_PROMPT_BUDGET_RATIOS, normalizePromptBudgetRatios } from "/mod/_core/agent_prompt/prompt-items.js";

export const ONSCREEN_AGENT_CONFIG_PATH = "~/conf/onscreen-agent.yaml";
export const ONSCREEN_AGENT_HISTORY_PATH = "~/hist/onscreen-agent.json";
export const ONSCREEN_AGENT_UI_STATE_STORAGE_KEY = "space.onscreenAgent.uiState";
export const DEFAULT_ONSCREEN_AGENT_MAX_TOKENS = 120_000;
export const ONSCREEN_AGENT_LLM_PROVIDER = Object.freeze({
  API: "api",
  BEDROCK: "bedrock",
  LOCAL: "local"
});

export const ONSCREEN_AGENT_BEDROCK_CRED_MODE = Object.freeze({
  SERVER: "server",
  CLIENT_KEY: "client-key"
});

export const ONSCREEN_AGENT_BEDROCK_ROUTE = Object.freeze({
  CONVERSE: "converse",
  OPENAI: "openai"
});

export const ONSCREEN_BEDROCK_MODEL_PRESETS = Object.freeze([
  { id: "us.anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (fast, recommended)", route: "converse" },
  { id: "us.anthropic.claude-opus-4-7", label: "Claude Opus 4.7 (smartest)", route: "converse" },
  { id: "us.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6", route: "converse" },
  { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5 (cheap)", route: "converse" },
  { id: "openai.gpt-oss-20b-1:0", label: "OpenAI gpt-oss 20B", route: "openai" },
  { id: "openai.gpt-oss-120b-1:0", label: "OpenAI gpt-oss 120B", route: "openai" }
]);

export function bedrockRouteForOnscreenModel(modelId = "") {
  const normalized = String(modelId || "").trim().toLowerCase();
  if (!normalized) return ONSCREEN_AGENT_BEDROCK_ROUTE.CONVERSE;
  return normalized.startsWith("openai.")
    ? ONSCREEN_AGENT_BEDROCK_ROUTE.OPENAI
    : ONSCREEN_AGENT_BEDROCK_ROUTE.CONVERSE;
}

export function bedrockApiEndpointForOnscreenRoute(route = ONSCREEN_AGENT_BEDROCK_ROUTE.CONVERSE) {
  return route === ONSCREEN_AGENT_BEDROCK_ROUTE.OPENAI
    ? "/api/bedrock/openai/v1/chat/completions"
    : "/api/bedrock/converse/v1/chat/completions";
}
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
  bedrockApiKey: "",
  bedrockCredMode: ONSCREEN_AGENT_BEDROCK_CRED_MODE.SERVER,
  bedrockModel: ONSCREEN_BEDROCK_MODEL_PRESETS[0].id,
  huggingfaceDtype: "q4",
  huggingfaceModel: "",
  localProvider: ONSCREEN_AGENT_LOCAL_PROVIDER.HUGGINGFACE,
  maxTokens: DEFAULT_ONSCREEN_AGENT_MAX_TOKENS,
  model: "anthropic/claude-sonnet-4.6",
  paramsText: "temperature:0.2",
  promptBudgetRatios: { ...DEFAULT_PROMPT_BUDGET_RATIOS },
  provider: ONSCREEN_AGENT_LLM_PROVIDER.API
};

function normalizeOnscreenAgentSettingText(value) {
  return String(value ?? "").trim();
}

export function normalizeOnscreenAgentLlmProvider(value) {
  if (value === ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) return ONSCREEN_AGENT_LLM_PROVIDER.LOCAL;
  if (value === ONSCREEN_AGENT_LLM_PROVIDER.BEDROCK) return ONSCREEN_AGENT_LLM_PROVIDER.BEDROCK;
  return ONSCREEN_AGENT_LLM_PROVIDER.API;
}

export function normalizeOnscreenAgentBedrockCredMode(value) {
  return value === ONSCREEN_AGENT_BEDROCK_CRED_MODE.CLIENT_KEY
    ? ONSCREEN_AGENT_BEDROCK_CRED_MODE.CLIENT_KEY
    : ONSCREEN_AGENT_BEDROCK_CRED_MODE.SERVER;
}

export function normalizeOnscreenAgentLocalProvider(value) {
  return ONSCREEN_AGENT_LOCAL_PROVIDER.HUGGINGFACE;
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
      normalizeOnscreenAgentSettingText(DEFAULT_ONSCREEN_AGENT_SETTINGS.paramsText)
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
