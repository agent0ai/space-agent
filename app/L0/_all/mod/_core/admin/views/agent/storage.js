import * as config from "/mod/_core/admin/views/agent/config.js";

function createDefaultConfig() {
  return {
    settings: {
      ...config.DEFAULT_ADMIN_CHAT_SETTINGS,
      promptBudgetRatios: { ...config.DEFAULT_ADMIN_CHAT_SETTINGS.promptBudgetRatios }
    },
    systemPrompt: ""
  };
}

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (!runtime.api || typeof runtime.api.fileRead !== "function" || typeof runtime.api.fileWrite !== "function") {
    throw new Error("space.api file helpers are not available.");
  }

  if (
    !runtime.utils ||
    typeof runtime.utils !== "object" ||
    !runtime.utils.userCrypto ||
    typeof runtime.utils.userCrypto.encryptText !== "function" ||
    typeof runtime.utils.userCrypto.decryptText !== "function" ||
    !runtime.utils.yaml ||
    typeof runtime.utils.yaml.parse !== "function" ||
    typeof runtime.utils.yaml.stringify !== "function"
  ) {
    throw new Error("space.utils userCrypto or yaml helpers are not available.");
  }

  return runtime;
}

function isMissingFileError(error) {
  const message = String(error?.message || "");
  return /\bstatus 404\b/u.test(message) || /File not found\./u.test(message);
}

function isSingleUserAppRuntime(runtime) {
  return Boolean(runtime?.config?.get?.("SINGLE_USER_APP", false));
}

function normalizeStoredPromptBudgetRatios(storedConfig = {}) {
  const storedRatios =
    storedConfig.prompt_budget_ratios ||
    storedConfig.promptBudgetRatios ||
    {};
  const source = storedRatios && typeof storedRatios === "object" ? storedRatios : {};

  return config.normalizeAdminChatPromptBudgetRatios({
    history:
      source.history ??
      storedConfig.history_prompt_max_ratio ??
      storedConfig.historyPromptMaxRatio,
    singleMessage:
      source.single_message ??
      source.singleMessage ??
      storedConfig.single_message_max_ratio ??
      storedConfig.singleMessageMaxRatio,
    system:
      source.system ??
      storedConfig.system_prompt_max_ratio ??
      storedConfig.systemPromptMaxRatio,
    transient:
      source.transient ??
      storedConfig.transient_prompt_max_ratio ??
      storedConfig.transientPromptMaxRatio
  });
}

async function decodeStoredApiKey(runtime, storedValue) {
  const rawStoredValue = String(storedValue || "").trim();

  if (!rawStoredValue) {
    return {
      locked: false,
      storedValue: "",
      value: ""
    };
  }

  if (isSingleUserAppRuntime(runtime) && rawStoredValue.startsWith("userCrypto:")) {
    return {
      locked: true,
      storedValue: rawStoredValue,
      value: ""
    };
  }

  const value = await runtime.utils.userCrypto.decryptText(rawStoredValue);

  return {
    locked: rawStoredValue.startsWith("userCrypto:") && !value,
    storedValue: rawStoredValue,
    value: String(value || "").trim()
  };
}

async function encodeStoredApiKey(runtime, settings = {}) {
  const nextValue = String(settings.apiKey || "").trim();
  const storedValue = String(settings.storedApiKeyValue || "").trim();

  if (
    settings.storedApiKeyLocked === true &&
    !nextValue &&
    storedValue.startsWith("userCrypto:")
  ) {
    return storedValue;
  }

  if (!nextValue) {
    return "";
  }

  const encryptedValue = await runtime.utils.userCrypto.encryptText(nextValue);

  if (!encryptedValue) {
    throw new Error("Unable to encrypt admin chat API key because userCrypto is unavailable.");
  }

  return encryptedValue;
}

async function normalizeStoredConfig(runtime, parsedConfig) {
  const storedConfig = parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};
  const rawStoredProvider = storedConfig.llm_provider || storedConfig.provider;
  const storedMaxTokens =
    storedConfig.max_tokens ?? storedConfig.maxTokens ?? config.DEFAULT_ADMIN_CHAT_SETTINGS.maxTokens;
  const provider = config.normalizeAdminChatLlmProvider(rawStoredProvider);
  const localProvider = config.normalizeAdminChatLocalProvider(storedConfig.local_provider || storedConfig.localProvider);
  const storedApiKey = await decodeStoredApiKey(
    runtime,
    storedConfig.api_key || storedConfig.apiKey || config.DEFAULT_ADMIN_CHAT_SETTINGS.apiKey || ""
  );

  return {
    settings: {
      apiEndpoint: String(storedConfig.api_endpoint || storedConfig.apiEndpoint || config.DEFAULT_ADMIN_CHAT_SETTINGS.apiEndpoint || "").trim(),
      apiKey: storedApiKey.value,
      huggingfaceDtype: String(
        storedConfig.huggingface_dtype || storedConfig.huggingfaceDtype || config.DEFAULT_ADMIN_CHAT_SETTINGS.huggingfaceDtype || ""
      ).trim(),
      huggingfaceModel: String(
        storedConfig.huggingface_model || storedConfig.huggingfaceModel || config.DEFAULT_ADMIN_CHAT_SETTINGS.huggingfaceModel || ""
      ).trim(),
      localProvider,
      maxTokens: config.normalizeAdminChatMaxTokens(storedMaxTokens),
      model: String(storedConfig.model || config.DEFAULT_ADMIN_CHAT_SETTINGS.model || "").trim(),
      paramsText: String(storedConfig.params || storedConfig.paramsText || config.DEFAULT_ADMIN_CHAT_SETTINGS.paramsText || "").trim(),
      promptBudgetRatios: normalizeStoredPromptBudgetRatios(storedConfig),
      provider,
      supportsVision: config.normalizeAdminChatSupportsVision(
        storedConfig.supports_vision ??
          storedConfig.supportsVision ??
          config.DEFAULT_ADMIN_CHAT_SETTINGS.supportsVision
      ),
      storedApiKeyLocked: storedApiKey.locked,
      storedApiKeyValue: storedApiKey.storedValue
    },
    systemPrompt: String(
      storedConfig.custom_system_prompt ||
        storedConfig.customSystemPrompt ||
        storedConfig.system_prompt ||
        storedConfig.systemPrompt ||
        ""
    ).trim()
  };
}

