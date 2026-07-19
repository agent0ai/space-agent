import * as config from "/mod/_core/onscreen_agent/config.js";

const DISPLAY_MODE_FULL = "full";
const DISPLAY_MODE_COMPACT = "compact";

function normalizeDisplayMode(value) {
  if (value === DISPLAY_MODE_FULL || value === DISPLAY_MODE_COMPACT) {
    return value;
  }

  return "";
}

function normalizeStoredCoordinate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsedValue = Number(value);

    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
}

function normalizeUiStateOwner(value) {
  return String(value || "").trim();
}

async function getUiStateOwner(runtime) {
  if (!runtime?.api || typeof runtime.api.userSelfInfo !== "function") {
    return "";
  }

  try {
    const identity = await runtime.api.userSelfInfo();
    return normalizeUiStateOwner(identity?.username);
  } catch {
    return "";
  }
}

function normalizeStoredPromptBudgetRatios(storedConfig = {}) {
  const storedRatios =
    storedConfig.prompt_budget_ratios ||
    storedConfig.promptBudgetRatios ||
    {};
  const source = storedRatios && typeof storedRatios === "object" ? storedRatios : {};

  return config.normalizeOnscreenAgentPromptBudgetRatios({
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

function createDefaultConfig() {
  return {
    settings: {
      ...config.DEFAULT_ONSCREEN_AGENT_SETTINGS,
      promptBudgetRatios: { ...config.DEFAULT_ONSCREEN_AGENT_SETTINGS.promptBudgetRatios }
    },
    systemPrompt: "",
    agentX: null,
    agentY: null,
    hiddenEdge: "",
    historyHeight: null,
    displayMode: DISPLAY_MODE_COMPACT
  };
}

function createDefaultUiState() {
  return {
    agentX: null,
    agentY: null,
    hiddenEdge: "",
    historyHeight: null,
    displayMode: DISPLAY_MODE_COMPACT
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
    throw new Error("Unable to encrypt onscreen agent API key because userCrypto is unavailable.");
  }

  return encryptedValue;
}

async function normalizeStoredConfig(runtime, parsedConfig) {
  const storedConfig = parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};
  const rawStoredProvider = storedConfig.llm_provider || storedConfig.provider;
  const storedMaxTokens =
    storedConfig.max_tokens ?? storedConfig.maxTokens ?? config.DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens;
  const rawX = storedConfig.agent_x ?? storedConfig.agentX;
  const rawY = storedConfig.agent_y ?? storedConfig.agentY;
  const rawHiddenEdge = storedConfig.hidden_edge ?? storedConfig.hiddenEdge;
  const rawHistoryHeight = storedConfig.history_height ?? storedConfig.historyHeight;
  const storedDisplayMode = normalizeDisplayMode(storedConfig.display_mode ?? storedConfig.displayMode);
  const provider = config.normalizeOnscreenAgentLlmProvider(rawStoredProvider);
  const localProvider = config.normalizeOnscreenAgentLocalProvider(storedConfig.local_provider || storedConfig.localProvider);
  const storedApiKey = await decodeStoredApiKey(
    runtime,
    storedConfig.api_key || storedConfig.apiKey || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.apiKey || ""
  );
  const legacyDisplayMode =
    storedConfig.collapsed === true
      ? DISPLAY_MODE_COMPACT
      : storedConfig.collapsed === false
        ? DISPLAY_MODE_FULL
        : "";

  return {
    settings: {
      apiEndpoint: String(storedConfig.api_endpoint || storedConfig.apiEndpoint || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.apiEndpoint || "").trim(),
      apiKey: storedApiKey.value,
      huggingfaceDtype: String(
        storedConfig.huggingface_dtype ||
          storedConfig.huggingfaceDtype ||
          config.DEFAULT_ONSCREEN_AGENT_SETTINGS.huggingfaceDtype ||
          ""
      ).trim(),
      huggingfaceModel: String(
        storedConfig.huggingface_model ||
          storedConfig.huggingfaceModel ||
          config.DEFAULT_ONSCREEN_AGENT_SETTINGS.huggingfaceModel ||
          ""
      ).trim(),
      localProvider,
      maxTokens: config.normalizeOnscreenAgentMaxTokens(storedMaxTokens),
      model: String(storedConfig.model || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.model || "").trim(),
      paramsText: String(storedConfig.params || storedConfig.paramsText || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.paramsText || "").trim(),
      promptBudgetRatios: normalizeStoredPromptBudgetRatios(storedConfig),
      provider,
      supportsVision: config.normalizeOnscreenAgentSupportsVision(
        storedConfig.supports_vision ??
          storedConfig.supportsVision ??
          config.DEFAULT_ONSCREEN_AGENT_SETTINGS.supportsVision
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
    ).trim(),
    agentX: normalizeStoredCoordinate(rawX),
    agentY: normalizeStoredCoordinate(rawY),
    hiddenEdge: config.normalizeOnscreenAgentHiddenEdge(rawHiddenEdge),
    historyHeight: config.normalizeOnscreenAgentHistoryHeight(rawHistoryHeight),
    displayMode: storedDisplayMode || legacyDisplayMode || DISPLAY_MODE_COMPACT
  };
}

function normalizeStoredUiState(parsedState) {
  const storedState = parsedState && typeof parsedState === "object" ? parsedState : {};
  const rawX = storedState.agent_x ?? storedState.agentX;
  const rawY = storedState.agent_y ?? storedState.agentY;
  const rawHiddenEdge = storedState.hidden_edge ?? storedState.hiddenEdge;
  const rawHistoryHeight = storedState.history_height ?? storedState.historyHeight;
  const storedDisplayMode = normalizeDisplayMode(storedState.display_mode ?? storedState.displayMode);
  const legacyDisplayMode =
    storedState.collapsed === true
      ? DISPLAY_MODE_COMPACT
      : storedState.collapsed === false
        ? DISPLAY_MODE_FULL
        : "";

  return {
    agentX: normalizeStoredCoordinate(rawX),
    agentY: normalizeStoredCoordinate(rawY),
    hiddenEdge: config.normalizeOnscreenAgentHiddenEdge(rawHiddenEdge),
    historyHeight: config.normalizeOnscreenAgentHistoryHeight(rawHistoryHeight),
    displayMode: storedDisplayMode || legacyDisplayMode || DISPLAY_MODE_COMPACT,
    owner: normalizeUiStateOwner(storedState.owner || storedState.username)
  };
}

async function buildStoredConfigPayload(runtime, { settings, systemPrompt }) {
  const normalizedSystemPrompt = typeof systemPrompt === "string" ? systemPrompt.trim() : "";
  const payload = {
    api_endpoint: String(settings?.apiEndpoint || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.apiEndpoint || "").trim(),
    api_key: await encodeStoredApiKey(runtime, settings),
    huggingface_dtype: String(settings?.huggingfaceDtype || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.huggingfaceDtype || "").trim(),
    huggingface_model: String(settings?.huggingfaceModel || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.huggingfaceModel || "").trim(),
    local_provider: config.normalizeOnscreenAgentLocalProvider(settings?.localProvider),
    llm_provider: config.normalizeOnscreenAgentLlmProvider(settings?.provider),
    max_tokens: config.normalizeOnscreenAgentMaxTokens(settings?.maxTokens),
    model: String(settings?.model || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.model || "").trim(),
    params: String(settings?.paramsText || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.paramsText || "").trim(),
    prompt_budget_ratios: {
      history: config.normalizeOnscreenAgentPromptBudgetRatios(settings?.promptBudgetRatios).history,
      single_message: config.normalizeOnscreenAgentPromptBudgetRatios(settings?.promptBudgetRatios).singleMessage,
      system: config.normalizeOnscreenAgentPromptBudgetRatios(settings?.promptBudgetRatios).system,
      transient: config.normalizeOnscreenAgentPromptBudgetRatios(settings?.promptBudgetRatios).transient
    },
    supports_vision: config.normalizeOnscreenAgentSupportsVision(settings?.supportsVision)
  };

  if (normalizedSystemPrompt) {
    payload.custom_system_prompt = normalizedSystemPrompt;
  }

  return payload;
}

function buildStoredUiStatePayload({ agentX, agentY, hiddenEdge, historyHeight, displayMode, owner }) {
  const normalizedDisplayMode = normalizeDisplayMode(displayMode) || DISPLAY_MODE_COMPACT;
  const normalizedHiddenEdge = config.normalizeOnscreenAgentHiddenEdge(hiddenEdge);
  const normalizedHistoryHeight = config.normalizeOnscreenAgentHistoryHeight(historyHeight);
  const normalizedOwner = normalizeUiStateOwner(owner);
  const payload = {
    display_mode: normalizedDisplayMode,
    collapsed: normalizedDisplayMode === DISPLAY_MODE_COMPACT
  };

  if (normalizedOwner) {
    payload.owner = normalizedOwner;
  }

  if (typeof agentX === "number" && Number.isFinite(agentX)) {
    payload.agent_x = Math.round(agentX);
  }

  if (typeof agentY === "number" && Number.isFinite(agentY)) {
    payload.agent_y = Math.round(agentY);
  }

  if (normalizedHiddenEdge) {
    payload.hidden_edge = normalizedHiddenEdge;
  }

  if (normalizedHistoryHeight !== null) {
    payload.history_height = normalizedHistoryHeight;
  }

  return payload;
}

function getStorageArea(storageName) {
  const storageArea = globalThis[storageName];
  return storageArea && typeof storageArea.getItem === "function" && typeof storageArea.setItem === "function"
    ? storageArea
    : null;
}

function loadUiStateFromStorageArea(storageName, options = {}) {
  try {
    const storageArea = getStorageArea(storageName);
    const rawValue = storageArea?.getItem(config.ONSCREEN_AGENT_UI_STATE_STORAGE_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : null;
    const normalizedState = parsedValue && typeof parsedValue === "object" ? normalizeStoredUiState(parsedValue) : null;

    if (!normalizedState) {
      return null;
    }

    const expectedOwner = normalizeUiStateOwner(options.owner);

    if (!expectedOwner) {
      return options.allowUnowned === false ? null : normalizedState;
    }

    if (!normalizedState.owner) {
      return options.allowUnowned === false ? null : normalizedState;
    }

    return normalizedState.owner === expectedOwner ? normalizedState : null;
  } catch {
    return null;
  }
}

function persistUiStateToStorageArea(storageName, nextState) {
  try {
    const storageArea = getStorageArea(storageName);

    if (!storageArea) {
      return;
    }

    storageArea.setItem(
      config.ONSCREEN_AGENT_UI_STATE_STORAGE_KEY,
      JSON.stringify(buildStoredUiStatePayload(nextState))
    );
  } catch {
    // Ignore browser storage failures and keep the overlay usable.
  }
}

export async function loadOnscreenAgentConfig() {
  const runtime = getRuntime();
  const uiStateOwner = await getUiStateOwner(runtime);

  try {
    const result = await runtime.api.fileRead(config.ONSCREEN_AGENT_CONFIG_PATH);
    const normalizedConfig = await normalizeStoredConfig(
      runtime,
      runtime.utils.yaml.parse(String(result?.content || ""))
    );
    const storedUiState =
      loadUiStateFromStorageArea("sessionStorage", { owner: uiStateOwner }) ||
      loadUiStateFromStorageArea("localStorage", { owner: uiStateOwner }) ||
      normalizeStoredUiState(normalizedConfig);

    return {
      settings: normalizedConfig.settings,
      systemPrompt: normalizedConfig.systemPrompt,
      ...storedUiState,
      uiStateOwner,
      shouldCenterInitialPosition: false
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      const storedUiState =
        loadUiStateFromStorageArea("sessionStorage", { allowUnowned: false, owner: uiStateOwner }) ||
        loadUiStateFromStorageArea("localStorage", { allowUnowned: false, owner: uiStateOwner });
      const defaultConfig = createDefaultConfig();

      if (storedUiState) {
        return {
          settings: defaultConfig.settings,
          systemPrompt: defaultConfig.systemPrompt,
          ...storedUiState,
          uiStateOwner,
          shouldCenterInitialPosition: false
        };
      }

      // A missing per-user config with no owner-tagged UI state means first-run defaults for this load.
      return {
        ...defaultConfig,
        ...createDefaultUiState(),
        uiStateOwner,
        shouldCenterInitialPosition: true
      };
    }

    throw new Error(`Unable to load onscreen agent config: ${error.message}`);
  }
}

export async function saveOnscreenAgentConfig(nextConfig) {
  const runtime = getRuntime();
  const payload = await buildStoredConfigPayload(runtime, nextConfig);
  const content = runtime.utils.yaml.stringify(payload);

  try {
    await runtime.api.fileWrite(config.ONSCREEN_AGENT_CONFIG_PATH, content);
    if (nextConfig?.settings && typeof nextConfig.settings === "object") {
      nextConfig.settings.storedApiKeyLocked = false;
      nextConfig.settings.storedApiKeyValue = String(payload.api_key || "").trim();
    }
  } catch (error) {
    throw new Error(`Unable to save onscreen agent config: ${error.message}`);
  }
}

export function saveOnscreenAgentUiState(nextState) {
  persistUiStateToStorageArea("sessionStorage", nextState);
  persistUiStateToStorageArea("localStorage", nextState);
}

export async function loadOnscreenAgentHistory() {
  const runtime = getRuntime();

  try {
    const result = await runtime.api.fileRead(config.ONSCREEN_AGENT_HISTORY_PATH);
    const parsed = JSON.parse(String(result?.content || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    if (error instanceof SyntaxError) {
      throw new Error("Unable to load onscreen agent history: invalid JSON.");
    }

    throw new Error(`Unable to load onscreen agent history: ${error.message}`);
  }
}

export async function saveOnscreenAgentHistory(history) {
  const runtime = getRuntime();
  const content = `${JSON.stringify(Array.isArray(history) ? history : [], null, 2)}\n`;

  try {
    await runtime.api.fileWrite(config.ONSCREEN_AGENT_HISTORY_PATH, content);
  } catch (error) {
    throw new Error(`Unable to save onscreen agent history: ${error.message}`);
  }
}
