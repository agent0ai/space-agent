import * as config from "/mod/_core/admin/views/agent/config.js";
import * as agentApi from "/mod/_core/admin/views/agent/api.js";
import * as codexAuthFlow from "/mod/_core/openai_codex/auth_flow.js";
import * as codexModels from "/mod/_core/openai_codex/models.js";
import { discoverCodexModels } from "/mod/_core/openai_codex/models_discovery.js";
import {
  parseCodexTokens as parseAdminCodexTokensDraft,
  serializeCodexTokens as serializeAdminCodexTokensDraft
} from "/mod/_core/openai_codex/token_envelope.js";
import {
  installPromptItemAccess,
  rebalancePromptBudgetRatios
} from "/mod/_core/agent_prompt/prompt-items.js";
import * as execution from "/mod/_core/admin/views/agent/execution.js";
import * as llmParams from "/mod/_core/admin/views/agent/llm-params.js";
import * as prompt from "/mod/_core/admin/views/agent/prompt.js";
import * as skills from "/mod/_core/admin/views/agent/skills.js";
import * as storage from "/mod/_core/admin/views/agent/storage.js";
import * as agentView from "/mod/_core/admin/views/agent/view.js";
import {
  mapManagerStateToAdminState
} from "/mod/_core/admin/views/agent/huggingface.js";
import {
  normalizeAssistantEvaluationLogEntry,
  prependAssistantEvaluationLogs
} from "/mod/_core/agent-chat/assistant-message-evaluation.js";
import { DEFAULT_MODEL_INPUT, DTYPE_OPTIONS, normalizeHuggingFaceModelInput } from "/mod/_core/huggingface/helpers.js";
import { getHuggingFaceManager } from "/mod/_core/huggingface/manager.js";
import { closeDialog, openDialog } from "/mod/_core/visual/forms/dialog.js";
import { countTextTokens } from "/mod/_core/framework/js/token-count.js";
import {
  createAttachmentRuntime,
  createDraftAttachments,
  normalizeStoredAttachment,
  serializeAttachmentMetadata
} from "/mod/_core/admin/views/agent/attachments.js";

const huggingfaceManager = getHuggingFaceManager();

function normalizePromptBudgetSingleMessageRatio(
  value,
  fallback = config.DEFAULT_ADMIN_CHAT_SETTINGS.promptBudgetRatios.singleMessage
) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(parsedValue)));
}

function clonePromptBudgetRatios(value = {}) {
  return {
    ...config.normalizeAdminChatPromptBudgetRatios(value)
  };
}

function createAdminCodexLoginState() {
  return {
    deviceAuthId: "",
    error: "",
    status: codexAuthFlow.CODEX_AUTH_FLOW_STATUS.IDLE,
    userCode: "",
    verificationUrl: ""
  };
}

// Merge the live Codex catalog with the static fallback shipped in
// `models.js`. The runtime catalog wins when both have the same id so live
// descriptions and ordering are preserved; static-only entries trail the
// runtime ones so a user with a broken or empty discovery response still has
// something to pick.
function mergeAdminCodexModelCatalogs(runtimeCatalog, staticCatalog) {
  const runtime = Array.isArray(runtimeCatalog) ? runtimeCatalog : [];
  const staticList = Array.isArray(staticCatalog) ? staticCatalog : [];
  const seen = new Set();
  const merged = [];

  for (const entry of runtime) {
    if (!entry || typeof entry.id !== "string" || !entry.id) {
      continue;
    }

    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    merged.push({
      description: typeof entry.description === "string" ? entry.description : "",
      id: entry.id
    });
  }

  for (const entry of staticList) {
    if (!entry || typeof entry.id !== "string" || !entry.id) {
      continue;
    }

    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    merged.push({
      description: typeof entry.description === "string" ? entry.description : "",
      id: entry.id
    });
  }

  return merged;
}

function createPromptBudgetSegments(ratios = {}) {
  const normalizedRatios = clonePromptBudgetRatios(ratios);

  return [
    {
      colorClass: "prompt-budget-segment-system",
      key: "system",
      label: "System",
      value: normalizedRatios.system
    },
    {
      colorClass: "prompt-budget-segment-history",
      key: "history",
      label: "History",
      value: normalizedRatios.history
    },
    {
      colorClass: "prompt-budget-segment-transient",
      key: "transient",
      label: "Transient",
      value: normalizedRatios.transient
    }
  ];
}

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (!runtime.fw || typeof runtime.fw.createStore !== "function") {
    throw new Error("space.fw.createStore is not available.");
  }

  return runtime;
}

function ensureChatRuntime(targetRuntime) {
  const existingChatRuntime =
    targetRuntime.chat && typeof targetRuntime.chat === "object"
      ? targetRuntime.chat
      : targetRuntime.currentChat && typeof targetRuntime.currentChat === "object"
        ? targetRuntime.currentChat
        : {};

  targetRuntime.chat = existingChatRuntime;
  delete targetRuntime.currentChat;

  if (!Array.isArray(targetRuntime.chat.messages)) {
    targetRuntime.chat.messages = [];
  }

  if (!targetRuntime.chat.attachments || typeof targetRuntime.chat.attachments !== "object") {
    targetRuntime.chat.attachments = createAttachmentRuntime();
  }

  return installPromptItemAccess(targetRuntime.chat);
}

function createMessage(role, content, options = {}) {
  return {
    attachments: Array.isArray(options.attachments) ? options.attachments.slice() : [],
    content,
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: typeof options.kind === "string" ? options.kind : "",
    role
  };
}

function createStreamingAssistantMessage() {
  return {
    ...createMessage("assistant", ""),
    streaming: true
  };
}

function createRuntimeMessageSnapshot(message) {
  return {
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.map((attachment) => serializeAttachmentMetadata(attachment))
      : [],
    content: typeof message?.content === "string" ? message.content : "",
    id: typeof message?.id === "string" ? message.id : "",
    kind: typeof message?.kind === "string" ? message.kind : "",
    role: message?.role === "assistant" ? "assistant" : "user",
    streaming: message?.streaming === true
  };
}

