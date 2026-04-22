import { DEFAULT_PROMPT_BUDGET_RATIOS, normalizePromptBudgetRatios } from "/mod/_core/agent_prompt/prompt-items.js";

export const ADMIN_CHAT_CONFIG_PATH = "~/conf/admin-chat.yaml";
export const ADMIN_CHAT_HISTORY_PATH = "~/hist/admin-chat.json";
export const DEFAULT_ADMIN_CHAT_MAX_TOKENS = 120_000;
export const ADMIN_CHAT_LLM_PROVIDER = {
  API: "api",
  BEDROCK: "bedrock",
  LOCAL: "local"
};

export const ADMIN_CHAT_BEDROCK_CRED_MODE = {
  SERVER: "server",
  CLIENT_KEY: "client-key"
};

export const ADMIN_CHAT_BEDROCK_ROUTE = {
  CONVERSE: "converse",
  OPENAI: "openai"
};

export const BEDROCK_MODEL_PRESETS = [
  {
    id: "us.anthropic.claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (fast, recommended)",
    route: "converse"
  },
  {
    id: "us.anthropic.claude-opus-4-7",
    label: "Claude Opus 4.7 (smartest)",
    route: "converse"
  },
  {
    id: "us.anthropic.claude-opus-4-6-v1",
    label: "Claude Opus 4.6",
    route: "converse"
  },
  {
    id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    label: "Claude Haiku 4.5 (cheap)",
    route: "converse"
  },
  {
    id: "openai.gpt-oss-20b-1:0",
    label: "OpenAI gpt-oss 20B",
    route: "openai"
  },
  {
    id: "openai.gpt-oss-120b-1:0",
    label: "OpenAI gpt-oss 120B",
    route: "openai"
  }
];

export function bedrockRouteForModel(modelId = "") {
  const normalized = String(modelId || "").trim().toLowerCase();
  if (!normalized) {
    return ADMIN_CHAT_BEDROCK_ROUTE.CONVERSE;
  }
  if (normalized.startsWith("openai.")) {
    return ADMIN_CHAT_BEDROCK_ROUTE.OPENAI;
  }
  return ADMIN_CHAT_BEDROCK_ROUTE.CONVERSE;
}

export function bedrockApiEndpointForRoute(route = ADMIN_CHAT_BEDROCK_ROUTE.CONVERSE) {
  return route === ADMIN_CHAT_BEDROCK_ROUTE.OPENAI
    ? "/api/bedrock/openai/v1/chat/completions"
    : "/api/bedrock/converse/v1/chat/completions";
}

export const ADMIN_CHAT_LOCAL_PROVIDER = {
  HUGGINGFACE: "huggingface"
};

export const DEFAULT_ADMIN_CHAT_SETTINGS = {
  apiEndpoint: "https://openrouter.ai/api/v1/chat/completions",
  apiKey: "",
  bedrockApiKey: "",
  bedrockCredMode: ADMIN_CHAT_BEDROCK_CRED_MODE.SERVER,
  bedrockModel: BEDROCK_MODEL_PRESETS[0].id,
  huggingfaceDtype: "q4",
  huggingfaceModel: "",
  localProvider: ADMIN_CHAT_LOCAL_PROVIDER.HUGGINGFACE,
  maxTokens: DEFAULT_ADMIN_CHAT_MAX_TOKENS,
  model: "openai/gpt-5.4-mini",
  paramsText: "temperature:0.2",
  promptBudgetRatios: { ...DEFAULT_PROMPT_BUDGET_RATIOS },
  provider: ADMIN_CHAT_LLM_PROVIDER.API
};

export function normalizeAdminChatLlmProvider(value) {
  if (value === ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
    return ADMIN_CHAT_LLM_PROVIDER.LOCAL;
  }
  if (value === ADMIN_CHAT_LLM_PROVIDER.BEDROCK) {
    return ADMIN_CHAT_LLM_PROVIDER.BEDROCK;
  }
  return ADMIN_CHAT_LLM_PROVIDER.API;
}

export function normalizeAdminChatBedrockCredMode(value) {
  return value === ADMIN_CHAT_BEDROCK_CRED_MODE.CLIENT_KEY
    ? ADMIN_CHAT_BEDROCK_CRED_MODE.CLIENT_KEY
    : ADMIN_CHAT_BEDROCK_CRED_MODE.SERVER;
}

export function normalizeAdminChatLocalProvider(value) {
  return ADMIN_CHAT_LOCAL_PROVIDER.HUGGINGFACE;
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