async function buildStoredConfigPayload(runtime, { settings, systemPrompt }) {
  const normalizedSystemPrompt = typeof systemPrompt === "string" ? systemPrompt.trim() : "";
  const payload = {
    api_endpoint: String(settings?.apiEndpoint || config.DEFAULT_ADMIN_CHAT_SETTINGS.apiEndpoint || "").trim(),
    api_key: await encodeStoredApiKey(runtime, settings),
    huggingface_dtype: String(settings?.huggingfaceDtype || config.DEFAULT_ADMIN_CHAT_SETTINGS.huggingfaceDtype || "").trim(),
    huggingface_model: String(settings?.huggingfaceModel || config.DEFAULT_ADMIN_CHAT_SETTINGS.huggingfaceModel || "").trim(),
    local_provider: config.normalizeAdminChatLocalProvider(settings?.localProvider),
    llm_provider: config.normalizeAdminChatLlmProvider(settings?.provider),
    max_tokens: config.normalizeAdminChatMaxTokens(settings?.maxTokens),
    model: String(settings?.model || config.DEFAULT_ADMIN_CHAT_SETTINGS.model || "").trim(),
    params: String(settings?.paramsText || config.DEFAULT_ADMIN_CHAT_SETTINGS.paramsText || "").trim(),
    prompt_budget_ratios: {
      history: config.normalizeAdminChatPromptBudgetRatios(settings?.promptBudgetRatios).history,
      single_message: config.normalizeAdminChatPromptBudgetRatios(settings?.promptBudgetRatios).singleMessage,
      system: config.normalizeAdminChatPromptBudgetRatios(settings?.promptBudgetRatios).system,
      transient: config.normalizeAdminChatPromptBudgetRatios(settings?.promptBudgetRatios).transient
    },
    supports_vision: config.normalizeAdminChatSupportsVision(settings?.supportsVision)
  };

  if (normalizedSystemPrompt) {
    payload.custom_system_prompt = normalizedSystemPrompt;
  }

  return payload;
}

export async function loadAdminChatConfig() {
  const runtime = getRuntime();

  try {
    const result = await runtime.api.fileRead(config.ADMIN_CHAT_CONFIG_PATH);
    return normalizeStoredConfig(runtime, runtime.utils.yaml.parse(String(result?.content || "")));
  } catch (error) {
    if (isMissingFileError(error)) {
      return createDefaultConfig();
    }

    throw new Error(`Unable to load admin chat config: ${error.message}`);
  }
}

export async function saveAdminChatConfig(nextConfig) {
  const runtime = getRuntime();
  const payload = await buildStoredConfigPayload(runtime, nextConfig);
  const content = runtime.utils.yaml.stringify(payload);

  try {
    await runtime.api.fileWrite(config.ADMIN_CHAT_CONFIG_PATH, content);
    if (nextConfig?.settings && typeof nextConfig.settings === "object") {
      nextConfig.settings.storedApiKeyLocked = false;
      nextConfig.settings.storedApiKeyValue = String(payload.api_key || "").trim();
    }
  } catch (error) {
    throw new Error(`Unable to save admin chat config: ${error.message}`);
  }
}

export async function loadAdminChatHistory() {
  const runtime = getRuntime();

  try {
    const result = await runtime.api.fileRead(config.ADMIN_CHAT_HISTORY_PATH);
    const parsed = JSON.parse(String(result?.content || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    if (error instanceof SyntaxError) {
      throw new Error("Unable to load admin chat history: invalid JSON.");
    }

    throw new Error(`Unable to load admin chat history: ${error.message}`);
  }
}

export async function saveAdminChatHistory(history) {
  const runtime = getRuntime();
  const content = `${JSON.stringify(Array.isArray(history) ? history : [], null, 2)}\n`;

  try {
    await runtime.api.fileWrite(config.ADMIN_CHAT_HISTORY_PATH, content);
  } catch (error) {
    throw new Error(`Unable to save admin chat history: ${error.message}`);
  }
}