function normalizeStoredMessage(message) {
  return {
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.map((attachment) => normalizeStoredAttachment(attachment))
      : [],
    content: typeof message?.content === "string" ? message.content : "",
    id:
      typeof message?.id === "string" && message.id
        ? message.id
        : `${message?.role || "message"}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: typeof message?.kind === "string" ? message.kind : "",
    role: message?.role === "assistant" ? "assistant" : "user",
    streaming: message?.streaming === true
  };
}

function findConversationInputMessage(history, assistantMessageId) {
  const assistantMessageIndex = history.findIndex((message) => message.id === assistantMessageId && message.role === "assistant");

  if (assistantMessageIndex === -1) {
    return null;
  }

  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    const message = history[index];

    if (message.role !== "user") {
      continue;
    }

    if (isExecutionFollowUpKind(message.kind)) {
      continue;
    }

    return message;
  }

  return null;
}

function formatPromptHistoryText(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return "";
  }

  return messages
    .map((message) => {
      const role = typeof message?.role === "string" ? message.role.toUpperCase() : "UNKNOWN";
      const content = typeof message?.content === "string" ? message.content : "";
      return `${role}:\n${content}`;
    })
    .join("\n\n");
}

function getAdminAgentErrorMessage(error, fallbackMessage = "Something went wrong.") {
  const errorMessage = typeof error?.message === "string" ? error.message.trim() : "";
  const fallback = typeof fallbackMessage === "string" ? fallbackMessage.trim() : "";
  return errorMessage || fallback || "Something went wrong.";
}

function logAdminAgentError(context, error) {
  console.error(`[admin-agent] ${context}`, error);
}

const MAX_PROTOCOL_RETRY_COUNT = 2;
const MAX_COMPACT_TRIM_ATTEMPTS = 4;
const CODEX_CATALOG_TTL_MS = 10 * 60 * 1000;

const evaluateAdminAssistantMessage = globalThis.space.extend(
  import.meta,
  async function evaluateAdminAssistantMessage(context = {}) {
    return {
      assistantContent: typeof context?.assistantContent === "string" ? context.assistantContent : "",
      history: Array.isArray(context?.history) ? context.history : [],
      logs: Array.isArray(context?.logs)
        ? context.logs.map((entry) => normalizeAssistantEvaluationLogEntry(entry)).filter(Boolean)
        : [],
      messageId: typeof context?.messageId === "string" ? context.messageId : "",
      store: context?.store || null
    };
  }
);

function isContextLengthError(error) {
  const msg = (error?.message || "").toLowerCase();
  return ["context", "token", "length", "maximum", "too long", "exceed"].some((pattern) => msg.includes(pattern));
}

// Trims the formatted history text by dropping the oldest message blocks so
// compaction retries keep the newest context and continuation state.
function trimHistoryTextToRecentMessages(text, targetFraction = 0.5) {
  const blocks = text.split(/\n\n(?=(?:USER|ASSISTANT):\n)/u);

  if (blocks.length <= 1) {
    const targetLength = Math.max(1, Math.floor(text.length * targetFraction));
    return text.slice(Math.max(0, text.length - targetLength));
  }

  const targetLength = Math.floor(text.length * targetFraction);
  let trimIndex = 0;
  let trimmed = text;

  while (trimIndex < blocks.length - 1 && trimmed.length > targetLength) {
    trimIndex += 1;
    trimmed = blocks.slice(trimIndex).join("\n\n");
  }

  return trimmed;
}

function isExecutionFollowUpKind(kind) {
  return kind === "execution-output" || kind === "execution-retry";
}

function buildEmptyAssistantRetryMessage() {
  return [
    "Protocol correction: your previous response was empty.",
    "Read the execution output above and continue.",
    "If another browser step is needed, execute again now.",
    "Otherwise provide the user-facing answer."
  ].join("\n");
}

function hasVerifiedEmptyAssistantResponse(streamResult) {
  return Boolean(streamResult?.responseMeta?.verifiedEmpty);
}

function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === 20));
}

function dataTransferContainsFiles(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }

  const items = Array.from(dataTransfer.items || []);

  if (items.some((item) => item?.kind === "file")) {
    return true;
  }

  const types = Array.from(dataTransfer.types || []);

  if (types.includes("Files")) {
    return true;
  }

  if (typeof dataTransfer.types?.contains === "function" && dataTransfer.types.contains("Files")) {
    return true;
  }

  return Number(dataTransfer.files?.length) > 0;
}

function createEmptyHuggingFaceState() {
  return mapManagerStateToAdminState(huggingfaceManager.getSnapshot());
}

function summarizeAdminAgentLlmSelection(settings, huggingfaceState) {
  const provider = config.normalizeAdminChatLlmProvider(settings?.provider);

  if (provider === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
    const activeModelId = typeof huggingfaceState?.activeModelId === "string" ? huggingfaceState.activeModelId.trim() : "";
    const configuredModelId = normalizeHuggingFaceModelInput(settings?.huggingfaceModel || "");
    return configuredModelId || activeModelId || "No model";
  }

  if (provider === config.ADMIN_CHAT_LLM_PROVIDER.CODEX) {
    return codexModels.normalizeCodexModelId(settings?.codexModel);
  }

  return agentView.summarizeLlmConfig(settings?.apiEndpoint || "", settings?.model || "");
}

function isHuggingFaceSelectionMatch(left = {}, right = {}) {
  return (
    normalizeHuggingFaceModelInput(left?.modelId || left?.modelInput || "") === normalizeHuggingFaceModelInput(right?.modelId || right?.modelInput || "")
    && String(left?.dtype || "").trim() === String(right?.dtype || "").trim()
  );
}

function getHuggingFaceSelectionValue(modelId, dtype) {
  return config.createAdminChatHuggingFaceSelectionValue(modelId, dtype);
}

function parseHuggingFaceSelectionValue(value) {
  return config.parseAdminChatHuggingFaceSelectionValue(value);
}

function getConfiguredLocalProviderLabel() {
  return "Hugging Face";
}

const model = {
  activeRequestController: null,
  attachmentDragDepth: 0,
  chatRuntime: null,
  defaultSystemPrompt: "",
  draft: "",
  draftAttachments: [],
  executionContext: null,
  executionOutputOverrides: Object.create(null),
  history: [],
  historyText: "",
  historyTokenCount: 0,
  historyPersistPromise: null,
  initializationPromise: null,
  isAttachmentDragActive: false,
  isCompactingHistory: false,
  isInitialized: false,
  isLoadingDefaultSystemPrompt: false,
  isSending: false,
  pendingHistorySnapshot: null,
  pendingStreamingMessage: null,
  promptInput: null,
  promptHistoryText: "",
  promptHistoryMessages: [],
  promptHistoryMode: "text",
  promptHistoryTitle: "Prompt History",
  promptRuntime: null,
  queuedSubmissions: [],
  rawOutputContent: "",
  rawOutputTitle: "Raw LLM Output",
  refs: {
    attachmentInput: null,
    historyDialog: null,
    input: null,
    rawDialog: null,
    scroller: null,
    settingsDialog: null,
    systemDialog: null,
    thread: null
  },
  rerunningMessageId: "",
  runtime: null,
  codexCatalogFetchedAt: 0,
  codexCatalogPromise: null,
  codexLoginAbortController: null,
  codexLoginState: createAdminCodexLoginState(),
  codexRuntimeCatalog: [],
  settings: {
    apiEndpoint: "",
    apiKey: "",
    codexModel: config.DEFAULT_ADMIN_CHAT_SETTINGS.codexModel,
    codexTokens: "",
    huggingfaceDtype: config.DEFAULT_ADMIN_CHAT_SETTINGS.huggingfaceDtype,
    huggingfaceModel: "",
    localProvider: config.DEFAULT_ADMIN_CHAT_SETTINGS.localProvider,
    maxTokens: config.DEFAULT_ADMIN_CHAT_SETTINGS.maxTokens,
    model: "",
    paramsText: "",
    promptBudgetRatios: { ...config.DEFAULT_ADMIN_CHAT_SETTINGS.promptBudgetRatios },
    provider: config.DEFAULT_ADMIN_CHAT_SETTINGS.provider,
    storedCodexTokensLocked: false,
    storedCodexTokensValue: ""
  },
  settingsDraft: {
    apiEndpoint: "",
    apiKey: "",
    codexModel: config.DEFAULT_ADMIN_CHAT_SETTINGS.codexModel,
    codexTokens: "",
    huggingfaceDtype: config.DEFAULT_ADMIN_CHAT_SETTINGS.huggingfaceDtype,
    huggingfaceModel: "",
    localProvider: config.DEFAULT_ADMIN_CHAT_SETTINGS.localProvider,
    maxTokens: config.DEFAULT_ADMIN_CHAT_SETTINGS.maxTokens,
    model: "",
    paramsText: "",
    promptBudgetRatios: { ...config.DEFAULT_ADMIN_CHAT_SETTINGS.promptBudgetRatios },
    provider: config.DEFAULT_ADMIN_CHAT_SETTINGS.provider,
    storedCodexTokensLocked: false,
    storedCodexTokensValue: ""
  },
  status: "Loading admin agent...",
  stopRequested: false,
  streamingRenderFrame: 0,
  systemPrompt: "",
  systemPromptDraft: "",
  runtimePromptContext: null,
  runtimeSystemPrompt: "",
  huggingface: createEmptyHuggingFaceState(),
  huggingfaceManagerUnsubscribe: null,
  windowFocusHandler: null,

  get composerPlaceholder() {
    const statusText = typeof this.status === "string" ? this.status.trim() : "";

    if (!statusText) {
      return "Message Admin agent...";
    }

    return statusText === "Ready." ? "Ready. Message Admin agent..." : statusText;
  },

  reportError(context, error, options = {}) {
    const message = getAdminAgentErrorMessage(error, options.fallbackMessage);
    logAdminAgentError(context, error);

    if (options.preserveStatus !== true) {
      this.status = message;
    }

    return message;
  },

  get isComposerInputDisabled() {
    return !this.isInitialized || this.isCompactingHistory;
  },

  get hasDraftSubmission() {
    return Boolean(this.draft.trim() || this.draftAttachments.length);
  },

  get hasQueuedSubmission() {
    return this.queuedSubmissions.length > 0;
  },

  get queuedSubmissionCount() {
    return this.queuedSubmissions.length;
  },

  get canQueueSubmissionWhileBusy() {
    return (
      this.isSending &&
      !this.isLoadingDefaultSystemPrompt &&
      !this.isCompactingHistory &&
      this.hasDraftSubmission
    );
  },

  get isComposerSubmitDisabled() {
    return (
      !this.isInitialized ||
      this.isLoadingDefaultSystemPrompt ||
      this.isCompactingHistory ||
      (!this.isSending && !this.hasDraftSubmission) ||
      (this.isSending && !this.canQueueSubmissionWhileBusy)
    );
  },

  get isCompactDisabled() {
    return (
      !this.isInitialized ||
      this.isSending ||
      this.isLoadingDefaultSystemPrompt ||
      this.isCompactingHistory ||
      !this.historyText.trim()
    );
  },

  get llmSummary() {
    return summarizeAdminAgentLlmSelection(this.settings, this.huggingface);
  },

  get isSettingsDraftUsingApiProvider() {
    return config.normalizeAdminChatLlmProvider(this.settingsDraft.provider) === config.ADMIN_CHAT_LLM_PROVIDER.API;
  },

  get isSettingsDraftUsingLocalProvider() {
    return config.normalizeAdminChatLlmProvider(this.settingsDraft.provider) === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL;
  },

  get isSettingsDraftUsingCodexProvider() {
    return config.normalizeAdminChatLlmProvider(this.settingsDraft.provider) === config.ADMIN_CHAT_LLM_PROVIDER.CODEX;
  },

  get codexModelCatalog() {
    return mergeAdminCodexModelCatalogs(this.codexRuntimeCatalog, codexModels.CODEX_MODEL_CATALOG);
  },

  get isCodexSelectedModelInCatalog() {
    const selected = typeof this.settingsDraft?.codexModel === "string"
      ? this.settingsDraft.codexModel.trim()
      : "";

    if (!selected) {
      return true;
    }

    return this.codexModelCatalog.some((entry) => entry.id === selected);
  },

  get isCodexLoginActive() {
    return this.codexLoginState.status === codexAuthFlow.CODEX_AUTH_FLOW_STATUS.STARTING ||
      this.codexLoginState.status === codexAuthFlow.CODEX_AUTH_FLOW_STATUS.PENDING;
  },

  get hasCodexTokens() {
    const parsed = parseAdminCodexTokensDraft(this.settingsDraft?.codexTokens);
    return Boolean(parsed?.accessToken);
  },

  get codexVerificationUrl() {
    return this.codexLoginState.verificationUrl || "";
  },

  get codexUserCode() {
    return this.codexLoginState.userCode || "";
  },

  get codexLoginError() {
    return this.codexLoginState.error || "";
  },

  get codexAccountIdSummary() {
    const parsed = parseAdminCodexTokensDraft(this.settingsDraft?.codexTokens);
    return parsed?.accountId || "";
  },

  get huggingfaceSavedModels() {
    return Array.isArray(this.huggingface.savedModels) ? this.huggingface.savedModels : [];
  },

  get hasSavedHuggingFaceModels() {
    return this.huggingfaceSavedModels.length > 0;
  },

  get adminSelectedHuggingFaceModelLabel() {
    const selectedModelId = normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "");
    const selectedDtype = String(this.settingsDraft.huggingfaceDtype || "").trim();

    if (!selectedModelId) {
      return "No model selected";
    }

    return selectedDtype ? `${selectedModelId} · ${selectedDtype}` : selectedModelId;
  },

  get huggingfaceDtypeOptions() {
    return DTYPE_OPTIONS;
  },

  get huggingfaceLoadProgressPercent() {
    return Math.max(0, Math.min(100, Math.round(Number(this.huggingface.loadProgress?.progress || 0) * 100)));
  },

  get huggingfaceStatusBadgeText() {
    if (!this.huggingface.webgpuSupported) {
      return "Unavailable";
    }

    if (this.huggingface.error) {
      return "Error";
    }

    if (this.huggingface.isWorkerBooting && !this.huggingface.isLoadingModel) {
      return "Starting";
    }

    if (this.huggingface.isLoadingModel) {
      return this.huggingface.loadProgress?.status === "download" ? "Downloading" : "Loading";
    }

    if (this.huggingface.activeModelId) {
      return "Ready";
    }

    return "Idle";
  },

  get huggingfaceStatusTone() {
    if (!this.huggingface.webgpuSupported) {
      return "is-error";
    }

    if (this.huggingface.error) {
      return "is-error";
    }

    if (this.huggingface.isLoadingModel || this.huggingface.isWorkerBooting) {
      return "is-loading";
    }

    if (this.huggingface.activeModelId) {
      return "is-ready";
    }

    return "is-idle";
  },

  get huggingfaceSelectedModelStatusText() {
    const selectedModelId = normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "");
    const selectedDtype = String(this.settingsDraft.huggingfaceDtype || "").trim();

    if (!this.huggingface.webgpuSupported) {
      return "WebGPU is unavailable in this browser.";
    }

    if (this.huggingface.isLoadingModel) {
      return this.huggingface.loadProgress.text || this.huggingface.statusText || "Loading selected model...";
    }

    if (this.huggingface.isWorkerBooting) {
      return "Starting Hugging Face runtime...";
    }

    if (this.huggingface.error) {
      return this.huggingface.error;
    }

    if (!selectedModelId || !selectedDtype) {
      return this.hasSavedHuggingFaceModels
        ? "Choose a saved model or enter a new Hugging Face repo id."
        : "Enter a Hugging Face repo id or pick a saved model.";
    }

    if (
      this.huggingface.activeModelId === selectedModelId
      && this.huggingface.activeDtype === selectedDtype
    ) {
      return "Loaded locally and ready for admin chat.";
    }

    if (this.huggingface.activeModelId) {
      return `Loaded model: ${this.huggingface.activeModelId}`;
    }

    if (this.isSavedHuggingFaceModel(selectedModelId, selectedDtype)) {
      return "Click Load to reuse this browser-cached model.";
    }

    return "Click Download and load to fetch this model into the browser, or save and let the first message load it.";
  },

  get huggingfaceCurrentModelLabel() {
    return this.huggingface.loadingModelLabel || this.huggingface.activeModelId || "None loaded";
  },

  get adminHuggingFaceCurrentModelActionLabel() {
    return this.huggingface.isLoadingModel ? "Stop" : "Unload";
  },

  get adminHuggingFaceSelectedModelActionLabel() {
    const selectedModelId = normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "");
    const selectedDtype = String(this.settingsDraft.huggingfaceDtype || "").trim();

    if (this.huggingface.isLoadingModel) {
      return "Stop";
    }

    if (!selectedModelId || !selectedDtype) {
      return "Load";
    }

    if (
      selectedModelId
      && selectedDtype
      && this.huggingface.activeModelId === selectedModelId
      && this.huggingface.activeDtype === selectedDtype
    ) {
      return "Unload";
    }

    if (this.isSavedHuggingFaceModel(selectedModelId, selectedDtype)) {
      return "Load";
    }

    return "Download and load";
  },

  get canAdminActOnSelectedHuggingFaceModel() {
    if (!this.huggingface.webgpuSupported || this.isSending) {
      return false;
    }

    if (this.huggingface.isLoadingModel) {
      return true;
    }

    return Boolean(
      normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "")
      && String(this.settingsDraft.huggingfaceDtype || "").trim()
    );
  },

  get canAdminUnloadHuggingFaceModel() {
    return Boolean(
      !this.isSending
      && (this.huggingface.isWorkerReady || this.huggingface.isLoadingModel)
      && (this.huggingface.activeModelId || this.huggingface.isLoadingModel)
    );
  },

  get promptSummary() {
    return agentView.summarizeSystemPrompt(this.systemPrompt);
  },

  get historyTokenSummary() {
    return `${config.formatAdminChatTokenCount(this.historyTokenCount)} tokens`;
  },

  get settingsDraftPromptBudgetRatios() {
    return clonePromptBudgetRatios(this.settingsDraft.promptBudgetRatios);
  },

  get settingsDraftPromptBudgetSegments() {
    return createPromptBudgetSegments(this.settingsDraft.promptBudgetRatios);
  },

  get isAttachmentPickerDisabled() {
    return !this.isInitialized || this.isLoadingDefaultSystemPrompt || this.isCompactingHistory;
  },

  get isPrimaryActionDisabled() {
    if (!this.isInitialized || this.isLoadingDefaultSystemPrompt || this.isCompactingHistory) {
      return true;
    }

    if (!this.isSending) {
      return !this.hasDraftSubmission;
    }

    if (this.canQueueSubmissionWhileBusy) {
      return false;
    }

    return this.hasQueuedSubmission;
  },

  get primaryActionIcon() {
    if (this.isSending) {
      if (this.canQueueSubmissionWhileBusy) {
        return "arrow_upward";
      }

      if (this.hasQueuedSubmission) {
        return "progress_activity";
      }

      return "stop";
    }

    return "arrow_upward";
  },

  get primaryActionLabel() {
    if (this.isSending) {
      if (this.canQueueSubmissionWhileBusy) {
        return this.hasQueuedSubmission ? "Add message to queue" : "Queue message for next step";
      }

      if (this.hasQueuedSubmission) {
        return this.queuedSubmissionCount === 1
          ? "1 message queued for next step"
          : `${this.queuedSubmissionCount} messages queued for next steps`;
      }

      return "Stop current loop";
    }

    return "Send message";
  },

  get primaryActionButtonText() {
    if (this.isSending) {
      if (this.canQueueSubmissionWhileBusy) {
        return "Queue";
      }

      if (this.hasQueuedSubmission) {
        return this.queuedSubmissionCount === 1 ? "Queued 1" : `Queued ${this.queuedSubmissionCount}`;
      }

      return "Stop";
    }

    return "Send";
  },

  get isPrimaryActionBusy() {
    return this.isSending && this.hasQueuedSubmission && !this.canQueueSubmissionWhileBusy;
  },

  get isPrimaryActionStop() {
    return this.isSending && !this.hasQueuedSubmission && !this.canQueueSubmissionWhileBusy;
  },

  get compactButtonIcon() {
    return this.isCompactingHistory ? "progress_activity" : "compress";
  },

  get promptHistoryContent() {
    if (this.promptHistoryMode === "json") {
      return JSON.stringify(this.promptHistoryMessages, null, 2);
    }

    return formatPromptHistoryText(this.promptHistoryMessages);
  },

  get promptHistorySections() {
    if (!Array.isArray(this.promptHistoryMessages) || !this.promptHistoryMessages.length) {
      return [];
    }

    return this.promptHistoryMessages.map((message) => ({
      content: typeof message?.content === "string" ? message.content : "",
      role: typeof message?.role === "string" ? message.role.toUpperCase() : "UNKNOWN",
      tokenCountLabel: `${config.formatAdminChatTokenCount(
        Number.isFinite(Number(message?.tokenCount))
          ? Math.max(0, Math.floor(Number(message.tokenCount)))
          : countTextTokens(typeof message?.content === "string" ? message.content : "")
      )} tokens`
    }));
  },

  async ensureHuggingFaceSubscription() {
    if (this.huggingfaceManagerUnsubscribe) {
      this.syncHuggingFaceFromManager();
      return huggingfaceManager;
    }

    this.huggingfaceManagerUnsubscribe = huggingfaceManager.subscribe((snapshot) => {
      this.huggingface = mapManagerStateToAdminState(snapshot);
    });
    this.syncHuggingFaceFromManager();
    return huggingfaceManager;
  },

  syncHuggingFaceFromManager() {
    this.huggingface = mapManagerStateToAdminState(huggingfaceManager.getSnapshot());
    return this.huggingface;
  },

  prefillSettingsDraftDefaultHuggingFaceModel() {
    if (normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "")) {
      return false;
    }

    const preferredSavedModel = huggingfaceManager.refreshPreferredSavedModelSelection();

    if (preferredSavedModel?.modelId && preferredSavedModel?.dtype) {
      this.settingsDraft = {
        ...this.settingsDraft,
        huggingfaceDtype: preferredSavedModel.dtype,
        huggingfaceModel: preferredSavedModel.modelId
      };
      return true;
    }

    const snapshot = huggingfaceManager.getSnapshot();
    const hasSavedModels = Array.isArray(snapshot.savedModels) && snapshot.savedModels.length > 0;
    const activeModelId = normalizeHuggingFaceModelInput(snapshot.activeModelId || "");
    const defaultModelInput = normalizeHuggingFaceModelInput(snapshot.modelInput || "");

    if (hasSavedModels || activeModelId || snapshot.isLoadingModel || defaultModelInput !== DEFAULT_MODEL_INPUT) {
      return false;
    }

    this.settingsDraft = {
      ...this.settingsDraft,
      huggingfaceModel: DEFAULT_MODEL_INPUT
    };
    return true;
  },

  async ensureActiveLocalRuntime() {
    await this.ensureHuggingFaceSubscription();
    return null;
  },

  hasConfiguredLocalModel(settings = this.settings) {
    if (config.normalizeAdminChatLlmProvider(settings?.provider) !== config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
      return false;
    }

    return Boolean(
      normalizeHuggingFaceModelInput(settings?.huggingfaceModel || "")
      && String(settings?.huggingfaceDtype || "").trim()
    );
  },

  async autoLoadConfiguredLocalModel(settings = this.settings) {
    if (!this.hasConfiguredLocalModel(settings)) {
      return false;
    }

    await this.ensureActiveLocalRuntime(settings);

    const selectedModelId = normalizeHuggingFaceModelInput(settings?.huggingfaceModel || "");
    const selectedDtype = String(settings?.huggingfaceDtype || "").trim();

    if (!selectedModelId || !selectedDtype) {
      return false;
    }

    this.status = this.isSavedHuggingFaceModel(selectedModelId, selectedDtype)
      ? `Loading ${selectedModelId} for local admin chat...`
      : `Downloading and loading ${selectedModelId} for local admin chat...`;
    await huggingfaceManager.ensureModelLoaded({
      dtype: selectedDtype,
      modelId: selectedModelId,
      modelInput: selectedModelId
    });
    this.syncHuggingFaceFromManager();
    this.status = `Local ${getConfiguredLocalProviderLabel(settings)} ready.`;
    return true;
  },

  isConfiguredLocalModelReady(settings = this.settings) {
    const provider = config.normalizeAdminChatLlmProvider(settings?.provider);

    if (provider !== config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
      return false;
    }

    const selectedModelId = normalizeHuggingFaceModelInput(settings?.huggingfaceModel || "");
    const selectedDtype = String(settings?.huggingfaceDtype || "").trim();

    return Boolean(
      selectedModelId
      && selectedDtype
      && this.huggingface.isWorkerReady
      && !this.huggingface.isLoadingModel
      && this.huggingface.activeModelId === selectedModelId
      && this.huggingface.activeDtype === selectedDtype
    );
  },

  isSavedHuggingFaceModel(modelId, dtype) {
    const normalizedSelection = {
      dtype: String(dtype || "").trim(),
      modelId: String(modelId || "").trim()
    };

    return this.huggingfaceSavedModels.some((entry) => isHuggingFaceSelectionMatch(entry, normalizedSelection));
  },

  async refreshHuggingFaceCatalog() {
    await this.ensureHuggingFaceSubscription();
    huggingfaceManager.refreshSavedModels();
    this.syncHuggingFaceFromManager();
    return this.huggingfaceSavedModels;
  },

  async warmSettingsDraftLocalProvider() {
    if (!this.isSettingsDraftUsingLocalProvider) {
      return false;
    }

    await this.refreshHuggingFaceCatalog();
    this.prefillSettingsDraftDefaultHuggingFaceModel();
    return true;
  },

  async init() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      this.runtime = getRuntime();
      this.chatRuntime = ensureChatRuntime(this.runtime);
      this.executionContext = execution.createExecutionContext({
        targetWindow: window
      });
      this.syncCurrentChatRuntime();
      skills.installAdminSkillRuntime();

      try {
        const [config, storedHistory] = await Promise.all([
          storage.loadAdminChatConfig(),
          storage.loadAdminChatHistory()
        ]);

        this.settings = {
          ...config.settings,
          promptBudgetRatios: clonePromptBudgetRatios(config.settings?.promptBudgetRatios)
        };
        this.settingsDraft = {
          ...this.settings,
          promptBudgetRatios: clonePromptBudgetRatios(this.settings.promptBudgetRatios)
        };
        this.systemPrompt = config.systemPrompt;
        this.systemPromptDraft = config.systemPrompt;
        await this.replaceHistory(
          storedHistory.map((message) => normalizeStoredMessage(message)),
          {
            refreshPrompt: false
          }
        );

        this.status = "Loading default system prompt...";
        this.isLoadingDefaultSystemPrompt = true;

        await this.ensureDefaultSystemPrompt({
          preserveStatus: true
        });
        this.systemPrompt = prompt.extractCustomAdminSystemPrompt(this.systemPrompt, this.defaultSystemPrompt);
        this.systemPromptDraft = this.systemPrompt;
        await this.rebuildPromptInput();

        this.isInitialized = true;
        this.status = "Ready.";
        this.render();
        this.focusInput();

        if (this.hasConfiguredLocalModel(this.settings)) {
          void this.autoLoadConfiguredLocalModel(this.settings).catch((error) => {
            this.reportError("preloading the configured local model", error);
          });
        }
      } catch (error) {
        this.reportError("initializing the admin runtime", error);
        this.render();
      }
    })();

    return this.initializationPromise;
  },

  mount(refs = {}) {
    this.refs = {
      attachmentInput: refs.attachmentInput || null,
      historyDialog: refs.historyDialog || null,
      input: refs.input || null,
      rawDialog: refs.rawDialog || null,
      scroller: refs.scroller || null,
      settingsDialog: refs.settingsDialog || null,
      systemDialog: refs.systemDialog || null,
      thread: refs.thread || null
    };

    if (this.refs.input) {
      this.refs.input.value = this.draft;
      agentView.autoResizeTextarea(this.refs.input);
    }

    if (!this.windowFocusHandler) {
      this.windowFocusHandler = () => {
        if (this.huggingfaceManagerUnsubscribe) {
          void this.refreshHuggingFaceCatalog();
        }
      };
      window.addEventListener("focus", this.windowFocusHandler);
    }

    this.render();
    void this.init();
  },

  unmount() {
    this.cancelStreamingMessageRender();
    this.resetAttachmentDragState();
    if (this.windowFocusHandler) {
      window.removeEventListener("focus", this.windowFocusHandler);
      this.windowFocusHandler = null;
    }
    this.huggingfaceManagerUnsubscribe?.();
    this.huggingfaceManagerUnsubscribe = null;
    this.huggingface = createEmptyHuggingFaceState();
    this.refs = {
      attachmentInput: null,
      historyDialog: null,
      input: null,
      rawDialog: null,
      scroller: null,
      settingsDialog: null,
      systemDialog: null,
      thread: null
    };
  },

  async ensureDefaultSystemPrompt(options = {}) {
    const preserveStatus = options.preserveStatus === true;

    if (!this.defaultSystemPrompt || options.forceRefresh === true) {
      this.isLoadingDefaultSystemPrompt = true;

      try {
        this.defaultSystemPrompt = await prompt.fetchDefaultAdminSystemPrompt({
          forceRefresh: options.forceRefresh
        });
      } finally {
        this.isLoadingDefaultSystemPrompt = false;
      }
    }

    if (!preserveStatus) {
      this.status = "Ready.";
    }

    return this.defaultSystemPrompt;
  },

  ensurePromptRuntime() {
    if (!this.promptRuntime) {
      this.promptRuntime = prompt.createAdminPromptInstance();
    }

    return this.promptRuntime;
  },

  getPromptTransientSections() {
    const transientSections = this.chatRuntime?.transient?.list?.();
    return Array.isArray(transientSections) ? transientSections : [];
  },

  getPromptBuildOptions() {
    return {
      maxTokens: this.getConfiguredMaxTokens(),
      promptBudgetRatios: clonePromptBudgetRatios(this.settings.promptBudgetRatios)
    };
  },

  applyPromptInput(promptInput) {
    const normalizedPromptInput = promptInput && typeof promptInput === "object" ? promptInput : null;

    this.promptInput = normalizedPromptInput;
    this.runtimePromptContext = normalizedPromptInput;
    this.runtimeSystemPrompt =
      typeof normalizedPromptInput?.systemPrompt === "string" ? normalizedPromptInput.systemPrompt : "";
    this.historyText = formatPromptHistoryText(normalizedPromptInput?.historyMessages);
    this.promptHistoryMessages = Array.isArray(normalizedPromptInput?.requestMessages)
      ? normalizedPromptInput.requestMessages.map((message) => ({ ...message }))
      : [];
    this.promptHistoryText = formatPromptHistoryText(this.promptHistoryMessages);
    this.historyTokenCount = countTextTokens(this.promptHistoryText);

    if (typeof this.chatRuntime?.__setPromptItems === "function") {
      this.chatRuntime.__setPromptItems(
        Array.isArray(normalizedPromptInput?.promptItems)
          ? normalizedPromptInput.promptItems.map((item) => ({ ...item }))
          : []
      );
    }

    return normalizedPromptInput;
  },

  async rebuildPromptInput(options = {}) {
    const history = Array.isArray(options.history) ? options.history : this.history;
    const promptInput = await this.ensurePromptRuntime().build({
      defaultSystemPrompt: this.defaultSystemPrompt,
      historyMessages: history,
      options: this.getPromptBuildOptions(),
      systemPrompt: this.systemPrompt,
      transientSections: this.getPromptTransientSections()
    });

    this.applyPromptInput(promptInput);
    return promptInput;
  },

  async refreshPromptInputFromHistory(history = this.history) {
    const promptInput = await this.ensurePromptRuntime().updateHistory(history, {
      defaultSystemPrompt: this.defaultSystemPrompt,
      options: this.getPromptBuildOptions(),
      systemPrompt: this.systemPrompt,
      transientSections: this.getPromptTransientSections()
    });

    this.applyPromptInput(promptInput);
    return promptInput;
  },

  async preparePromptRequest(history = this.history) {
    const promptInput = await prompt.buildAdminPromptInput({
      defaultSystemPrompt: this.defaultSystemPrompt,
      historyMessages: history,
      options: this.getPromptBuildOptions(),
      promptInstance: this.ensurePromptRuntime(),
      systemPrompt: this.systemPrompt,
      transientSections: this.getPromptTransientSections()
    });

    return {
      messages: Array.isArray(promptInput?.requestMessages)
        ? promptInput.requestMessages.map((message) => ({ ...message }))
        : [],
      promptInput,
      systemPrompt: typeof promptInput?.systemPrompt === "string" ? promptInput.systemPrompt : ""
    };
  },

  async refreshRuntimeSystemPrompt(history = this.history) {
    await this.refreshPromptInputFromHistory(history);
    return this.runtimeSystemPrompt;
  },

  syncCurrentChatRuntime() {
    if (!this.chatRuntime) {
      return;
    }

    this.chatRuntime.messages = this.history.map((message) => createRuntimeMessageSnapshot(message));
  },

  async replaceHistory(nextHistory, options = {}) {
    this.history = Array.isArray(nextHistory) ? [...nextHistory] : [];
    this.syncCurrentChatRuntime();

    if (options.refreshPrompt === false || (!this.defaultSystemPrompt && !this.promptInput)) {
      return;
    }

    await this.refreshHistoryMetrics();
  },

  async refreshHistoryMetrics(options = {}) {
    const history = Array.isArray(options.history) ? options.history : this.history;

    if (!this.defaultSystemPrompt && !this.promptInput) {
      this.historyText = formatPromptHistoryText(history);
      this.promptHistoryText = this.historyText;
      this.promptHistoryMessages = [];
      this.historyTokenCount = countTextTokens(this.promptHistoryText);
      this.chatRuntime?.__clearPromptItems?.();
      return null;
    }

    return this.refreshPromptInputFromHistory(history);
  },

  getConfiguredMaxTokens() {
    return config.normalizeAdminChatMaxTokens(this.settings.maxTokens);
  },

  isHistoryOverConfiguredMaxTokens() {
    return Boolean(this.historyText.trim()) && this.historyTokenCount > this.getConfiguredMaxTokens();
  },

  serializeHistory() {
    return this.history.map((message) => ({
      attachments: Array.isArray(message.attachments)
        ? message.attachments.map((attachment) => serializeAttachmentMetadata(attachment))
        : [],
      content: message.content,
      id: message.id,
      kind: message.kind || "",
      role: message.role
    }));
  },

  async flushHistoryPersistence() {
    if (this.historyPersistPromise) {
      return this.historyPersistPromise;
    }

    this.historyPersistPromise = (async () => {
      while (this.pendingHistorySnapshot) {
        const snapshot = this.pendingHistorySnapshot;
        this.pendingHistorySnapshot = null;
        await storage.saveAdminChatHistory(snapshot);
      }
    })()
      .catch((error) => {
        this.reportError("persisting admin chat history", error);
      })
      .finally(() => {
        this.historyPersistPromise = null;

        if (this.pendingHistorySnapshot) {
          void this.flushHistoryPersistence();
        }
      });

    return this.historyPersistPromise;
  },

  async persistHistory(options = {}) {
    this.syncCurrentChatRuntime();
    this.pendingHistorySnapshot = this.serializeHistory();
    const flushPromise = this.flushHistoryPersistence();

    if (options.immediate === true) {
      await flushPromise;

      if (this.pendingHistorySnapshot) {
        await this.flushHistoryPersistence();
      }
    }
  },

  cancelStreamingMessageRender() {
    if (this.streamingRenderFrame) {
      window.cancelAnimationFrame(this.streamingRenderFrame);
      this.streamingRenderFrame = 0;
    }

    this.pendingStreamingMessage = null;
  },

  scheduleStreamingMessageRender(message) {
    if (!message || message.role !== "assistant" || message.streaming !== true) {
      return;
    }

    this.pendingStreamingMessage = message;

    if (this.streamingRenderFrame) {
      return;
    }

    this.streamingRenderFrame = window.requestAnimationFrame(() => {
      this.streamingRenderFrame = 0;
      const pendingMessage = this.pendingStreamingMessage;
      this.pendingStreamingMessage = null;

      if (!pendingMessage || !this.refs.thread) {
        return;
      }

      agentView.updateStreamingAssistantMessage(this.refs.thread, pendingMessage, {
        scroller: this.refs.scroller
      });
    });
  },

  render(options = {}) {
    agentView.renderMessages(this.refs.thread, this.history, {
      isConversationBusy: this.isSending,
      outputOverrides: this.executionOutputOverrides,
      preserveScroll: options.preserveScroll === true,
      queuedMessages: this.getQueuedPreviewMessages(),
      rerunningMessageId: this.rerunningMessageId,
      scroller: this.refs.scroller
    });
  },

  focusInput() {
    const input = this.refs.input;

    if (!input || input.disabled) {
      return;
    }

    window.requestAnimationFrame(() => {
      try {
        input.focus({
          preventScroll: true
        });
      } catch {
        input.focus();
      }

      if (typeof input.setSelectionRange === "function") {
        const cursorPosition = input.value.length;
        input.setSelectionRange(cursorPosition, cursorPosition);
      }
    });
  },

  syncDraft(value) {
    this.draft = value;

    if (this.refs.input) {
      agentView.autoResizeTextarea(this.refs.input);
    }
  },

  clearComposerDraft() {
    this.draft = "";
    this.draftAttachments = [];

    if (this.refs.input) {
      this.refs.input.value = "";
      agentView.autoResizeTextarea(this.refs.input);
    }

    if (this.refs.attachmentInput) {
      this.refs.attachmentInput.value = "";
    }
  },

  resetAttachmentDragState() {
    this.attachmentDragDepth = 0;
    this.isAttachmentDragActive = false;
  },

  appendDraftAttachments(files) {
    const nextAttachments = createDraftAttachments(files);

    if (!nextAttachments.length) {
      return false;
    }

    const existingKeys = new Set(
      this.draftAttachments.map(
        (attachment) =>
          `${attachment.name}::${attachment.size}::${attachment.lastModified}::${attachment.type}`
      )
    );
    const uniqueAttachments = nextAttachments.filter((attachment) => {
      const key = `${attachment.name}::${attachment.size}::${attachment.lastModified}::${attachment.type}`;

      if (existingKeys.has(key)) {
        return false;
      }

      existingKeys.add(key);
      return true;
    });

    if (!uniqueAttachments.length) {
      return false;
    }

    this.draftAttachments = [...this.draftAttachments, ...uniqueAttachments];
    this.render({
      preserveScroll: true
    });
    this.status = `${this.draftAttachments.length} attachment${
      this.draftAttachments.length === 1 ? "" : "s"
    } ready.`;
    return true;
  },

  createDraftSubmissionSnapshot() {
    const content = this.draft.trim();
    const attachments = this.draftAttachments.slice();

    if (!content && !attachments.length) {
      return null;
    }

    return {
      attachments,
      content
    };
  },

  queueDraftSubmission() {
    const snapshot = this.createDraftSubmissionSnapshot();

    if (!snapshot) {
      return false;
    }

    this.queuedSubmissions = [...this.queuedSubmissions, snapshot];
    this.clearComposerDraft();
    this.status =
      this.queuedSubmissionCount === 1
        ? "1 message queued for the next step."
        : `${this.queuedSubmissionCount} messages queued for the next steps.`;
    this.render({
      preserveScroll: true
    });
    return true;
  },

  consumeNextQueuedSubmissionMessage() {
    if (!this.queuedSubmissions.length) {
      return null;
    }

    const [snapshot, ...rest] = this.queuedSubmissions;
    this.queuedSubmissions = rest;
    return createMessage("user", snapshot.content, {
      attachments: Array.isArray(snapshot.attachments) ? snapshot.attachments.slice() : []
    });
  },

  getQueuedPreviewMessages() {
    return this.queuedSubmissions
      .map((submission, index) =>
        createMessage("user", submission.content, {
          attachments: Array.isArray(submission.attachments) ? submission.attachments.slice() : [],
          kind: "queued"
        })
      )
      .map((message, index) => ({
        ...message,
        id: `queued-preview-${index}`
      }));
  },

  getBoundaryAction() {
    if (this.hasQueuedSubmission) {
      return "queued";
    }

    if (this.stopRequested) {
      return "stopped";
    }

    return "";
  },

  handleDraftInput(event) {
    this.syncDraft(event.target.value);
  },

  openAttachmentPicker() {
    if (this.isAttachmentPickerDisabled) {
      return;
    }

    this.refs.attachmentInput?.click();
  },

  handleAttachmentDragEnter(event) {
    if (!dataTransferContainsFiles(event?.dataTransfer)) {
      return;
    }

    event.preventDefault();
    this.attachmentDragDepth += 1;

    if (!this.isAttachmentPickerDisabled) {
      this.isAttachmentDragActive = true;
    }
  },

  handleAttachmentDragOver(event) {
    if (!dataTransferContainsFiles(event?.dataTransfer)) {
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }

    if (!this.isAttachmentPickerDisabled) {
      this.isAttachmentDragActive = true;
    }
  },

  handleAttachmentDragLeave(event) {
    if (!dataTransferContainsFiles(event?.dataTransfer)) {
      return;
    }

    this.attachmentDragDepth = Math.max(0, this.attachmentDragDepth - 1);

    if (this.attachmentDragDepth === 0) {
      this.isAttachmentDragActive = false;
    }
  },

  handleAttachmentDrop(event) {
    if (!dataTransferContainsFiles(event?.dataTransfer)) {
      return;
    }

    event.preventDefault();
    const droppedFiles = event.dataTransfer?.files;
    this.resetAttachmentDragState();

    if (this.isAttachmentPickerDisabled) {
      return;
    }

    this.appendDraftAttachments(droppedFiles);
  },

  handleAttachmentInput(event) {
    this.appendDraftAttachments(event?.target?.files);

    if (event?.target) {
      event.target.value = "";
    }
  },

  removeDraftAttachment(attachmentId) {
    const nextAttachments = this.draftAttachments.filter((attachment) => attachment.id !== attachmentId);

    if (nextAttachments.length === this.draftAttachments.length) {
      return;
    }

    this.draftAttachments = nextAttachments;
    this.render({
      preserveScroll: true
    });
    this.status = this.draftAttachments.length
      ? `${this.draftAttachments.length} attachment${this.draftAttachments.length === 1 ? "" : "s"} ready.`
      : "Attachment removed.";
  },

  handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.handleComposerPrimaryAction();
    }
  },

  handleComposerPrimaryAction() {
    if (this.isSending) {
      if (this.queueDraftSubmission()) {
        return;
      }

      if (!this.hasQueuedSubmission) {
        this.requestStop();
      }

      return;
    }

    void this.submitMessage();
  },

  requestStop() {
    if (!this.isSending) {
      return;
    }

    this.stopRequested = true;
    this.activeRequestController?.abort();
    this.status = "Stopping after the current step...";
  },

  openSystemDialog() {
    this.systemPromptDraft = this.systemPrompt;
    openDialog(this.refs.systemDialog);
  },

  closeSystemDialog() {
    closeDialog(this.refs.systemDialog);
  },

  clearSystemPromptDraft() {
    this.systemPromptDraft = "";
    this.status = "Custom system instructions cleared in the editor.";
  },

  async persistConfig() {
    await storage.saveAdminChatConfig({
      settings: this.settings,
      systemPrompt: this.systemPrompt
    });
  },

  async saveSystemPromptFromDialog() {
    const draftPrompt = typeof this.systemPromptDraft === "string" ? this.systemPromptDraft.trim() : "";

    if (!draftPrompt) {
      this.systemPrompt = "";
      this.systemPromptDraft = "";

      try {
        await this.refreshRuntimeSystemPrompt();
        await this.persistConfig();
        this.status = "Custom system instructions reset.";
        this.closeSystemDialog();
      } catch (error) {
        this.reportError("resetting custom system instructions", error);
      }

      return;
    }

    this.systemPrompt = draftPrompt;
    this.systemPromptDraft = draftPrompt;

    try {
      await this.refreshRuntimeSystemPrompt();
      await this.persistConfig();
      this.status = "Custom system instructions updated.";
      this.closeSystemDialog();
    } catch (error) {
      this.reportError("saving custom system instructions", error);
    }
  },

  openSettingsDialog() {
    this.settingsDraft = {
      ...this.settings,
      promptBudgetRatios: clonePromptBudgetRatios(this.settings.promptBudgetRatios)
    };
    this.syncHuggingFaceFromManager();
    this.prefillSettingsDraftDefaultHuggingFaceModel();

    if (!String(this.settingsDraft.huggingfaceDtype || "").trim()) {
      this.settingsDraft.huggingfaceDtype = DTYPE_OPTIONS[0]?.value || config.DEFAULT_ADMIN_CHAT_SETTINGS.huggingfaceDtype;
    }

    void this.warmSettingsDraftLocalProvider()
      .catch((error) => {
        this.reportError("warming the local-provider settings draft", error);
      });

    // Kick off live Codex catalog discovery so a signed-in user sees the
    // models actually available to their account. Failures fall back to the
    // shipped static catalog so the dropdown always has entries.
    void this.refreshCodexModelCatalog().catch((error) => {
      this.reportError("refreshing the Codex model catalog", error);
    });

    openDialog(this.refs.settingsDialog);
  },

  closeSettingsDialog() {
    closeDialog(this.refs.settingsDialog);
  },

  setSettingsProvider(provider) {
    this.settingsDraft = {
      ...this.settingsDraft,
      provider: config.normalizeAdminChatLlmProvider(provider)
    };

    if (this.isSettingsDraftUsingLocalProvider) {
      this.prefillSettingsDraftDefaultHuggingFaceModel();
      void this.warmSettingsDraftLocalProvider().catch((error) => {
        this.reportError("warming the local-provider settings draft", error);
      });
    }

    if (this.isSettingsDraftUsingCodexProvider && !this.settingsDraft.codexModel) {
      this.settingsDraft = {
        ...this.settingsDraft,
        codexModel: codexModels.CODEX_DEFAULT_MODEL_ID
      };
    }
  },

  async startCodexLogin() {
    if (this.isCodexLoginActive) {
      return;
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    this.codexLoginAbortController = controller;
    this.codexLoginState = {
      ...createAdminCodexLoginState(),
      status: codexAuthFlow.CODEX_AUTH_FLOW_STATUS.STARTING
    };

    try {
      const tokens = await codexAuthFlow.runCodexDeviceAuthorizationFlow({
        onStatusChange: (event) => {
          this.codexLoginState = {
            deviceAuthId: event.deviceAuthId || this.codexLoginState.deviceAuthId || "",
            error: event.error || "",
            status: event.status,
            userCode: event.userCode || this.codexLoginState.userCode || "",
            verificationUrl: event.verificationUrl || this.codexLoginState.verificationUrl || ""
          };
        },
        signal: controller?.signal
      });

      this.settingsDraft = {
        ...this.settingsDraft,
        codexTokens: serializeAdminCodexTokensDraft(tokens)
      };
      this.codexLoginState = createAdminCodexLoginState();

      // The signed-in user's catalog depends on the ChatGPT subscription
      // attached to the newly issued access token. Force a re-discovery now
      // so the model dropdown reflects the live list before the user picks.
      void this.refreshCodexModelCatalog({ force: true }).catch(() => {});
    } catch (error) {
      if (error?.name !== "AbortError") {
        this.codexLoginState = {
          ...createAdminCodexLoginState(),
          error: error?.message || String(error),
          status: codexAuthFlow.CODEX_AUTH_FLOW_STATUS.FAILED
        };
      } else {
        this.codexLoginState = createAdminCodexLoginState();
      }
    } finally {
      this.codexLoginAbortController = null;
    }
  },

  cancelCodexLogin() {
    if (this.codexLoginAbortController) {
      this.codexLoginAbortController.abort();
    }

    this.codexLoginState = createAdminCodexLoginState();
    this.codexLoginAbortController = null;
  },

  clearCodexLogin() {
    this.settingsDraft = {
      ...this.settingsDraft,
      codexTokens: ""
    };
    this.codexLoginState = createAdminCodexLoginState();
  },

  // Discover the live Codex model catalog. The runtime catalog is cached
  // in-memory with a 10-minute TTL so opening the settings dialog repeatedly
  // does not spam the Codex models endpoint. Concurrent callers coalesce
  // through the shared in-flight promise. A failed discovery (network, CORS,
  // missing tokens) resolves with an empty runtime catalog so the static
  // fallback in `models.js` remains selectable.
  async refreshCodexModelCatalog({ force = false } = {}) {
    if (!force && this.codexCatalogPromise) {
      return this.codexCatalogPromise;
    }

    if (!force && this.codexCatalogFetchedAt && (Date.now() - this.codexCatalogFetchedAt) < CODEX_CATALOG_TTL_MS) {
      return this.codexRuntimeCatalog;
    }

    const tokens = parseAdminCodexTokensDraft(this.settings?.codexTokens);
    const accessToken = typeof tokens?.accessToken === "string" ? tokens.accessToken.trim() : "";

    if (!accessToken) {
      this.codexRuntimeCatalog = [];
      this.codexCatalogFetchedAt = Date.now();
      return this.codexRuntimeCatalog;
    }

    const accountId = typeof tokens?.accountId === "string" ? tokens.accountId.trim() : "";
    const pending = (async () => {
      try {
        const catalog = await discoverCodexModels({
          accessToken,
          chatGPTAccountId: accountId
        });
        this.codexRuntimeCatalog = Array.isArray(catalog) ? catalog : [];
      } catch {
        this.codexRuntimeCatalog = [];
      } finally {
        this.codexCatalogFetchedAt = Date.now();
        this.codexCatalogPromise = null;
      }

      return this.codexRuntimeCatalog;
    })();

    this.codexCatalogPromise = pending;
    return pending;
  },

  // Called by the `prepareAdminAgentApiRequest` Codex hook after a server-side
  // refresh rotated the stored refresh token. The hook delegates here instead
  // of writing the config file directly so that encoding, lock-state
  // bookkeeping, and persistence stay owned by `storage.js`.
  async applyRefreshedCodexTokens(tokens) {
    const serialized = serializeAdminCodexTokensDraft(tokens);

    if (!serialized) {
      return;
    }

    this.settings = {
      ...this.settings,
      codexTokens: serialized
    };

    const dialogElement = this.refs?.settingsDialog;
    const isDialogOpen = Boolean(dialogElement && typeof dialogElement.hasAttribute === "function" && dialogElement.hasAttribute("open"));

    if (isDialogOpen) {
      this.settingsDraft = {
        ...this.settingsDraft,
        codexTokens: serialized
      };
    }

    await this.persistConfig();
  },

  setSettingsPromptBudgetRatio(key, value) {
    const normalizedRatios = rebalancePromptBudgetRatios(
      this.settingsDraft.promptBudgetRatios,
      key,
      value
    );

    this.settingsDraft = {
      ...this.settingsDraft,
      promptBudgetRatios: {
        ...normalizedRatios,
        singleMessage: normalizePromptBudgetSingleMessageRatio(
          this.settingsDraft?.promptBudgetRatios?.singleMessage
        )
      }
    };
  },

  setSettingsSingleMessagePromptBudgetRatio(value) {
    const normalizedRatios = clonePromptBudgetRatios(this.settingsDraft.promptBudgetRatios);

    this.settingsDraft = {
      ...this.settingsDraft,
      promptBudgetRatios: {
        ...normalizedRatios,
        singleMessage: normalizePromptBudgetSingleMessageRatio(value)
      }
    };
  },

  handleSettingsHuggingFaceModelInput(value = "") {
    this.settingsDraft = {
      ...this.settingsDraft,
      huggingfaceModel: String(value ?? "")
    };
  },

  handleSettingsHuggingFaceDtypeChange(value = this.settingsDraft.huggingfaceDtype) {
    this.settingsDraft = {
      ...this.settingsDraft,
      huggingfaceDtype: String(value || "").trim()
    };
  },

  handleSettingsHuggingFaceModelDraftChange(value) {
    const selection = parseHuggingFaceSelectionValue(value);
    this.settingsDraft = {
      ...this.settingsDraft,
      huggingfaceDtype: selection.dtype,
      huggingfaceModel: selection.modelId
    };
  },

  getSettingsDraftHuggingFaceSelectionValue() {
    return getHuggingFaceSelectionValue(this.settingsDraft.huggingfaceModel, this.settingsDraft.huggingfaceDtype);
  },

  getHuggingFaceSavedModelSelectionValue(model) {
    return getHuggingFaceSelectionValue(model?.modelId, model?.dtype);
  },

  requestAdminHuggingFaceModelUnload() {
    if (!this.canAdminUnloadHuggingFaceModel) {
      return;
    }

    void this.ensureHuggingFaceSubscription()
      .then(() => huggingfaceManager.unloadModel({
        clearPersistedSelection: false,
        reboot: false
      }))
      .then(() => this.syncHuggingFaceFromManager())
      .catch((error) => {
        this.reportError("unloading the selected local model", error);
      });
  },

  requestAdminSelectedHuggingFaceModelAction() {
    if (!this.canAdminActOnSelectedHuggingFaceModel) {
      return;
    }

    const selectedModelId = normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "");
    const selectedDtype = String(this.settingsDraft.huggingfaceDtype || "").trim();

    void this.ensureHuggingFaceSubscription()
      .then(async () => {
        if (this.huggingface.isLoadingModel) {
          this.status = "Stopping Hugging Face model load...";
          return huggingfaceManager.unloadModel({
            clearPersistedSelection: false,
            reboot: false
          });
        }

        if (!selectedModelId || !selectedDtype) {
          throw new Error("Choose a Hugging Face model and dtype.");
        }

        if (
          this.huggingface.activeModelId === selectedModelId
          && this.huggingface.activeDtype === selectedDtype
        ) {
          this.status = `Unloading ${selectedModelId}...`;
          return huggingfaceManager.unloadModel({
            clearPersistedSelection: false,
            reboot: false
          });
        }

        this.status = this.isSavedHuggingFaceModel(selectedModelId, selectedDtype)
          ? `Loading ${selectedModelId} for local admin chat...`
          : `Downloading and loading ${selectedModelId} for local admin chat...`;
        return huggingfaceManager.loadModel({
          dtype: selectedDtype,
          maxNewTokens: this.huggingface.maxNewTokens,
          modelInput: selectedModelId
        });
      })
      .then(() => this.syncHuggingFaceFromManager())
      .catch((error) => {
        this.reportError("loading or unloading the selected local model", error);
      });
  },

  openHuggingFaceConfiguration() {
    huggingfaceManager.openConfiguration();
  },

  resetSettingsDraftToDefaults() {
    const preservedApiKey = typeof this.settingsDraft.apiKey === "string" ? this.settingsDraft.apiKey : "";

    this.settingsDraft = {
      ...config.DEFAULT_ADMIN_CHAT_SETTINGS,
      promptBudgetRatios: { ...config.DEFAULT_ADMIN_CHAT_SETTINGS.promptBudgetRatios },
      apiKey: preservedApiKey
    };
    this.status = "LLM settings draft reset to defaults except API key.";
  },

  openRawDialogForMessage(messageId) {
    const message = this.history.find((entry) => entry.id === messageId && entry.role === "assistant");

    if (!message) {
      this.status = "That assistant message is no longer available.";
      return;
    }

    this.rawOutputTitle = "Raw LLM Output";
    this.rawOutputContent = typeof message.content === "string" ? message.content : "";
    openDialog(this.refs.rawDialog);
  },

  closeRawDialog() {
    closeDialog(this.refs.rawDialog);
  },

  async openPromptHistoryDialog() {
    try {
      await this.refreshRuntimeSystemPrompt();

      this.promptHistoryTitle = "Full Prompt History";
      this.promptHistoryMode = "text";
      openDialog(this.refs.historyDialog);
    } catch (error) {
      this.reportError("opening the prompt history dialog", error);
    }
  },

  closePromptHistoryDialog() {
    closeDialog(this.refs.historyDialog);
  },

  setPromptHistoryMode(mode) {
    this.promptHistoryMode = mode === "json" ? "json" : "text";
  },

  async copyPromptHistory() {
    const copied = await agentView.copyTextToClipboard(this.promptHistoryContent || "");
    this.status = copied ? "Prompt history copied." : "Unable to copy prompt history.";
  },

  async saveSettingsFromDialog() {
    const provider = config.normalizeAdminChatLlmProvider(this.settingsDraft.provider);
    const localProvider = config.normalizeAdminChatLocalProvider(this.settingsDraft.localProvider);
    const paramsText = typeof this.settingsDraft.paramsText === "string" ? this.settingsDraft.paramsText.trim() : "";
    let maxTokens = config.DEFAULT_ADMIN_CHAT_SETTINGS.maxTokens;

    try {
      maxTokens = config.parseAdminChatMaxTokens(this.settingsDraft.maxTokens);
      llmParams.parseAdminAgentParamsText(paramsText);

      if (provider === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
        const huggingfaceModel = normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "");
        const huggingfaceDtype = String(this.settingsDraft.huggingfaceDtype || "").trim();

        if (!huggingfaceModel || !huggingfaceDtype) {
          throw new Error("Choose a Hugging Face model and dtype before saving.");
        }
      }
    } catch (error) {
      this.reportError("validating admin chat settings", error);
      return;
    }

    this.settings = {
      apiEndpoint: (this.settingsDraft.apiEndpoint || "").trim(),
      apiKey: (this.settingsDraft.apiKey || "").trim(),
      codexModel: codexModels.normalizeCodexModelId(this.settingsDraft.codexModel),
      codexTokens: typeof this.settingsDraft.codexTokens === "string" ? this.settingsDraft.codexTokens.trim() : "",
      huggingfaceDtype: (this.settingsDraft.huggingfaceDtype || "").trim(),
      huggingfaceModel: normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || ""),
      localProvider,
      maxTokens,
      model: (this.settingsDraft.model || "").trim(),
      paramsText,
      promptBudgetRatios: clonePromptBudgetRatios(this.settingsDraft.promptBudgetRatios),
      provider,
      storedApiKeyLocked: this.settings.storedApiKeyLocked === true,
      storedApiKeyValue: String(this.settings.storedApiKeyValue || ""),
      storedCodexTokensLocked: this.settings.storedCodexTokensLocked === true,
      storedCodexTokensValue: String(this.settings.storedCodexTokensValue || "")
    };

    try {
      await this.persistConfig();
      if (provider === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
        this.status = `Local ${getConfiguredLocalProviderLabel(this.settings)} settings updated. Preparing the selected model in the background.`;
      } else if (provider === config.ADMIN_CHAT_LLM_PROVIDER.CODEX) {
        this.status = "ChatGPT settings updated.";
      } else {
        this.status = "API LLM settings updated.";
      }
      this.closeSettingsDialog();

      if (provider === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
        void this.autoLoadConfiguredLocalModel(this.settings).catch((error) => {
          this.reportError("preparing the configured local model", error);
        });
      }
    } catch (error) {
      this.reportError("saving admin chat settings", error);
    }
  },

  async handleClearClick() {
    this.closeRawDialog();
    this.rawOutputContent = "";
    this.clearComposerDraft();
    this.queuedSubmissions = [];
    this.cancelStreamingMessageRender();
    await this.replaceHistory([], {
      refreshPrompt: false
    });
    this.executionOutputOverrides = Object.create(null);
    this.rerunningMessageId = "";
    this.stopRequested = false;
    this.activeRequestController?.abort();
    this.activeRequestController = null;

    await this.persistHistory({
      immediate: true
    });

    if (this.chatRuntime?.attachments) {
      this.chatRuntime.attachments.clear();
    }

    if (this.chatRuntime?.skills?.clear) {
      this.chatRuntime.skills.clear();
    }

    if (this.executionContext) {
      this.executionContext.reset();
    }

    await this.refreshRuntimeSystemPrompt();
    void huggingfaceManager.resetChat().catch((error) => {
      this.reportError("resetting the local chat runtime during admin clear", error, {
        preserveStatus: true
      });
    });

    this.render();
    this.status = "Admin chat cleared and execution context reset.";
  },

  async streamAssistantResponse(requestMessages, assistantMessage, preparedRequest = null) {
    let hasSeenDelta = false;
    const usingLocalProvider =
      config.normalizeAdminChatLlmProvider(this.settings.provider) === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL;

    if (usingLocalProvider) {
      const localModelReady = this.isConfiguredLocalModelReady(this.settings);
      this.status = localModelReady ? "Running local LLM..." : "Loading local LLM...";
      await this.ensureActiveLocalRuntime(this.settings);

      if (!hasSeenDelta) {
        this.status = this.isConfiguredLocalModelReady(this.settings)
          ? "Running local LLM..."
          : "Loading local LLM...";
      }
    } else {
      this.status = "Streaming response...";
    }
    const promptContext =
      preparedRequest?.promptInput && typeof preparedRequest.promptInput === "object"
        ? preparedRequest.promptInput
        : await prompt.buildAdminPromptInput({
            defaultSystemPrompt: this.defaultSystemPrompt,
            historyMessages: requestMessages,
            promptInstance: this.ensurePromptRuntime(),
            systemPrompt: this.systemPrompt,
            transientSections: this.getPromptTransientSections()
          });
    const effectiveSystemPrompt =
      typeof preparedRequest?.systemPrompt === "string" && preparedRequest.systemPrompt.trim()
        ? preparedRequest.systemPrompt
        : typeof promptContext?.systemPrompt === "string"
          ? promptContext.systemPrompt
          : "";
    this.applyPromptInput(promptContext);
    const controller = new AbortController();
    this.activeRequestController = controller;
    let responseMeta = null;

    try {
      responseMeta = await agentApi.streamAdminAgentCompletion({
        promptContext,
        settings: this.settings,
        systemPrompt: effectiveSystemPrompt,
        messages: requestMessages,
        onDelta: (delta) => {
          if (!hasSeenDelta) {
            hasSeenDelta = true;
            this.status = "Streaming response...";
          }

          assistantMessage.content += delta;
          this.scheduleStreamingMessageRender(assistantMessage);
        },
        signal: controller.signal
      });
    } catch (error) {
      assistantMessage.streaming = false;
      this.cancelStreamingMessageRender();

      if (this.activeRequestController === controller) {
        this.activeRequestController = null;
      }

      if (isAbortError(error) && this.stopRequested) {
        const hasContent = Boolean(assistantMessage.content.trim());

        if (hasContent) {
          await this.refreshPromptInputFromHistory(this.history);
          await this.persistHistory({
            immediate: true
          });
          this.render();
        }

        return {
          hasContent,
          responseMeta,
          stopped: true
        };
      }

      throw error;
    }

    assistantMessage.streaming = false;
    this.cancelStreamingMessageRender();

    if (this.activeRequestController === controller) {
      this.activeRequestController = null;
    }

    await this.refreshPromptInputFromHistory(this.history);
    await this.persistHistory({
      immediate: true
    });
    this.render();
    return {
      hasContent: Boolean(assistantMessage.content.trim()),
      responseMeta,
      stopped: false
    };
  },

  async handleCompactClick() {
    if (this.isSending) {
      return;
    }

    await this.init();

    if (this.isLoadingDefaultSystemPrompt) {
      this.status = "Loading default system prompt...";
      return;
    }

    try {
      await this.refreshRuntimeSystemPrompt();
    } catch (error) {
      this.reportError("refreshing prompt history before compaction", error);
      return;
    }

    await this.compactHistory();
  },

  async compactHistory(options = {}) {
    const historyText = this.historyText.trim();
    const mode =
      options.mode === prompt.ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC
        ? prompt.ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC
        : prompt.ADMIN_HISTORY_COMPACT_MODE.USER;
    const preserveFocus = options.preserveFocus !== false;
    const statusText =
      typeof options.statusText === "string" && options.statusText.trim()
        ? options.statusText.trim()
        : mode === prompt.ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC
          ? "Compacting history before continuing..."
          : "Compacting history...";

    if (!historyText) {
      this.status = "No history to compact.";
      return false;
    }

    const previousSendingState = this.isSending;
    this.isSending = true;
    this.isCompactingHistory = true;
    const previousTokenCount = this.historyTokenCount;
    this.status = statusText;

    try {
      const compactPrompt = await prompt.fetchAdminHistoryCompactPrompt({
        mode
      });
      if (config.normalizeAdminChatLlmProvider(this.settings.provider) === config.ADMIN_CHAT_LLM_PROVIDER.LOCAL) {
        await this.ensureActiveLocalRuntime(this.settings);
      }

      let trimmedHistoryText = historyText;

      for (let attempt = 0; attempt < MAX_COMPACT_TRIM_ATTEMPTS; attempt++) {
        let compactedHistory = "";
        let compactionError = null;

        try {
          await agentApi.streamAdminAgentCompletion({
            settings: this.settings,
            systemPrompt: compactPrompt,
            messages: [
              {
                role: "user",
                content: trimmedHistoryText
              }
            ],
            onDelta: (delta) => {
              compactedHistory += delta;
            }
          });
        } catch (err) {
          compactionError = err;
        }

        if (!compactionError) {
          const normalizedCompactedHistory = compactedHistory.trim();

          if (!normalizedCompactedHistory) {
            throw new Error("History compaction returned no content.");
          }

          const compactedMessage = createMessage("user", normalizedCompactedHistory, {
            kind: "history-compact"
          });
          this.executionOutputOverrides = Object.create(null);
          this.rerunningMessageId = "";
          await this.replaceHistory([compactedMessage]);
          await this.persistHistory({
            immediate: true
          });
          this.status = `History compacted from ${previousTokenCount.toLocaleString()} to ${this.historyTokenCount.toLocaleString()} tokens.`;
          return compactedMessage;
        }

        const isLastAttempt = attempt === MAX_COMPACT_TRIM_ATTEMPTS - 1;

        if (isLastAttempt || !isContextLengthError(compactionError)) {
          throw compactionError;
        }

        trimmedHistoryText = trimHistoryTextToRecentMessages(trimmedHistoryText);

        if (!trimmedHistoryText.trim()) {
          throw new Error("History compaction failed: content still too large after trimming.");
        }

        this.status = `Context too large, retrying with trimmed history (attempt ${attempt + 2}/${MAX_COMPACT_TRIM_ATTEMPTS})...`;
      }
    } catch (error) {
      this.reportError("compacting chat history", error);
      return false;
    } finally {
      this.isCompactingHistory = false;
      this.isSending = previousSendingState;
      this.render();

      if (preserveFocus) {
        this.focusInput();
      }
    }
  },

  async executeAssistantBlocks(assistantInput, options = {}) {
    const assistantMessage = assistantInput && typeof assistantInput === "object" ? assistantInput : null;
    const assistantContent = typeof assistantInput === "string"
      ? assistantInput
      : typeof assistantMessage?.content === "string"
        ? assistantMessage.content
        : "";
    const assistantEvaluation = options.evaluateAssistantMessage === false
      ? null
      : await evaluateAdminAssistantMessage({
          assistantContent,
          history: this.history,
          logs: [],
          messageId: typeof assistantMessage?.id === "string" ? assistantMessage.id : "",
          store: this
        });
    const executionResults = await this.executionContext.executeFromContent(assistantContent, {
      onBeforeBlock: async ({ index, total }) => {
        if (!total) {
          return;
        }

        this.status =
          total === 1 ? "Executing browser code..." : `Executing browser code (${index + 1}/${total})...`;
      }
    });

    if (!executionResults.length) {
      return null;
    }

    prependAssistantEvaluationLogs(executionResults, assistantEvaluation?.logs);
    return executionResults;
  },

  async runConversationLoop(initialUserMessage) {
    this.chatRuntime.attachments.rememberMessageAttachments(
      initialUserMessage.id,
      initialUserMessage.attachments
    );
    this.chatRuntime.attachments.setActiveMessage(initialUserMessage.id);

    let nextUserMessage = initialUserMessage;
    let emptyAssistantRetryCount = 0;

    while (nextUserMessage) {
      let requestMessages =
        this.history[this.history.length - 1]?.id === nextUserMessage.id
          ? [...this.history]
          : [...this.history, nextUserMessage];
      let preparedRequest = null;

      try {
        preparedRequest = await this.preparePromptRequest(requestMessages);
      } catch (error) {
        this.reportError("preparing the next agent request", error);
        return "failed";
      }

      const requestTokenCount = countTextTokens(
        formatPromptHistoryText(preparedRequest?.promptInput?.requestMessages)
      );

      if (requestTokenCount > this.getConfiguredMaxTokens()) {
        const pendingMessageIsLatestHistoryMessage = this.history[this.history.length - 1]?.id === nextUserMessage.id;
        const compactedMessage = await this.compactHistory({
          mode: prompt.ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC,
          preserveFocus: false,
          statusText: "Compacting history before continuing..."
        });

        if (!compactedMessage) {
          return "failed";
        }

        if (pendingMessageIsLatestHistoryMessage) {
          nextUserMessage = compactedMessage;
        }

        requestMessages =
          this.history[this.history.length - 1]?.id === nextUserMessage.id
            ? [...this.history]
            : [...this.history, nextUserMessage];

        try {
          preparedRequest = await this.preparePromptRequest(requestMessages);
        } catch (error) {
          this.reportError("preparing the retry request after history compaction", error);
          return "failed";
        }
      }

      const boundaryActionBeforeStream = this.getBoundaryAction();

      if (boundaryActionBeforeStream) {
        return boundaryActionBeforeStream;
      }

      this.applyPromptInput(preparedRequest.promptInput);
      const assistantMessage = createStreamingAssistantMessage();

      this.history = [...requestMessages, assistantMessage];
      this.syncCurrentChatRuntime();
      this.render();

      try {
        const streamResult = await this.streamAssistantResponse(requestMessages, assistantMessage, preparedRequest);

        if (streamResult.stopped) {
          if (!streamResult.hasContent) {
            await this.replaceHistory(requestMessages);
            await this.persistHistory({
              immediate: true
            });
            this.render();
          }

          return this.getBoundaryAction() || "stopped";
        }

        const boundaryActionAfterResponse = this.getBoundaryAction();

        if (boundaryActionAfterResponse) {
          return boundaryActionAfterResponse;
        }

        if (!streamResult.hasContent) {
          if (isExecutionFollowUpKind(nextUserMessage.kind) && emptyAssistantRetryCount < MAX_PROTOCOL_RETRY_COUNT) {
            emptyAssistantRetryCount += 1;
            await this.replaceHistory(requestMessages);
            await this.persistHistory({
              immediate: true
            });
            this.render();

            if (emptyAssistantRetryCount === 1) {
              this.status = "Retrying once after an empty assistant response...";
              continue;
            }

            nextUserMessage = createMessage("user", buildEmptyAssistantRetryMessage(), {
              kind: "execution-retry"
            });
            this.status = hasVerifiedEmptyAssistantResponse(streamResult)
              ? "Retrying: assistant response was empty after execution..."
              : "Retrying: no usable assistant content was received after execution...";
            continue;
          }

          assistantMessage.content = "[No content returned]";
          await this.refreshPromptInputFromHistory(this.history);
          await this.persistHistory({
            immediate: true
          });
          this.render();
          return "complete";
        }
      } catch (error) {
        assistantMessage.streaming = false;
        this.cancelStreamingMessageRender();

        if (!assistantMessage.content.trim()) {
          await this.replaceHistory(requestMessages);
        } else {
          await this.refreshPromptInputFromHistory(this.history);
        }

        await this.persistHistory({
          immediate: true
        });
        this.render();
        throw error;
      }

      emptyAssistantRetryCount = 0;
      const executionResults = await this.executeAssistantBlocks(assistantMessage);

      if (!executionResults || !executionResults.length) {
        return "complete";
      }

      const executionOutputMessage = createMessage("user", execution.formatExecutionResultsMessage(executionResults), {
        kind: "execution-output"
      });
      await this.replaceHistory([...this.history, executionOutputMessage]);
      await this.persistHistory({
        immediate: true
      });
      this.render();

      const boundaryActionAfterExecution = this.getBoundaryAction();

      if (boundaryActionAfterExecution) {
        return boundaryActionAfterExecution;
      }

      nextUserMessage = executionOutputMessage;
      this.status = "Sending code execution output...";
    }

    return "complete";
  },

  async runSubmissionSeries(initialUserMessage) {
    let nextUserMessage = initialUserMessage;
    let finalOutcome = "complete";

    this.isSending = true;
    this.stopRequested = false;

    try {
      while (nextUserMessage) {
        const outcome = await this.runConversationLoop(nextUserMessage);
        finalOutcome = outcome;

        if (outcome === "queued") {
          nextUserMessage = this.consumeNextQueuedSubmissionMessage();

          if (nextUserMessage) {
            this.stopRequested = false;
            this.status = "Sending queued message...";
            continue;
          }

          finalOutcome = "complete";
          break;
        }

        if (outcome === "stopped") {
          this.status = "Stopped.";
          break;
        }

        const queuedMessage = this.consumeNextQueuedSubmissionMessage();

        if (queuedMessage) {
          nextUserMessage = queuedMessage;
          this.status = "Sending queued message...";
          continue;
        }

        nextUserMessage = null;
      }

      if (finalOutcome === "complete") {
        this.status = "Ready.";
      }
    } catch (error) {
      this.reportError("running the submission loop", error);
    } finally {
      this.activeRequestController = null;
      this.isSending = false;
      this.stopRequested = false;
      this.render();
      this.focusInput();
    }
  },

  async submitMessage() {
    if (this.isSending) {
      return;
    }

    await this.init();

    if (this.isLoadingDefaultSystemPrompt) {
      this.status = "Loading default system prompt...";
      return;
    }

    const draftSubmission = this.createDraftSubmissionSnapshot();

    if (!draftSubmission) {
      return;
    }

    try {
      await this.refreshRuntimeSystemPrompt();
    } catch (error) {
      this.reportError("refreshing prompt history before send", error);
      return;
    }

    if (this.isHistoryOverConfiguredMaxTokens()) {
      const compacted = await this.compactHistory({
        mode: prompt.ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC,
        preserveFocus: false,
        statusText: "Compacting history before send..."
      });

      if (!compacted) {
        return;
      }
    }

    const userMessage = createMessage("user", draftSubmission.content, {
      attachments: draftSubmission.attachments
    });
    this.clearComposerDraft();
    await this.runSubmissionSeries(userMessage);
  },

  async handleThreadClick(event) {
    const messageActionButton = event.target.closest("[data-message-action]");

    if (messageActionButton && this.refs.thread && this.refs.thread.contains(messageActionButton)) {
      const action = messageActionButton.dataset.messageAction;
      const messageId = messageActionButton.dataset.messageId;

      if (action === "show-raw" && messageId) {
        this.openRawDialogForMessage(messageId);
        return;
      }

      if (action === "copy-message" && messageId) {
        const copyPayload = agentView.getAssistantMessageCopyText(this.history, messageId, this.executionOutputOverrides);
        const copied = copyPayload.text ? await agentView.copyTextToClipboard(copyPayload.text) : false;
        this.status = copied
          ? copyPayload.kind === "result"
            ? "Result copied."
            : "Response copied."
          : "Unable to copy response.";
      }

      return;
    }

    const actionButton = event.target.closest("[data-terminal-action]");

    if (!actionButton || !this.refs.thread || !this.refs.thread.contains(actionButton)) {
      return;
    }

    const action = actionButton.dataset.terminalAction;
    const messageId = actionButton.dataset.terminalMessageId;

    if (!action || !messageId) {
      return;
    }

    const section = agentView.findExecuteSection(this.history, messageId, this.executionOutputOverrides);

    if (!section) {
      this.status = "That execution step is no longer available.";
      return;
    }

    if (action === "copy-input") {
      const copied = await agentView.copyTextToClipboard(agentView.getTerminalInputText(section.executeDisplay));
      this.status = copied ? "Input copied." : "Unable to copy input.";
      return;
    }

    if (action === "copy-output") {
      if (!Array.isArray(section.outputResults) || !section.outputResults.length) {
        this.status = "No execution output to copy yet.";
        return;
      }

      const outputText = agentView.getTerminalOutputText(section.outputResults);
      const copied = outputText ? await agentView.copyTextToClipboard(outputText) : false;
      this.status = copied ? "Output copied." : "Unable to copy output.";
      return;
    }

    if (action !== "rerun" || this.isSending) {
      return;
    }

    actionButton.blur?.();
    this.isSending = true;
    this.rerunningMessageId = messageId;

    try {
      const executionResults = await this.executeAssistantBlocks(section.message, {
        evaluateAssistantMessage: false
      });

      if (!executionResults || !executionResults.length) {
        this.status = "No execution code found to rerun.";
        return;
      }

      this.executionOutputOverrides[messageId] = execution.createExecutionOutputSnapshots(executionResults);
      this.status = "Execution refreshed.";
    } catch (error) {
      this.reportError("rerunning an execution block", error);
    } finally {
      this.isSending = false;
      this.rerunningMessageId = "";
      this.render({
        preserveScroll: true
      });
    }
  }
};

const adminAgent = space.fw.createStore("adminAgent", model);

export { adminAgent };
