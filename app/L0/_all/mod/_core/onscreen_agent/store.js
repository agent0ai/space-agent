import * as config from "/mod/_core/onscreen_agent/config.js";
import * as agentApi from "/mod/_core/onscreen_agent/api.js";
import * as execution from "/mod/_core/onscreen_agent/execution.js";
import * as agentLlm from "/mod/_core/onscreen_agent/llm.js";
import * as llmParams from "/mod/_core/onscreen_agent/llm-params.js";
import * as skills from "/mod/_core/onscreen_agent/skills.js";
import * as storage from "/mod/_core/onscreen_agent/storage.js";
import * as agentView from "/mod/_core/onscreen_agent/view.js";
import { renderMarkdown } from "/mod/_core/framework/js/markdown-frontmatter.js";
import { DEFAULT_MODEL_INPUT, DTYPE_OPTIONS, normalizeHuggingFaceModelInput } from "/mod/_core/huggingface/helpers.js";
import { getHuggingFaceManager } from "/mod/_core/huggingface/manager.js";
import { positionPopover } from "/mod/_core/visual/chrome/popover.js";
import { closeDialog, openDialog } from "/mod/_core/visual/forms/dialog.js";
import { countTextTokens } from "/mod/_core/framework/js/token-count.js";
import {
  createAttachmentRuntime,
  createDraftAttachments,
  normalizeStoredAttachment,
  serializeAttachmentMetadata
} from "/mod/_core/onscreen_agent/attachments.js";

const CONFIG_PERSIST_DELAY_MS = 180;
const STARTUP_HINT_DELAY_MS = 2000;
const STARTUP_HINT_VISIBLE_MS = 3000;
const COMPACT_MODE_TOP_EDGE_THRESHOLD_EM = 10;
const DISPLAY_MODE_FULL = "full";
const DISPLAY_MODE_COMPACT = "compact";
const DISPLAY_MODE_TRANSITION_DURATION_MS = 260;
const DRAG_CLICK_THRESHOLD = 6;
const HIDDEN_EDGE_BOTTOM = config.ONSCREEN_AGENT_HIDDEN_EDGE.BOTTOM;
const HIDDEN_EDGE_LEFT = config.ONSCREEN_AGENT_HIDDEN_EDGE.LEFT;
const HIDDEN_EDGE_RIGHT = config.ONSCREEN_AGENT_HIDDEN_EDGE.RIGHT;
const HIDDEN_EDGE_TOP = config.ONSCREEN_AGENT_HIDDEN_EDGE.TOP;
const HIDDEN_EDGE_REVEAL_THRESHOLD_MIN_PX = 8;
const HIDDEN_EDGE_SNAP_DEAD_ZONE_MIN_PX = 4;
const HIDDEN_EDGE_VISIBLE_RATIO = 0.55;
const HIDDEN_EDGE_OFFSCREEN_RATIO = 1 - HIDDEN_EDGE_VISIBLE_RATIO;
const HIDDEN_EDGE_REVEAL_THRESHOLD_RATIO = 0.17;
const HISTORY_MIN_HEIGHT_PX = 80;
const HISTORY_OFFSET_PX = 12;
const MAX_COMPACT_TRIM_ATTEMPTS = 4;
const MAX_PROTOCOL_RETRY_COUNT = 2;
const POSITION_MARGIN = 16;
const UI_BUBBLE_AUTO_HIDE_BASE_MS = 1400;
const UI_BUBBLE_AUTO_HIDE_MAX_MS = 12000;
const UI_BUBBLE_AUTO_HIDE_MIN_MS = 2200;
const UI_BUBBLE_AUTO_HIDE_PER_CHAR_MS = 28;
const UI_BUBBLE_AUTO_HIDE_PER_WORD_MS = 260;
const UI_BUBBLE_ENTER_DURATION_MS = 420;
const UI_BUBBLE_EXIT_DURATION_MS = 180;
const HISTORY_DIALOG_ELEMENT_ID = "onscreen-agent-history-dialog";
const RAW_DIALOG_ELEMENT_ID = "onscreen-agent-raw-dialog";
const SETTINGS_DIALOG_ELEMENT_ID = "onscreen-agent-settings-dialog";
const VIEWPORT_VISIBILITY_CHECK_INTERVAL_MS = 2000;
const DEFAULT_AVATAR_SIZE_PX = 72;
const HIDDEN_COMPOSER_STATUS_TEXTS = new Set([
  "Loading onscreen agent...",
  "Loading default system prompt..."
]);
const huggingfaceManager = getHuggingFaceManager();

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

function ensureOnscreenAgentRuntimeNamespace(store) {
  const runtime = getRuntime();
  const previousNamespace =
    runtime.onscreenAgent && typeof runtime.onscreenAgent === "object" ? runtime.onscreenAgent : {};
  const namespace = {
    ...previousNamespace,
    async show(options = {}) {
      await store.init();
      const targetMode =
        options.mode === DISPLAY_MODE_COMPACT || options.mode === DISPLAY_MODE_FULL
          ? options.mode
          : store.displayMode;

      if (targetMode === DISPLAY_MODE_COMPACT) {
        store.showCompactMode({
          focusInput: options.focusInput !== false,
          hideBubble: options.hideBubble === true,
          persist: options.persist !== false
        });
      } else {
        store.showFullMode({
          focusInput: options.focusInput !== false,
          hideBubble: options.hideBubble !== false,
          persist: options.persist !== false
        });
      }

      return store;
    },
    async submitPrompt(promptText, options = {}) {
      const normalizedPrompt = String(promptText || "").trim();

      if (!normalizedPrompt) {
        throw new Error("A prompt is required.");
      }

      await namespace.show({
        focusInput: options.focusInput !== false,
        hideBubble: true,
        mode: options.mode,
        persist: options.persist !== false
      });

      store.syncDraft(normalizedPrompt);

      if (store.isSending) {
        if (store.canQueueSubmissionWhileBusy) {
          store.queueDraftSubmission();
          return {
            prompt: normalizedPrompt,
            queued: true
          };
        }

        throw new Error("The onscreen agent is busy and cannot accept another prompt right now.");
      }

      await store.submitMessage();

      return {
        prompt: normalizedPrompt,
        queued: false
      };
    },
    async submitExamplePrompt(promptText, options = {}) {
      const normalizedPrompt = String(promptText || "").trim();

      if (!normalizedPrompt) {
        throw new Error("A prompt is required.");
      }

      await namespace.show({
        focusInput: options.focusInput !== false,
        hideBubble: true,
        mode: options.mode,
        persist: options.persist !== false
      });

      if (store.shouldShowApiKeyWarning) {
        store.showUiBubble("Don't forget to configure your LLM first.");
        return {
          prompt: normalizedPrompt,
          queued: false,
          reason: "llm-not-configured",
          submitted: false
        };
      }

      if (store.isSending || store.isLoadingDefaultSystemPrompt || store.isCompactingHistory) {
        store.showUiBubble("I'm in the middle of something...");
        return {
          prompt: normalizedPrompt,
          queued: false,
          reason: "busy",
          submitted: false
        };
      }

      if (store.isComposerInputDisabled || store.refs.input?.disabled) {
        store.showUiBubble("I'm in the middle of something...");
        return {
          prompt: normalizedPrompt,
          queued: false,
          reason: "composer-disabled",
          submitted: false
        };
      }

      store.syncDraft(normalizedPrompt);
      await store.submitMessage();

      return {
        prompt: normalizedPrompt,
        queued: false,
        reason: "",
        submitted: true
      };
    }
  };

  runtime.onscreenAgent = namespace;
  return namespace;
}

function resolveDialogRef(refs, refKey, elementId) {
  const existingRef = refs && typeof refs === "object" ? refs[refKey] : null;

  if (existingRef) {
    return existingRef;
  }

  if (!elementId) {
    return null;
  }

  const dialog = document.getElementById(elementId);

  if (dialog && refs && typeof refs === "object") {
    refs[refKey] = dialog;
  }

  return dialog;
}

function normalizeTransientKey(key) {
  return typeof key === "string" ? key.trim() : "";
}

function normalizeTransientSection(section, fallbackKey = "") {
  const key = normalizeTransientKey(section?.key || fallbackKey);
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

function cloneTransientSection(section) {
  return section ? { ...section } : null;
}

function createTransientRuntime() {
  const sectionsByKey = new Map();

  const runtime = {
    clear() {
      sectionsByKey.clear();
    },
    delete(key) {
      const normalizedKey = normalizeTransientKey(key);

      if (!normalizedKey) {
        return false;
      }

      return sectionsByKey.delete(normalizedKey);
    },
    get(key) {
      const normalizedKey = normalizeTransientKey(key);
      return cloneTransientSection(sectionsByKey.get(normalizedKey)) || null;
    },
    list() {
      return [...sectionsByKey.values()]
        .sort((left, right) => {
          const orderCompare = left.order - right.order;

          if (orderCompare !== 0) {
            return orderCompare;
          }

          return left.key.localeCompare(right.key);
        })
        .map((section) => cloneTransientSection(section))
        .filter(Boolean);
    },
    set(keyOrSection, nextSection = {}) {
      const normalizedSection =
        typeof keyOrSection === "string"
          ? normalizeTransientSection(
              {
                ...nextSection,
                key: keyOrSection
              },
              keyOrSection
            )
          : normalizeTransientSection(keyOrSection);

      if (!normalizedSection) {
        if (typeof keyOrSection === "string") {
          runtime.delete(keyOrSection);
        }

        return null;
      }

      sectionsByKey.set(normalizedSection.key, normalizedSection);
      return cloneTransientSection(normalizedSection);
    },
    upsert(keyOrSection, nextSection = {}) {
      return runtime.set(keyOrSection, nextSection);
    }
  };

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

  if (!targetRuntime.chat.transient || typeof targetRuntime.chat.transient !== "object") {
    targetRuntime.chat.transient = createTransientRuntime();
  }

  return targetRuntime.chat;
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

function shouldHideComposerStatus(status) {
  const normalizedStatus = typeof status === "string" ? status.trim() : "";
  return HIDDEN_COMPOSER_STATUS_TEXTS.has(normalizedStatus);
}

function cloneConversationMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  return {
    ...message,
    attachments: Array.isArray(message.attachments) ? [...message.attachments] : []
  };
}

function applyConversationMessage(targetMessage, nextMessage) {
  if (!targetMessage || !nextMessage || targetMessage === nextMessage) {
    return targetMessage;
  }

  Object.assign(targetMessage, nextMessage);
  targetMessage.attachments = Array.isArray(nextMessage.attachments) ? [...nextMessage.attachments] : [];
  return targetMessage;
}

const processOnscreenAgentMessage = globalThis.space.extend(
  import.meta,
  async function processOnscreenAgentMessage(context = {}) {
    return context;
  }
);

async function resolveProcessedOnscreenAgentMessage(context = {}) {
  const fallbackMessage = cloneConversationMessage(context.message);
  const processedContext = await processOnscreenAgentMessage({
    ...context,
    history: Array.isArray(context.history)
      ? context.history.map((message) => cloneConversationMessage(message)).filter(Boolean)
      : [],
    message: fallbackMessage
  });
  const processedMessage =
    processedContext && typeof processedContext === "object" ? processedContext.message : fallbackMessage;

  return cloneConversationMessage(processedMessage) || fallbackMessage;
}

async function createProcessedMessage(role, content, options = {}, context = {}) {
  return resolveProcessedOnscreenAgentMessage({
    ...context,
    message: createMessage(role, content, options)
  });
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
  const assistantMessageIndex = history.findIndex(
    (message) => message.id === assistantMessageId && message.role === "assistant"
  );

  if (assistantMessageIndex === -1) {
    return null;
  }

  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    const message = history[index];

    if (message.role !== "user") {
      continue;
    }

    if (isFrameworkFollowUpKind(message.kind)) {
      continue;
    }

    return message;
  }

  return null;
}

function normalizePromptHistoryRole(message) {
  return typeof message?.role === "string" ? message.role.trim().toLowerCase() : "unknown";
}

function getPromptHistoryMessageContent(message) {
  return typeof message?.content === "string" ? message.content : "";
}

function getPromptHistoryEntrySource(entry) {
  return typeof entry?.source === "string" ? entry.source.trim() : "";
}

function getPromptHistoryPreparedBlock(message) {
  const content = getPromptHistoryMessageContent(message);
  const firstLine = content.split(/\r?\n/u, 1)[0]?.trim() || "";

  return Object.values(agentLlm.ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK).includes(firstLine) ? firstLine : "";
}

function isPromptHistoryRealUserMessage(message) {
  return (
    normalizePromptHistoryRole(message) === "user" &&
    getPromptHistoryPreparedBlock(message) === agentLlm.ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.USER
  );
}

function formatPromptHistoryRoleLabel(message, entry) {
  const normalizedRole = normalizePromptHistoryRole(message);

  if (getPromptHistoryEntrySource(entry) === "example") {
    return normalizedRole === "assistant" ? "EXAMPLE ASSISTANT" : "EXAMPLE USER";
  }

  return normalizedRole.toUpperCase();
}

function isPromptHistoryActualHistoryEntry(entry) {
  const source = getPromptHistoryEntrySource(entry);
  return source === "history" || source === "history-compact";
}

function getPromptHistoryMessageSlice(messages, slice = "all", entries = []) {
  const promptMessages = Array.isArray(messages) ? messages : [];
  const promptEntries = Array.isArray(entries) ? entries : [];

  if (slice === "system") {
    return promptMessages.filter((message) => normalizePromptHistoryRole(message) === "system");
  }

  if (slice === "history") {
    return promptMessages.filter((message, index) => {
      const entry = promptEntries[index];

      if (entry) {
        return isPromptHistoryActualHistoryEntry(entry);
      }

      return normalizePromptHistoryRole(message) !== "system";
    });
  }

  return promptMessages;
}

function formatPromptHistoryMessageJson(message) {
  if (message && typeof message === "object") {
    return JSON.stringify(message, null, 2);
  }

  return JSON.stringify(message ?? null, null, 2);
}

function formatPromptHistoryJson(messages) {
  return JSON.stringify(Array.isArray(messages) ? messages : [], null, 2);
}

function formatPromptHistoryText(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return "";
  }

  return messages
    .map((message) => {
      const role = normalizePromptHistoryRole(message).toUpperCase();
      const content = getPromptHistoryMessageContent(message);
      return `${role}:\n${content}`;
    })
    .join("\n\n");
}

function formatPromptHistorySystemPromptText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => getPromptHistoryMessageContent(message))
    .filter((content) => content.trim())
    .join("\n\n");
}

function getOffsetTopWithinAncestor(target, ancestor) {
  let offsetTop = 0;
  let node = target;

  while (node && node !== ancestor) {
    offsetTop += Number(node.offsetTop) || 0;
    node = node.offsetParent;
  }

  return offsetTop;
}

function countTextLines(text = "") {
  return String(text).split("\n").length;
}

function getPromptHistoryJsonMessageStartLines(messages) {
  const promptMessages = Array.isArray(messages) ? messages : [];
  const startLines = [];
  let nextLineIndex = 1;

  promptMessages.forEach((message) => {
    startLines.push(nextLineIndex);
    nextLineIndex += countTextLines(formatPromptHistoryMessageJson(message));
  });

  return startLines;
}

function serializePromptHistoryMessages(messages, mode = "text") {
  if (mode === "json") {
    return formatPromptHistoryJson(messages);
  }

  return formatPromptHistoryText(messages);
}

function isContextLengthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return ["context", "token", "length", "maximum", "too long", "exceed"].some((pattern) =>
    message.includes(pattern)
  );
}

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

function isFrameworkFollowUpKind(kind) {
  return kind === "execution-output" || kind === "execution-retry" || kind === "protocol-retry";
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

function buildProtocolRetryMessage() {
  return [
    "Protocol correction: your previous response was empty.",
    "Read the conversation above and continue.",
    "If browser work is needed, execute now.",
    "Otherwise answer the user."
  ].join("\n");
}

function hasVerifiedEmptyAssistantResponse(streamResult) {
  return Boolean(streamResult?.responseMeta?.verifiedEmpty);
}

function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === 20));
}

function mapManagerStateToOnscreenState(snapshot = {}) {
  return {
    activeDtype: String(snapshot.activeDtype || ""),
    activeModelId: String(snapshot.activeModelId || ""),
    error: String(snapshot.error || ""),
    isLoadingModel: snapshot.isLoadingModel === true,
    isWorkerBooting: snapshot.isWorkerBooting === true,
    isWorkerReady: snapshot.isWorkerReady === true,
    loadProgress: {
      progress: Number.isFinite(Number(snapshot.loadProgress?.progress))
        ? Math.max(0, Math.min(1, Number(snapshot.loadProgress.progress)))
        : 0,
      status: String(snapshot.loadProgress?.status || ""),
      stepLabel: String(snapshot.loadProgress?.stepLabel || ""),
      text: String(snapshot.loadProgress?.stepLabel || ""),
      timeElapsed: 0
    },
    loadingModelLabel: String(snapshot.loadingModelLabel || ""),
    savedModels: Array.isArray(snapshot.savedModels) ? [...snapshot.savedModels] : [],
    statusText: String(snapshot.statusText || ""),
    webgpuSupported: snapshot.webgpuSupported !== false
  };
}

function createEmptyHuggingFaceState() {
  return mapManagerStateToOnscreenState(huggingfaceManager.getSnapshot());
}

function summarizeOnscreenAgentLlmSelection(settings, huggingfaceState) {
  const provider = config.normalizeOnscreenAgentLlmProvider(settings?.provider);

  if (provider === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
    const activeModelId = typeof huggingfaceState?.activeModelId === "string" ? huggingfaceState.activeModelId.trim() : "";
    const configuredModelId = normalizeHuggingFaceModelInput(settings?.huggingfaceModel || "");
    return configuredModelId || activeModelId || "No model";
  }

  return agentView.summarizeLlmConfig(settings?.apiEndpoint || "", settings?.model || "");
}

function isHuggingFaceSelectionMatch(left = {}, right = {}) {
  return (
    normalizeHuggingFaceModelInput(left?.modelId || left?.modelInput || "") ===
      normalizeHuggingFaceModelInput(right?.modelId || right?.modelInput || "") &&
    String(left?.dtype || "").trim() === String(right?.dtype || "").trim()
  );
}

function getHuggingFaceSelectionValue(modelId, dtype) {
  return config.createOnscreenAgentHuggingFaceSelectionValue(modelId, dtype);
}

function parseHuggingFaceSelectionValue(value) {
  return config.parseOnscreenAgentHuggingFaceSelectionValue(value);
}

function getConfiguredLocalProviderLabel() {
  return "Hugging Face";
}

function clearTimer(timerId) {
  if (timerId) {
    window.clearTimeout(timerId);
  }

  return 0;
}

function getRootFontSizePx() {
  const rootStyle = globalThis.getComputedStyle?.(document.documentElement);
  const fontSize = Number.parseFloat(rootStyle?.fontSize || "");
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
}

function normalizeClientRect(rect) {
  if (
    !rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.right) ||
    !Number.isFinite(rect.bottom)
  ) {
    return null;
  }

  const left = Number(rect.left);
  const top = Number(rect.top);
  const right = Number(rect.right);
  const bottom = Number(rect.bottom);

  return {
    bottom,
    height: Math.max(0, bottom - top),
    left,
    right,
    top,
    width: Math.max(0, right - left)
  };
}

function unionClientRects(rects = []) {
  const normalizedRects = rects.map((rect) => normalizeClientRect(rect)).filter(Boolean);

  if (!normalizedRects.length) {
    return null;
  }

  const left = Math.min(...normalizedRects.map((rect) => rect.left));
  const top = Math.min(...normalizedRects.map((rect) => rect.top));
  const right = Math.max(...normalizedRects.map((rect) => rect.right));
  const bottom = Math.max(...normalizedRects.map((rect) => rect.bottom));

  return {
    bottom,
    height: Math.max(0, bottom - top),
    left,
    right,
    top,
    width: Math.max(0, right - left)
  };
}

function normalizeUiBubbleHideDelay(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return 0;
  }

  return Math.max(0, Math.round(normalizedValue));
}

function getAutoUiBubbleHideDelay(text) {
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!normalizedText) {
    return 0;
  }

  const charCount = Array.from(normalizedText).length;
  const wordCount = normalizedText.split(/\s+/u).filter(Boolean).length;
  const estimatedDelay = UI_BUBBLE_AUTO_HIDE_BASE_MS + Math.max(
    charCount * UI_BUBBLE_AUTO_HIDE_PER_CHAR_MS,
    wordCount * UI_BUBBLE_AUTO_HIDE_PER_WORD_MS
  );

  return Math.min(UI_BUBBLE_AUTO_HIDE_MAX_MS, Math.max(UI_BUBBLE_AUTO_HIDE_MIN_MS, estimatedDelay));
}

function createComposerActionMenuPosition() {
  return {
    left: 12,
    maxHeight: 240,
    top: 12
  };
}

function normalizeDisplayMode(value) {
  if (value === DISPLAY_MODE_FULL || value === DISPLAY_MODE_COMPACT) {
    return value;
  }

  return DISPLAY_MODE_COMPACT;
}

function getNextDisplayMode(value) {
  return normalizeDisplayMode(value) === DISPLAY_MODE_FULL ? DISPLAY_MODE_COMPACT : DISPLAY_MODE_FULL;
}

function normalizeUiBubbleText(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "");
}

function findContentLineStart(content, index) {
  let lineStart = Math.max(0, Math.min(index, content.length));

  while (lineStart > 0 && content[lineStart - 1] !== "\n") {
    lineStart -= 1;
  }

  return lineStart;
}

function stripTrailingExecutionSeparatorPrefix(content) {
  if (typeof content !== "string" || !content) {
    return "";
  }

  const separator = typeof execution.EXECUTION_SEPARATOR === "string" ? execution.EXECUTION_SEPARATOR : "";

  if (!separator) {
    return content;
  }

  const maxPrefixLength = Math.min(separator.length - 1, content.length);

  for (let prefixLength = maxPrefixLength; prefixLength > 0; prefixLength -= 1) {
    const separatorPrefix = separator.slice(0, prefixLength);

    if (!content.endsWith(separatorPrefix)) {
      continue;
    }

    const prefixStart = content.length - prefixLength;
    const lineStart = findContentLineStart(content, prefixStart);

    if (content.slice(lineStart, prefixStart).trim()) {
      continue;
    }

    return content.slice(0, lineStart);
  }

  return content;
}

function extractAssistantBubbleText(content) {
  if (typeof content !== "string" || !content.trim()) {
    return "";
  }

  let normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const separator = typeof execution.EXECUTION_SEPARATOR === "string" ? execution.EXECUTION_SEPARATOR : "";
  const separatorIndex = separator ? normalizedContent.indexOf(separator) : -1;

  if (separatorIndex !== -1) {
    normalizedContent = normalizedContent.slice(0, separatorIndex);
  } else {
    normalizedContent = stripTrailingExecutionSeparatorPrefix(normalizedContent);
  }

  return normalizeUiBubbleText(normalizedContent);
}

class UiBubble {
  constructor(store) {
    this.store = store;
  }

  update(text, hideAfterMs = 0) {
    return this.store?.updateUiBubble(this, text, hideAfterMs) === true;
  }

  dismiss(options = {}) {
    return this.store?.dismissUiBubble({
      clearActive: options.clearActive === true,
      bubble: this
    }) === true;
  }
}

function runOnNextFrame(callback) {
  if (typeof callback !== "function") {
    return;
  }

  window.requestAnimationFrame(() => {
    callback();
  });
}

function waitForDomUpdate() {
  return new Promise((resolve) => {
    if (typeof globalThis.Alpine?.nextTick === "function") {
      globalThis.Alpine.nextTick(() => {
        resolve();
      });
      return;
    }

    queueMicrotask(() => {
      resolve();
    });
  });
}

function countDisplayLines(text) {
  const normalizedText =
    typeof text === "string" ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd() : "";

  if (!normalizedText.trim()) {
    return 0;
  }

  return normalizedText.split("\n").length;
}

function formatLineCount(lineCount) {
  return `${lineCount.toLocaleString()} ${lineCount === 1 ? "line" : "lines"}`;
}

function getStreamingAssistantStatus(content) {
  const normalizedContent = typeof content === "string" ? content : "";
  const executeBlocks = execution.extractExecuteBlocks(normalizedContent);

  if (executeBlocks.length) {
    const codeLineCount = countDisplayLines(executeBlocks[0]?.code || "");

    if (codeLineCount > 0) {
      return `Writing ${formatLineCount(codeLineCount)} of code...`;
    }

    return "Preparing code...";
  }

  if (normalizedContent.trim()) {
    return "Writing response...";
  }

  return "Thinking...";
}

function getExecutionStatusText(code, index, total) {
  const lineCount = countDisplayLines(code);
  const lineCountLabel = lineCount > 0 ? `Executing ${formatLineCount(lineCount)} of code` : "Executing code";

  return total > 1 ? `${lineCountLabel} (${index + 1}/${total})...` : `${lineCountLabel}...`;
}

const model = {
  activeRequestController: null,
  activeUiBubble: null,
  attachmentDragDepth: 0,
  composerActionMenuAnchor: null,
  composerActionMenuPosition: createComposerActionMenuPosition(),
  composerActionMenuRenderToken: 0,
  compactAssistantBubble: null,
  compactAssistantBubbleMessageId: "",
  configPersistTimer: 0,
  chatRuntime: null,
  defaultSystemPrompt: "",
  displayMode: DISPLAY_MODE_COMPACT,
  displayModeTransitionPhase: "",
  displayModeTransitionTimer: 0,
  draft: "",
  draftAttachments: [],
  dragState: null,
  executionContext: null,
  executionOutputOverrides: Object.create(null),
  history: [],
  historyHeight: null,
  historyPersistPromise: null,
  historyResizeState: null,
  historyText: "",
  historyTokenCount: 0,
  initializationPromise: null,
  isAttachmentDragActive: false,
  isCompactingHistory: false,
  isComposerActionMenuVisible: false,
  isInitialized: false,
  isLoadingDefaultSystemPrompt: false,
  isShellVisible: false,
  isUiBubbleMounted: false,
  isSending: false,
  pendingHistorySnapshot: null,
  pendingStreamingDelta: "",
  pendingStreamingDeltaFrame: 0,
  pendingStreamingDeltaMessage: null,
  pendingStreamingMessage: null,
  promptHistoryEntries: [],
  promptHistoryMessages: [],
  promptHistoryMode: "text",
  promptHistoryTargetMessageIndex: -1,
  promptHistoryTitle: "Context window",
  promptInput: null,
  promptRuntime: null,
  queuedSubmissions: [],
  rawOutputContent: "",
  rawOutputTitle: "Raw LLM Output",
  refs: {
    actionMenu: null,
    avatar: null,
    attachmentInput: null,
    historyDialog: null,
    historyShell: null,
    input: null,
    panel: null,
    rawDialog: null,
    scroller: null,
    shell: null,
    settingsDialog: null,
    thread: null
  },
  rerunningMessageId: "",
  resizeHandler: null,
  runtime: null,
  runtimeSystemPrompt: "",
  hasStartupHintResolved: false,
  isStartupHintVisible: false,
  startupHintTimer: 0,
  streamingRenderFrame: 0,
  dragMoveHandler: null,
  dragEndHandler: null,
  huggingface: createEmptyHuggingFaceState(),
  huggingfaceManagerUnsubscribe: null,
  historyResizeMoveHandler: null,
  historyResizeEndHandler: null,
  viewportVisibilityCheckTimer: 0,
  viewportVisibilityHandler: null,
  uiBubbleAutoHideTimer: 0,
  uiBubbleEnterTimer: 0,
  uiBubbleExitTimer: 0,
  uiBubblePhase: "",
  uiBubbleText: "",
  settings: {
    apiEndpoint: "",
    apiKey: "",
    huggingfaceDtype: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.huggingfaceDtype,
    huggingfaceModel: "",
    localProvider: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.localProvider,
    maxTokens: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens,
    model: "",
    paramsText: "",
    provider: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.provider
  },
  settingsDraft: {
    apiEndpoint: "",
    apiKey: "",
    huggingfaceDtype: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.huggingfaceDtype,
    huggingfaceModel: "",
    localProvider: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.localProvider,
    maxTokens: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens,
    model: "",
    paramsText: "",
    provider: config.DEFAULT_ONSCREEN_AGENT_SETTINGS.provider
  },
  status: "Loading onscreen agent...",
  stopRequested: false,
  systemPrompt: "",
  systemPromptDraft: "",
  agentX: null,
  agentY: null,
  hiddenEdge: "",
  shouldCenterInitialPosition: false,

  get composerPlaceholder() {
    const statusText = typeof this.status === "string" ? this.status.trim() : "";

    if (!statusText || shouldHideComposerStatus(statusText)) {
      return "Message Space Agent...";
    }

    return statusText === "Ready." ? "Ready. Message Space Agent..." : statusText;
  },

  get composerActionMenuActions() {
    return [
      {
        icon: "open_in_full",
        id: "full-mode",
        label: "Full mode"
      },
      {
        icon: "attach_file",
        id: "attach",
        label: "Attachment"
      },
      {
        icon: this.compactButtonIcon,
        id: "compact-history",
        label: "Compact context",
        disabled: this.isCompactDisabled
      },
      {
        danger: true,
        icon: "restart_alt",
        id: "clear",
        label: "Clear chat",
        disabled: this.isClearDisabled
      },
      {
        icon: "notes",
        id: "history",
        label: "History"
      },
      {
        icon: "tune",
        id: "settings",
        label: "Model settings"
      }
    ];
  },

  get composerActionMenuStyle() {
    return {
      left: `${this.composerActionMenuPosition.left}px`,
      maxHeight: `${this.composerActionMenuPosition.maxHeight}px`,
      top: `${this.composerActionMenuPosition.top}px`,
      pointerEvents: this.isComposerActionMenuVisible ? "auto" : "none",
      visibility: this.isComposerActionMenuVisible ? "visible" : "hidden"
    };
  },

  get isComposerInputDisabled() {
    return !this.isInitialized || this.isCompactingHistory;
  },

  get shouldRenderShell() {
    return this.isShellVisible;
  },

  get shouldShowApiKeyWarning() {
    return (
      this.isInitialized &&
      !this.isLoadingDefaultSystemPrompt &&
      !String(this.settings.apiKey || "").trim() &&
      config.isDefaultOnscreenAgentLlmSettings(this.settings)
    );
  },

  get isCompactMode() {
    return this.displayMode === DISPLAY_MODE_COMPACT;
  },

  get isComposerActionMenuOpen() {
    return Boolean(this.composerActionMenuAnchor);
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

  get isClearDisabled() {
    return (
      !this.isInitialized ||
      this.isSending ||
      this.isLoadingDefaultSystemPrompt ||
      this.isCompactingHistory ||
      !this.history.length
    );
  },

  get llmSummary() {
    return summarizeOnscreenAgentLlmSelection(this.settings, this.huggingface);
  },

  get isSettingsDraftUsingApiProvider() {
    return config.normalizeOnscreenAgentLlmProvider(this.settingsDraft.provider) === config.ONSCREEN_AGENT_LLM_PROVIDER.API;
  },

  get isSettingsDraftUsingLocalProvider() {
    return config.normalizeOnscreenAgentLlmProvider(this.settingsDraft.provider) === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL;
  },

  get huggingfaceSavedModels() {
    return Array.isArray(this.huggingface.savedModels) ? this.huggingface.savedModels : [];
  },

  get hasSavedHuggingFaceModels() {
    return this.huggingfaceSavedModels.length > 0;
  },

  get onscreenSelectedHuggingFaceModelLabel() {
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
      this.huggingface.activeModelId === selectedModelId &&
      this.huggingface.activeDtype === selectedDtype
    ) {
      return "Loaded locally and ready for overlay chat.";
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

  get onscreenHuggingFaceCurrentModelActionLabel() {
    return this.huggingface.isLoadingModel ? "Stop" : "Unload";
  },

  get onscreenHuggingFaceSelectedModelActionLabel() {
    const selectedModelId = normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "");
    const selectedDtype = String(this.settingsDraft.huggingfaceDtype || "").trim();

    if (this.huggingface.isLoadingModel) {
      return "Stop";
    }

    if (!selectedModelId || !selectedDtype) {
      return "Load";
    }

    if (
      selectedModelId &&
      selectedDtype &&
      this.huggingface.activeModelId === selectedModelId &&
      this.huggingface.activeDtype === selectedDtype
    ) {
      return "Unload";
    }

    if (this.isSavedHuggingFaceModel(selectedModelId, selectedDtype)) {
      return "Load";
    }

    return "Download and load";
  },

  get canOnscreenActOnSelectedHuggingFaceModel() {
    if (!this.huggingface.webgpuSupported || this.isSending) {
      return false;
    }

    if (this.huggingface.isLoadingModel) {
      return true;
    }

    return Boolean(
      normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "") &&
      String(this.settingsDraft.huggingfaceDtype || "").trim()
    );
  },

  get canOnscreenUnloadHuggingFaceModel() {
    return Boolean(
      !this.isSending &&
      (this.huggingface.isWorkerReady || this.huggingface.isLoadingModel) &&
      (this.huggingface.activeModelId || this.huggingface.isLoadingModel)
    );
  },

  get historyTokenSummary() {
    return `${config.formatOnscreenAgentTokenCount(this.historyTokenCount)} tokens`;
  },

  get historyStyle() {
    const clampedHeight = this.getClampedHistoryHeight();
    const defaultAutoMaxHeight = this.getAvailableViewportHistoryHeight() ?? this.getDefaultHistoryAutoMaxHeight();
    const resizableMaxHeight = this.getMaxResizableHistoryHeight();

    if (clampedHeight === null) {
      return `--onscreen-agent-history-max-height:${defaultAutoMaxHeight}px;`;
    }

    return `--onscreen-agent-history-height:${clampedHeight}px;--onscreen-agent-history-max-height:${resizableMaxHeight}px;`;
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

  get isPrimaryActionBusy() {
    return this.isSending && this.hasQueuedSubmission && !this.canQueueSubmissionWhileBusy;
  },

  get isPrimaryActionStop() {
    return this.isSending && !this.hasQueuedSubmission && !this.canQueueSubmissionWhileBusy;
  },

  get compactButtonIcon() {
    return this.isCompactingHistory ? "progress_activity" : "compress";
  },

  get isFullMode() {
    return this.displayMode === DISPLAY_MODE_FULL;
  },

  get isModeTransitionExpanding() {
    return this.displayModeTransitionPhase === "expanding";
  },

  get isModeTransitionCollapsing() {
    return this.displayModeTransitionPhase === "collapsing";
  },

  get isEdgeHidden() {
    return Boolean(this.hiddenEdge);
  },

  get isDraggingAgent() {
    return Boolean(this.dragState);
  },

  get promptHistoryUserMessageIndexes() {
    if (!Array.isArray(this.promptHistoryMessages) || !this.promptHistoryMessages.length) {
      return [];
    }

    return this.promptHistoryMessages.reduce((indexes, message, index) => {
      if (isPromptHistoryRealUserMessage(message)) {
        indexes.push(index);
      }

      return indexes;
    }, []);
  },

  get hasPromptHistoryUserMessages() {
    return this.promptHistoryUserMessageIndexes.length > 0;
  },

  get promptHistoryActiveUserMessagePosition() {
    return this.promptHistoryUserMessageIndexes.indexOf(this.promptHistoryTargetMessageIndex);
  },

  get canJumpToPreviousPromptHistoryUserMessage() {
    return this.promptHistoryActiveUserMessagePosition > 0;
  },

  get canJumpToNextPromptHistoryUserMessage() {
    const userMessageIndexes = this.promptHistoryUserMessageIndexes;

    if (!userMessageIndexes.length) {
      return false;
    }

    const activePosition = this.promptHistoryActiveUserMessagePosition;

    if (activePosition === -1) {
      return true;
    }

    return activePosition < userMessageIndexes.length - 1;
  },

  get promptHistoryContent() {
    return serializePromptHistoryMessages(this.promptHistoryMessages, this.promptHistoryMode);
  },

  get promptHistoryJsonMessageStartLines() {
    return getPromptHistoryJsonMessageStartLines(this.promptHistoryMessages);
  },

  get promptHistorySections() {
    if (!Array.isArray(this.promptHistoryMessages) || !this.promptHistoryMessages.length) {
      return [];
    }

    return this.promptHistoryMessages.map((message, index) => {
      const content = getPromptHistoryMessageContent(message);
      const entry = Array.isArray(this.promptHistoryEntries) ? this.promptHistoryEntries[index] : null;

      return {
        content,
        isTarget: index === this.promptHistoryTargetMessageIndex,
        isUser: isPromptHistoryRealUserMessage(message),
        jsonContent: formatPromptHistoryMessageJson(message),
        messageIndex: index,
        role: formatPromptHistoryRoleLabel(message, entry),
        tokenCountLabel: `${config.formatOnscreenAgentTokenCount(countTextTokens(content))} tokens`
      };
    });
  },

  get isDockedRight() {
    return this.agentX > this.getViewportWidth() / 2;
  },

  get isHistoryBelow() {
    return this.agentY < this.getViewportHeight() * 0.5;
  },

  get isCompactModeNearTopEdge() {
    return this.agentY < Math.max(POSITION_MARGIN, getRootFontSizePx() * COMPACT_MODE_TOP_EDGE_THRESHOLD_EM);
  },

  get isUiBubbleBelowHead() {
    return this.isCompactMode ? this.isCompactModeNearTopEdge : this.isHistoryBelow;
  },

  get composerActionMenuAnchorViewportY() {
    if (this.composerActionMenuAnchor?.getBoundingClientRect) {
      const anchorRect = this.composerActionMenuAnchor.getBoundingClientRect();

      if (Number.isFinite(anchorRect.top) && Number.isFinite(anchorRect.height)) {
        return anchorRect.top + anchorRect.height / 2;
      }
    }

    return this.agentY;
  },

  get shouldOpenComposerActionMenuBelow() {
    return this.composerActionMenuAnchorViewportY <= this.getViewportHeight() * 0.5;
  },

  get avatarButtonLabel() {
    if (this.hiddenEdge) {
      return "Reveal agent chat";
    }

    return this.isFullMode ? "Switch to compact chat mode" : "Switch to full chat mode";
  },

  get shouldShowHistory() {
    return this.isFullMode && this.history.length > 0;
  },

  get positionStyle() {
    return `left:${Math.round(this.agentX)}px;top:${Math.round(this.agentY)}px;`;
  },

  getViewportWidth() {
    return Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0, 360);
  },

  getViewportHeight() {
    return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, 320);
  },

  getAvatarSize() {
    const avatarRect = this.refs.avatar?.getBoundingClientRect?.();

    if (Number.isFinite(avatarRect?.width) && avatarRect.width > 0) {
      return Math.round(avatarRect.width);
    }

    const shellStyle = this.refs.shell ? globalThis.getComputedStyle?.(this.refs.shell) : null;
    const computedAvatarSize = Number.parseFloat(shellStyle?.getPropertyValue("--onscreen-agent-avatar-size") || "");

    if (Number.isFinite(computedAvatarSize) && computedAvatarSize > 0) {
      return Math.round(computedAvatarSize);
    }

    return DEFAULT_AVATAR_SIZE_PX;
  },

  getHiddenEdgeVisibleInset() {
    return Math.max(1, Math.round(this.getAvatarSize() * HIDDEN_EDGE_VISIBLE_RATIO));
  },

  getHiddenEdgeHiddenOffset() {
    return Math.max(1, Math.round(this.getAvatarSize() * HIDDEN_EDGE_OFFSCREEN_RATIO));
  },

  getHiddenEdgeRevealThreshold() {
    return Math.max(HIDDEN_EDGE_REVEAL_THRESHOLD_MIN_PX, Math.round(this.getAvatarSize() * HIDDEN_EDGE_REVEAL_THRESHOLD_RATIO));
  },

  getHiddenEdgeSnapDeadZone() {
    return Math.max(HIDDEN_EDGE_SNAP_DEAD_ZONE_MIN_PX, this.getHiddenEdgeRevealThreshold());
  },

  getHiddenEdgeOverflow(x, y) {
    const normalizedX = Math.round(Number(x) || 0);
    const normalizedY = Math.round(Number(y) || 0);
    const avatarSize = this.getAvatarSize();

    return {
      [HIDDEN_EDGE_LEFT]: Math.max(0, -normalizedX),
      [HIDDEN_EDGE_RIGHT]: Math.max(0, normalizedX + avatarSize - this.getViewportWidth()),
      [HIDDEN_EDGE_TOP]: Math.max(0, -normalizedY),
      [HIDDEN_EDGE_BOTTOM]: Math.max(0, normalizedY + avatarSize - this.getViewportHeight())
    };
  },

  getHiddenEdgeForPosition(x, y, options = {}) {
    const normalizedX = Math.round(Number(x) || 0);
    const normalizedY = Math.round(Number(y) || 0);
    const currentHiddenEdge = config.normalizeOnscreenAgentHiddenEdge(options.currentHiddenEdge ?? this.hiddenEdge);
    const avatarSize = this.getAvatarSize();
    const revealThreshold = this.getHiddenEdgeRevealThreshold();

    if (currentHiddenEdge) {
      if (
        (currentHiddenEdge === HIDDEN_EDGE_LEFT && normalizedX >= revealThreshold) ||
        (currentHiddenEdge === HIDDEN_EDGE_RIGHT &&
          normalizedX <= this.getViewportWidth() - avatarSize - revealThreshold) ||
        (currentHiddenEdge === HIDDEN_EDGE_TOP && normalizedY >= revealThreshold) ||
        (currentHiddenEdge === HIDDEN_EDGE_BOTTOM &&
          normalizedY <= this.getViewportHeight() - avatarSize - revealThreshold)
      ) {
        return "";
      }

      const overflow = this.getHiddenEdgeOverflow(normalizedX, normalizedY);
      const nextOverflowEntry = Object.entries(overflow).sort((left, right) => right[1] - left[1])[0];

      if (!nextOverflowEntry || nextOverflowEntry[1] <= 0) {
        return currentHiddenEdge;
      }

      return nextOverflowEntry[0];
    }

    const overflow = this.getHiddenEdgeOverflow(normalizedX, normalizedY);
    const nextOverflowEntry = Object.entries(overflow).sort((left, right) => right[1] - left[1])[0];
    const snapDeadZone = this.getHiddenEdgeSnapDeadZone();

    if (!nextOverflowEntry || nextOverflowEntry[1] <= snapDeadZone) {
      return "";
    }

    return nextOverflowEntry[0];
  },

  getRevealedPositionForHiddenEdge(hiddenEdge = this.hiddenEdge) {
    const normalizedHiddenEdge = config.normalizeOnscreenAgentHiddenEdge(hiddenEdge);
    const fallbackPosition = this.getDefaultPosition();
    const revealThreshold = this.getHiddenEdgeRevealThreshold();
    const avatarSize = this.getAvatarSize();
    let x = Number.isFinite(this.agentX) ? this.agentX : fallbackPosition.x;
    let y = Number.isFinite(this.agentY) ? this.agentY : fallbackPosition.y;

    switch (normalizedHiddenEdge) {
      case HIDDEN_EDGE_LEFT:
        x = revealThreshold;
        break;
      case HIDDEN_EDGE_RIGHT:
        x = this.getViewportWidth() - avatarSize - revealThreshold;
        break;
      case HIDDEN_EDGE_TOP:
        y = revealThreshold;
        break;
      case HIDDEN_EDGE_BOTTOM:
        y = this.getViewportHeight() - avatarSize - revealThreshold;
        break;
      default:
        break;
    }

    return this.clampPosition(x, y);
  },

  getDefaultPosition() {
    return {
      x: 40,
      y: Math.max(POSITION_MARGIN, this.getViewportHeight() - 132)
    };
  },

  getApproximateCompactGap() {
    return this.getViewportWidth() <= 720 ? 10 : 12;
  },

  getApproximateCompactPanelWidth() {
    const viewportWidth = this.getViewportWidth();
    const rootFontSizePx = getRootFontSizePx();

    if (viewportWidth <= 720) {
      return Math.max(0, Math.min(viewportWidth - 96, rootFontSizePx * 20));
    }

    return Math.max(0, Math.min(viewportWidth - 132, rootFontSizePx * 22));
  },

  getInitialOverlayBottomTarget() {
    const viewportHeight = this.getViewportHeight();
    const sevenEmAboveViewportBottom = viewportHeight - getRootFontSizePx() * 7;
    const ninetyPercentViewportBottom = viewportHeight * 0.9;

    return Math.max(POSITION_MARGIN, Math.max(sevenEmAboveViewportBottom, ninetyPercentViewportBottom));
  },

  getInitialBottomAlignedCenteredPositionEstimate() {
    const avatarSize = this.getAvatarSize();
    const overlayWidth = avatarSize + this.getApproximateCompactGap() + this.getApproximateCompactPanelWidth();
    const targetBottom = this.getInitialOverlayBottomTarget();

    return this.clampPosition(
      (this.getViewportWidth() - overlayWidth) / 2,
      targetBottom - avatarSize,
      {
        hiddenEdge: ""
      }
    );
  },

  getVisibleOverlayRect() {
    const rects = [];

    if (this.refs.avatar?.getBoundingClientRect) {
      rects.push(this.refs.avatar.getBoundingClientRect());
    }

    if (!this.hiddenEdge && this.refs.panel?.getBoundingClientRect) {
      rects.push(this.refs.panel.getBoundingClientRect());
    }

    if (!this.hiddenEdge && this.isFullMode && this.shouldShowHistory && this.refs.historyShell?.getBoundingClientRect) {
      rects.push(this.refs.historyShell.getBoundingClientRect());
    }

    return unionClientRects(rects);
  },

  getInitialBottomAlignedCenteredPositionForOverlayRect(overlayRect) {
    if (
      !overlayRect ||
      typeof this.agentX !== "number" ||
      !Number.isFinite(this.agentX) ||
      typeof this.agentY !== "number" ||
      !Number.isFinite(this.agentY)
    ) {
      return this.getInitialBottomAlignedCenteredPositionEstimate();
    }

    const targetBottom = this.getInitialOverlayBottomTarget();

    return {
      x: this.agentX + (this.getViewportWidth() * 0.5 - (overlayRect.left + overlayRect.width * 0.5)),
      y: this.agentY + (targetBottom - overlayRect.bottom)
    };
  },

  placeInitialOverlay(options = {}) {
    const overlayRect = this.getVisibleOverlayRect();
    const positionedOverlay = overlayRect
      ? this.getInitialBottomAlignedCenteredPositionForOverlayRect(overlayRect)
      : this.getInitialBottomAlignedCenteredPositionEstimate();

    this.setPosition(positionedOverlay.x, positionedOverlay.y, {
      hiddenEdge: "",
      persist: options.persist !== false
    });

    if (options.reflow === true) {
      this.reflowOverlayLayout(options);
    }

    return positionedOverlay;
  },

  getDefaultHistoryAutoMaxHeight() {
    const isCompactViewport = this.getViewportWidth() <= 720;
    const remLimit = getRootFontSizePx() * (isCompactViewport ? 18 : 24);
    const viewportAllowance = this.getViewportHeight() - (isCompactViewport ? 170 : 180);

    return Math.max(HISTORY_MIN_HEIGHT_PX, Math.round(Math.min(remLimit, viewportAllowance)));
  },

  getAvailableViewportHistoryHeight() {
    if (!this.isFullMode || !this.shouldShowHistory) {
      return null;
    }

    const panelRect = this.refs.panel?.getBoundingClientRect ? this.refs.panel.getBoundingClientRect() : null;
    const hasPanelMetrics =
      Number.isFinite(panelRect?.top) && Number.isFinite(panelRect?.bottom) && Number.isFinite(panelRect?.height);
    const anchorY = Number(this.agentY);

    if (this.isHistoryBelow && hasPanelMetrics && Number.isFinite(anchorY)) {
      const availableHeight = this.getViewportHeight() - POSITION_MARGIN - (anchorY + panelRect.height + HISTORY_OFFSET_PX);

      if (Number.isFinite(availableHeight) && availableHeight > 0) {
        return Math.max(1, Math.round(availableHeight));
      }
    }

    if (this.refs.historyShell?.getBoundingClientRect) {
      const historyRect = this.refs.historyShell.getBoundingClientRect();

      if (!Number.isFinite(historyRect.top) || !Number.isFinite(historyRect.bottom)) {
        return null;
      }

      const availableHeight = this.isHistoryBelow
        ? this.getViewportHeight() - POSITION_MARGIN - historyRect.top
        : historyRect.bottom - POSITION_MARGIN;

      if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
        return null;
      }

      return Math.max(1, Math.round(availableHeight));
    }

    if (!hasPanelMetrics) {
      return null;
    }

    const availableHeight = this.isHistoryBelow
      ? this.getViewportHeight() - POSITION_MARGIN - (panelRect.bottom + HISTORY_OFFSET_PX)
      : panelRect.top - HISTORY_OFFSET_PX - POSITION_MARGIN;

    if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
      return null;
    }

    return Math.max(1, Math.round(availableHeight));
  },

  getMaxResizableHistoryHeight() {
    const fittedHeight = this.getAvailableViewportHistoryHeight();

    if (fittedHeight !== null) {
      return fittedHeight;
    }

    const isCompactViewport = this.getViewportWidth() <= 720;
    const viewportAllowance = this.getViewportHeight() - (isCompactViewport ? 170 : 180);

    return Math.max(HISTORY_MIN_HEIGHT_PX, Math.round(viewportAllowance));
  },

  getClampedHistoryHeight(value = this.historyHeight) {
    const normalizedValue = config.normalizeOnscreenAgentHistoryHeight(value);

    if (normalizedValue === null) {
      return null;
    }

    return Math.min(this.getMaxResizableHistoryHeight(), Math.max(HISTORY_MIN_HEIGHT_PX, normalizedValue));
  },

  clampPosition(x, y, options = {}) {
    const normalizedHiddenEdge = config.normalizeOnscreenAgentHiddenEdge(options.hiddenEdge);
    const normalizedX = Math.round(Number(x) || 0);
    const normalizedY = Math.round(Number(y) || 0);
    const avatarSize = this.getAvatarSize();
    const hiddenVisibleInset = this.getHiddenEdgeVisibleInset();
    const hiddenOffset = this.getHiddenEdgeHiddenOffset();
    const maxX = Math.max(POSITION_MARGIN, this.getViewportWidth() - avatarSize - POSITION_MARGIN);
    const maxY = Math.max(POSITION_MARGIN, this.getViewportHeight() - avatarSize - POSITION_MARGIN);
    const clampVisibleX = (value) => Math.min(maxX, Math.max(POSITION_MARGIN, value));
    const clampVisibleY = (value) => Math.min(maxY, Math.max(POSITION_MARGIN, value));

    if (normalizedHiddenEdge === HIDDEN_EDGE_LEFT) {
      return {
        x: -hiddenOffset,
        y: clampVisibleY(normalizedY)
      };
    }

    if (normalizedHiddenEdge === HIDDEN_EDGE_RIGHT) {
      return {
        x: this.getViewportWidth() - hiddenVisibleInset,
        y: clampVisibleY(normalizedY)
      };
    }

    if (normalizedHiddenEdge === HIDDEN_EDGE_TOP) {
      return {
        x: clampVisibleX(normalizedX),
        y: -hiddenOffset
      };
    }

    if (normalizedHiddenEdge === HIDDEN_EDGE_BOTTOM) {
      return {
        x: clampVisibleX(normalizedX),
        y: this.getViewportHeight() - hiddenVisibleInset
      };
    }

    return {
      x: clampVisibleX(normalizedX),
      y: clampVisibleY(normalizedY)
    };
  },

  isAvatarVisible() {
    const avatarRect = this.refs.avatar?.getBoundingClientRect?.();

    if (
      !Number.isFinite(avatarRect?.left) ||
      !Number.isFinite(avatarRect?.top) ||
      !Number.isFinite(avatarRect?.right) ||
      !Number.isFinite(avatarRect?.bottom)
    ) {
      return null;
    }

    return (
      avatarRect.right > POSITION_MARGIN &&
      avatarRect.bottom > POSITION_MARGIN &&
      avatarRect.left < this.getViewportWidth() - POSITION_MARGIN &&
      avatarRect.top < this.getViewportHeight() - POSITION_MARGIN
    );
  },

  reflowOverlayLayout(options = {}) {
    this.positionComposerActionMenu();
    this.render({
      preserveScroll: options.preserveScroll !== false
    });
  },

  setPosition(x, y, options = {}) {
    const normalizedHiddenEdge = config.normalizeOnscreenAgentHiddenEdge(
      options.hiddenEdge === undefined ? this.hiddenEdge : options.hiddenEdge
    );
    const position = this.clampPosition(x, y, {
      hiddenEdge: normalizedHiddenEdge
    });
    const hiddenEdgeChanged = normalizedHiddenEdge !== this.hiddenEdge;

    this.agentX = position.x;
    this.agentY = position.y;
    this.hiddenEdge = normalizedHiddenEdge;

    if (hiddenEdgeChanged) {
      this.closeComposerActionMenu();

      if (normalizedHiddenEdge) {
        this.dismissUiBubble({
          clearActive: true
        });
        this.refs.input?.blur?.();
      }
    }

    if (options.persist !== false) {
      this.scheduleConfigPersist();
    }
  },

  ensurePosition(options = {}) {
    let moved = false;
    const normalizedHiddenEdge = config.normalizeOnscreenAgentHiddenEdge(this.hiddenEdge);
    this.hiddenEdge = normalizedHiddenEdge;

    if (
      (typeof this.agentX !== "number" || !Number.isFinite(this.agentX)) &&
      (typeof this.agentY !== "number" || !Number.isFinite(this.agentY))
    ) {
      const defaultPosition = this.getDefaultPosition();
      const clampedDefaultPosition = this.clampPosition(defaultPosition.x, defaultPosition.y, {
        hiddenEdge: normalizedHiddenEdge
      });
      this.agentX = clampedDefaultPosition.x;
      this.agentY = clampedDefaultPosition.y;
      moved = true;

      if (options.persist === true) {
        this.scheduleConfigPersist();
      }

      if (options.reflow === true) {
        this.reflowOverlayLayout(options);
      }

      return moved;
    }

    const fallbackPosition = this.getDefaultPosition();
    const position = this.clampPosition(
      Number.isFinite(this.agentX) ? this.agentX : fallbackPosition.x,
      Number.isFinite(this.agentY) ? this.agentY : fallbackPosition.y,
      {
        hiddenEdge: normalizedHiddenEdge
      }
    );

    if (position.x !== this.agentX || position.y !== this.agentY) {
      this.agentX = position.x;
      this.agentY = position.y;
      moved = true;
    }

    if (!moved && options.ensureVisible !== false && this.isAvatarVisible() === false) {
      const defaultPosition = this.clampPosition(fallbackPosition.x, fallbackPosition.y, {
        hiddenEdge: normalizedHiddenEdge
      });

      if (defaultPosition.x !== this.agentX || defaultPosition.y !== this.agentY) {
        this.agentX = defaultPosition.x;
        this.agentY = defaultPosition.y;
        moved = true;
      }
    }

    if (moved && options.persist === true) {
      this.scheduleConfigPersist();
    }

    if (moved || options.reflow === true) {
      this.reflowOverlayLayout(options);
    }

    return moved;
  },

  revealHiddenEdge(options = {}) {
    const normalizedHiddenEdge = config.normalizeOnscreenAgentHiddenEdge(options.hiddenEdge ?? this.hiddenEdge);

    if (!normalizedHiddenEdge) {
      return false;
    }

    const revealedPosition = this.getRevealedPositionForHiddenEdge(normalizedHiddenEdge);
    this.hiddenEdge = "";
    this.agentX = revealedPosition.x;
    this.agentY = revealedPosition.y;
    this.closeComposerActionMenu();

    if (options.persist !== false) {
      this.scheduleConfigPersist();
    }

    if (options.reflow === true) {
      this.reflowOverlayLayout(options);
    }

    return true;
  },

  scheduleConfigPersist() {
    if (this.configPersistTimer) {
      window.clearTimeout(this.configPersistTimer);
    }

    this.configPersistTimer = window.setTimeout(() => {
      this.configPersistTimer = 0;
      void this.persistConfig();
    }, CONFIG_PERSIST_DELAY_MS);
  },

  async persistConfig() {
    try {
      storage.saveOnscreenAgentUiState({
        agentX: this.agentX,
        agentY: this.agentY,
        displayMode: this.displayMode,
        hiddenEdge: this.hiddenEdge,
        historyHeight: this.historyHeight
      });
      await storage.saveOnscreenAgentConfig({
        settings: this.settings,
        systemPrompt: this.systemPrompt
      });
    } catch (error) {
      this.status = error.message;
    }
  },

  clearStartupHintTimer() {
    this.startupHintTimer = clearTimer(this.startupHintTimer);
  },

  resolveStartupHint() {
    this.hasStartupHintResolved = true;
    this.clearStartupHintTimer();
    this.isStartupHintVisible = false;
  },

  scheduleStartupHint() {
    this.clearStartupHintTimer();

    if (this.hasStartupHintResolved) {
      return;
    }

    this.startupHintTimer = window.setTimeout(() => {
      this.startupHintTimer = 0;

      if (this.hasStartupHintResolved) {
        return;
      }

      if (!this.isShellVisible || !this.refs.shell) {
        this.startupHintTimer = window.setTimeout(() => {
          this.startupHintTimer = 0;
          this.scheduleStartupHint();
        }, 100);
        return;
      }

      this.hasStartupHintResolved = true;
      this.isStartupHintVisible = true;

      this.startupHintTimer = window.setTimeout(() => {
        this.startupHintTimer = 0;
        this.isStartupHintVisible = false;
      }, STARTUP_HINT_VISIBLE_MS);
    }, STARTUP_HINT_DELAY_MS);
  },

  handleShellPointerDown(event) {
    if (event && event.isTrusted === false) {
      return;
    }

    this.resolveStartupHint();
  },

  clearUiBubbleEnterTimer() {
    this.uiBubbleEnterTimer = clearTimer(this.uiBubbleEnterTimer);
  },

  clearUiBubbleAutoHideTimer() {
    this.uiBubbleAutoHideTimer = clearTimer(this.uiBubbleAutoHideTimer);
  },

  clearUiBubbleExitTimer() {
    this.uiBubbleExitTimer = clearTimer(this.uiBubbleExitTimer);
  },

  clearDisplayModeTransitionTimer() {
    this.displayModeTransitionTimer = clearTimer(this.displayModeTransitionTimer);
  },

  startDisplayModeTransition(phase = "") {
    const normalizedPhase = phase === "expanding" || phase === "collapsing" ? phase : "";
    this.clearDisplayModeTransitionTimer();
    this.displayModeTransitionPhase = normalizedPhase;

    if (!normalizedPhase) {
      return;
    }

    this.displayModeTransitionTimer = window.setTimeout(() => {
      this.displayModeTransitionTimer = 0;
      this.displayModeTransitionPhase = "";
    }, DISPLAY_MODE_TRANSITION_DURATION_MS);
  },

  showCompactAssistantReplyBubble(assistantContent, options = {}) {
    if (!this.isCompactMode) {
      return null;
    }

    const messageId = typeof options.messageId === "string" ? options.messageId : "";
    const bubbleText = extractAssistantBubbleText(assistantContent);

    if (!bubbleText) {
      return null;
    }

    if (messageId && this.compactAssistantBubbleMessageId === messageId && this.compactAssistantBubble) {
      const didUpdate = this.compactAssistantBubble.update(bubbleText);
      return didUpdate ? this.compactAssistantBubble : null;
    }

    const bubble = this.showUiBubble(bubbleText);

    if (messageId) {
      this.compactAssistantBubbleMessageId = messageId;
      this.compactAssistantBubble = bubble;
    }

    return bubble;
  },

  maybeShowCompactStreamingAssistantBubble(assistantMessage) {
    if (!assistantMessage || assistantMessage.role !== "assistant") {
      return false;
    }

    return Boolean(this.showCompactAssistantReplyBubble(assistantMessage.content, {
      messageId: assistantMessage.id
    }));
  },

  setStreamingAssistantStatus(content) {
    if (this.isFullMode) {
      return;
    }

    const nextStatus = getStreamingAssistantStatus(content);

    if (this.status !== nextStatus) {
      this.status = nextStatus;
    }
  },

  showUiBubble(text, hideAfterMs = 0) {
    if (this.hiddenEdge) {
      return null;
    }

    const normalizedText = normalizeUiBubbleText(text);

    if (!normalizedText.trim()) {
      this.dismissUiBubble({
        clearActive: true
      });
      return null;
    }

    const bubble = new UiBubble(this);
    this.activeUiBubble = bubble;
    bubble.update(normalizedText, hideAfterMs);
    return bubble;
  },

  updateUiBubble(bubble, text, hideAfterMs = 0) {
    if (!bubble || this.activeUiBubble !== bubble) {
      return false;
    }

    const normalizedText = normalizeUiBubbleText(text);

    if (!normalizedText.trim()) {
      this.dismissUiBubble({
        bubble
      });
      return false;
    }

    const isEntering = this.isUiBubbleMounted && this.uiBubblePhase === "entering";
    const shouldReopen = !this.isUiBubbleMounted || this.uiBubblePhase === "leaving";
    const nextHideAfterMs = normalizeUiBubbleHideDelay(hideAfterMs) || getAutoUiBubbleHideDelay(normalizedText);

    this.clearUiBubbleExitTimer();

    if (!isEntering) {
      this.clearUiBubbleEnterTimer();
    }

    this.clearUiBubbleAutoHideTimer();
    this.uiBubbleText = normalizedText;
    this.renderUiBubbleContent();

    if (shouldReopen) {
      this.isUiBubbleMounted = true;
      this.uiBubblePhase = "entering";
      this.uiBubbleEnterTimer = window.setTimeout(() => {
        this.uiBubbleEnterTimer = 0;

        if (!this.isUiBubbleMounted || this.activeUiBubble !== bubble || this.uiBubblePhase !== "entering") {
          return;
        }

        this.uiBubblePhase = "visible";
      }, UI_BUBBLE_ENTER_DURATION_MS);
    } else if (!isEntering) {
      this.uiBubblePhase = "visible";
    }

    if (nextHideAfterMs > 0) {
      const autoHideDelay = this.uiBubblePhase === "entering"
        ? UI_BUBBLE_ENTER_DURATION_MS + nextHideAfterMs
        : nextHideAfterMs;

      this.uiBubbleAutoHideTimer = window.setTimeout(() => {
        this.uiBubbleAutoHideTimer = 0;

        if (this.activeUiBubble !== bubble) {
          return;
        }

        this.dismissUiBubble({
          bubble
        });
      }, autoHideDelay);
    }

    return true;
  },

  dismissUiBubble(options = {}) {
    const bubble = options.bubble || null;

    if (bubble && this.activeUiBubble !== bubble) {
      return false;
    }

    if (options.clearActive === true && (!bubble || this.activeUiBubble === bubble)) {
      this.activeUiBubble = null;
    }

    if (!this.isUiBubbleMounted || this.uiBubblePhase === "leaving") {
      return false;
    }

    this.clearUiBubbleEnterTimer();
    this.clearUiBubbleAutoHideTimer();
    this.uiBubblePhase = "leaving";
    this.uiBubbleExitTimer = window.setTimeout(() => {
      this.uiBubbleExitTimer = 0;
      this.isUiBubbleMounted = false;
      this.uiBubblePhase = "";
      this.uiBubbleText = "";
      this.renderUiBubbleContent();
    }, UI_BUBBLE_EXIT_DURATION_MS);
    return true;
  },

  renderUiBubbleContent() {
    const target = this.refs.uiBubbleContent;

    if (!target) {
      return;
    }

    const bubbleText = normalizeUiBubbleText(this.uiBubbleText);

    if (!bubbleText) {
      target.replaceChildren();
      return;
    }

    renderMarkdown(bubbleText, target, {
      className: "onscreen-agent-ui-bubble-text",
      tagName: "div"
    });
  },

  async ensureHuggingFaceSubscription() {
    if (this.huggingfaceManagerUnsubscribe) {
      this.syncHuggingFaceFromManager();
      return huggingfaceManager;
    }

    this.huggingfaceManagerUnsubscribe = huggingfaceManager.subscribe((snapshot) => {
      this.huggingface = mapManagerStateToOnscreenState(snapshot);
    });
    this.syncHuggingFaceFromManager();
    return huggingfaceManager;
  },

  syncHuggingFaceFromManager() {
    this.huggingface = mapManagerStateToOnscreenState(huggingfaceManager.getSnapshot());
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
    if (config.normalizeOnscreenAgentLlmProvider(settings?.provider) !== config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
      return false;
    }

    return Boolean(
      normalizeHuggingFaceModelInput(settings?.huggingfaceModel || "") &&
      String(settings?.huggingfaceDtype || "").trim()
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
      ? `Loading ${selectedModelId} for local overlay chat...`
      : `Downloading and loading ${selectedModelId} for local overlay chat...`;
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
    const provider = config.normalizeOnscreenAgentLlmProvider(settings?.provider);

    if (provider !== config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
      return false;
    }

    const selectedModelId = normalizeHuggingFaceModelInput(settings?.huggingfaceModel || "");
    const selectedDtype = String(settings?.huggingfaceDtype || "").trim();

    return Boolean(
      selectedModelId &&
      selectedDtype &&
      this.huggingface.isWorkerReady &&
      !this.huggingface.isLoadingModel &&
      this.huggingface.activeModelId === selectedModelId &&
      this.huggingface.activeDtype === selectedDtype
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

  syncCurrentChatRuntime() {
    if (!this.chatRuntime) {
      return;
    }

    this.chatRuntime.messages = this.history.map((message) => createRuntimeMessageSnapshot(message));
  },

  getPromptBuildOptions() {
    return {
      localProfile:
        config.normalizeOnscreenAgentLlmProvider(this.settings.provider) === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL
    };
  },

  ensurePromptRuntime() {
    if (!this.promptRuntime) {
      this.promptRuntime = agentLlm.createOnscreenAgentPromptInstance();
    }

    return this.promptRuntime;
  },

  getPromptTransientSections() {
    const transientSections = this.chatRuntime?.transient?.list?.();
    return Array.isArray(transientSections) ? transientSections : [];
  },

  applyPromptInput(promptInput) {
    const normalizedPromptInput = promptInput && typeof promptInput === "object" ? promptInput : null;

    this.promptInput = normalizedPromptInput;
    this.runtimeSystemPrompt = typeof normalizedPromptInput?.systemPrompt === "string"
      ? normalizedPromptInput.systemPrompt
      : "";
    this.historyText = formatPromptHistoryText(normalizedPromptInput?.historyMessages);
    this.promptHistoryEntries = Array.isArray(normalizedPromptInput?.requestEntries)
      ? normalizedPromptInput.requestEntries.map((entry) => ({ ...entry }))
      : [];
    this.promptHistoryMessages = Array.isArray(normalizedPromptInput?.requestMessages)
      ? normalizedPromptInput.requestMessages.map((message) => ({ ...message }))
      : [];
    this.historyTokenCount = countTextTokens(formatPromptHistoryText(this.promptHistoryMessages));
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
    return agentLlm.prepareOnscreenAgentCompletionRequest({
      defaultSystemPrompt: this.defaultSystemPrompt,
      messages: history,
      promptInstance: this.ensurePromptRuntime(),
      options: this.getPromptBuildOptions(),
      settings: this.settings,
      systemPrompt: this.systemPrompt,
      transientSections: this.getPromptTransientSections()
    });
  },

  async replaceHistory(nextHistory, options = {}) {
    this.history = Array.isArray(nextHistory) ? [...nextHistory] : [];
    this.syncCurrentChatRuntime();

    if (options.refreshPrompt === false || (!this.defaultSystemPrompt && !this.isInitialized && !this.promptInput)) {
      return;
    }

    await this.refreshHistoryMetrics();
  },

  async refreshHistoryMetrics(options = {}) {
    const history = Array.isArray(options.history) ? options.history : this.history;

    if (options.rebuild === true) {
      return this.rebuildPromptInput({
        history
      });
    }

    return this.refreshPromptInputFromHistory(history);
  },

  getConfiguredMaxTokens() {
    return config.normalizeOnscreenAgentMaxTokens(this.settings.maxTokens);
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
        await storage.saveOnscreenAgentHistory(snapshot);
      }
    })()
      .catch((error) => {
        this.status = error.message;
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
      await skills.installOnscreenSkillRuntime();

      try {
        const [storedConfig, storedHistory] = await Promise.all([
          storage.loadOnscreenAgentConfig(),
          storage.loadOnscreenAgentHistory()
        ]);

        this.settings = {
          ...storedConfig.settings
        };
        this.settingsDraft = {
          ...this.settings
        };
        this.systemPrompt = storedConfig.systemPrompt;
        this.systemPromptDraft = storedConfig.systemPrompt;
        this.agentX = storedConfig.agentX;
        this.agentY = storedConfig.agentY;
        this.hiddenEdge = config.normalizeOnscreenAgentHiddenEdge(storedConfig.hiddenEdge);
        this.shouldCenterInitialPosition = storedConfig.shouldCenterInitialPosition === true;
        this.displayMode = normalizeDisplayMode(storedConfig.displayMode);
        this.historyHeight = config.normalizeOnscreenAgentHistoryHeight(storedConfig.historyHeight);

        if (this.shouldCenterInitialPosition) {
          const initialPosition = this.getInitialBottomAlignedCenteredPositionEstimate();
          this.agentX = initialPosition.x;
          this.agentY = initialPosition.y;
          this.hiddenEdge = "";
        }

        await this.replaceHistory(storedHistory.map((message) => normalizeStoredMessage(message)), {
          refreshPrompt: false
        });
        this.ensurePosition({
          persist: true,
          reflow: false
        });
        this.isShellVisible = true;
        await waitForDomUpdate();

        if (this.shouldCenterInitialPosition) {
          // The shell refs are populated from panel.html on a nested Alpine nextTick.
          await waitForDomUpdate();
          this.placeInitialOverlay({
            persist: true,
            reflow: false
          });
          this.shouldCenterInitialPosition = false;
        }

        this.status = "Loading default system prompt...";
        this.isLoadingDefaultSystemPrompt = true;

        await this.ensureDefaultSystemPrompt({
          preserveStatus: true
        });
        this.systemPrompt = agentLlm.extractCustomOnscreenAgentSystemPrompt(
          this.systemPrompt,
          this.defaultSystemPrompt
        );
        this.systemPromptDraft = this.systemPrompt;
        await this.refreshRuntimeSystemPrompt();

        this.isInitialized = true;
        this.status = "Ready.";
        this.render();
        runOnNextFrame(() => {
          this.ensurePosition({
            persist: true,
            reflow: true
          });
        });

        if (this.hasConfiguredLocalModel(this.settings)) {
          void this.autoLoadConfiguredLocalModel(this.settings).catch((error) => {
            this.status = error.message;
          });
        }
      } catch (error) {
        this.ensurePosition({
          persist: false,
          reflow: false
        });
        this.isShellVisible = true;
        this.status = error.message;
        this.render();
      }
    })();

    return this.initializationPromise;
  },

  mount(refs = {}) {
    this.refs = {
      actionMenu: refs.actionMenu || null,
      avatar: refs.avatar || null,
      attachmentInput: refs.attachmentInput || null,
      historyDialog: refs.historyDialog || null,
      historyShell: refs.historyShell || null,
      input: refs.input || null,
      panel: refs.panel || null,
      rawDialog: refs.rawDialog || null,
      scroller: refs.scroller || null,
      shell: refs.shell || null,
      settingsDialog: refs.settingsDialog || null,
      thread: refs.thread || null,
      uiBubbleContent: refs.uiBubbleContent || null
    };

    if (!this.resizeHandler) {
      this.resizeHandler = () => {
        this.ensurePosition({
          persist: true,
          reflow: true
        });
      };
      window.addEventListener("resize", this.resizeHandler);
    }

    if (!this.viewportVisibilityHandler) {
      this.viewportVisibilityHandler = () => {
        if (document.visibilityState === "hidden") {
          return;
        }

        this.ensurePosition({
          persist: true,
          reflow: true
        });

        if (this.huggingfaceManagerUnsubscribe) {
          void this.refreshHuggingFaceCatalog();
        }
      };
    }

    document.addEventListener("visibilitychange", this.viewportVisibilityHandler);
    window.addEventListener("focus", this.viewportVisibilityHandler);
    window.addEventListener("pageshow", this.viewportVisibilityHandler);

    if (!this.viewportVisibilityCheckTimer) {
      this.viewportVisibilityCheckTimer = window.setInterval(() => {
        if (document.visibilityState === "hidden") {
          return;
        }

        this.ensurePosition({
          persist: true
        });
      }, VIEWPORT_VISIBILITY_CHECK_INTERVAL_MS);
    }

    if (!this.dragMoveHandler) {
      this.dragMoveHandler = (event) => {
        this.handleAgentPointerMove(event);
      };
    }

    if (!this.dragEndHandler) {
      this.dragEndHandler = (event) => {
        this.handleAgentPointerUp(event);
      };
    }

    if (!this.historyResizeMoveHandler) {
      this.historyResizeMoveHandler = (event) => {
        this.handleHistoryResizePointerMove(event);
      };
    }

    if (!this.historyResizeEndHandler) {
      this.historyResizeEndHandler = (event) => {
        this.handleHistoryResizePointerUp(event);
      };
    }

    if (this.refs.input) {
      this.refs.input.value = this.draft;
      agentView.autoResizeTextarea(this.refs.input);
    }

    this.ensurePosition({
      reflow: true
    });
    this.renderUiBubbleContent();
    this.scheduleStartupHint();
    void this.init();
  },

  mountHistory(refs = {}) {
    this.refs.historyShell = refs.historyShell || null;
    this.refs.scroller = refs.scroller || null;
    this.refs.thread =
      refs.thread ||
      this.refs.scroller?.querySelector?.("[data-chat-thread]") ||
      this.refs.historyShell?.querySelector?.("[data-chat-thread]") ||
      null;
    this.render();

    runOnNextFrame(() => {
      this.scrollHistoryToLatest();
    });
  },

  unmountHistory() {
    this.cleanupHistoryResize();
    this.refs.historyShell = null;
    this.refs.scroller = null;
    this.refs.thread = null;
  },

  cleanupDrag() {
    if (this.dragState?.target?.releasePointerCapture && this.dragState.pointerId !== null) {
      try {
        this.dragState.target.releasePointerCapture(this.dragState.pointerId);
      } catch {
        // Ignore capture release issues.
      }
    }

    window.removeEventListener("pointermove", this.dragMoveHandler);
    window.removeEventListener("pointerup", this.dragEndHandler);
    window.removeEventListener("pointercancel", this.dragEndHandler);
    this.dragState = null;
  },

  cleanupHistoryResize() {
    if (this.historyResizeState?.target?.releasePointerCapture && this.historyResizeState.pointerId !== null) {
      try {
        this.historyResizeState.target.releasePointerCapture(this.historyResizeState.pointerId);
      } catch {
        // Ignore capture release issues.
      }
    }

    window.removeEventListener("pointermove", this.historyResizeMoveHandler);
    window.removeEventListener("pointerup", this.historyResizeEndHandler);
    window.removeEventListener("pointercancel", this.historyResizeEndHandler);
    this.historyResizeState = null;
  },

  unmount() {
    this.cleanupDrag();
    this.cleanupHistoryResize();
    this.cancelStreamingMessageRender();
    this.cancelPendingStreamingDelta();
    this.resetAttachmentDragState();
    this.clearStartupHintTimer();
    this.clearUiBubbleEnterTimer();
    this.clearUiBubbleAutoHideTimer();
    this.clearUiBubbleExitTimer();
    this.clearDisplayModeTransitionTimer();
    this.closeComposerActionMenu();
    this.activeUiBubble = null;
    this.compactAssistantBubble = null;
    this.compactAssistantBubbleMessageId = "";
    this.isStartupHintVisible = false;
    this.isUiBubbleMounted = false;
    this.uiBubblePhase = "";
    this.uiBubbleText = "";

    if (this.configPersistTimer) {
      window.clearTimeout(this.configPersistTimer);
      this.configPersistTimer = 0;
    }

    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.viewportVisibilityHandler) {
      document.removeEventListener("visibilitychange", this.viewportVisibilityHandler);
      window.removeEventListener("focus", this.viewportVisibilityHandler);
      window.removeEventListener("pageshow", this.viewportVisibilityHandler);
    }

    if (this.viewportVisibilityCheckTimer) {
      window.clearInterval(this.viewportVisibilityCheckTimer);
      this.viewportVisibilityCheckTimer = 0;
    }

    this.huggingfaceManagerUnsubscribe?.();
    this.huggingfaceManagerUnsubscribe = null;
    this.huggingface = createEmptyHuggingFaceState();

    this.refs = {
      actionMenu: null,
      avatar: null,
      attachmentInput: null,
      historyDialog: null,
      historyShell: null,
      input: null,
      panel: null,
      rawDialog: null,
      scroller: null,
      shell: null,
      settingsDialog: null,
      thread: null,
      uiBubbleContent: null
    };
  },

  handleAgentPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    this.cleanupHistoryResize();
    this.closeComposerActionMenu();
    this.dismissUiBubble();

    const target = event.currentTarget;

    this.dragState = {
      moved: false,
      originX: this.agentX,
      originY: this.agentY,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target
    };

    if (target?.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
    }

    window.addEventListener("pointermove", this.dragMoveHandler);
    window.addEventListener("pointerup", this.dragEndHandler);
    window.addEventListener("pointercancel", this.dragEndHandler);
    event.preventDefault();
  },

  handleAgentPointerMove(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.dragState.startX;
    const deltaY = event.clientY - this.dragState.startY;

    if (!this.dragState.moved && Math.hypot(deltaX, deltaY) >= DRAG_CLICK_THRESHOLD) {
      this.dragState.moved = true;
    }

    const nextX = this.dragState.originX + deltaX;
    const nextY = this.dragState.originY + deltaY;
    const nextHiddenEdge = this.getHiddenEdgeForPosition(nextX, nextY, {
      currentHiddenEdge: this.hiddenEdge
    });

    this.setPosition(this.dragState.originX + deltaX, this.dragState.originY + deltaY, {
      hiddenEdge: nextHiddenEdge,
      persist: false
    });
  },

  handleAgentPointerUp(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    const wasDrag = this.dragState.moved === true;
    this.cleanupDrag();

    if (wasDrag) {
      this.scheduleConfigPersist();
      return;
    }

    if (this.hiddenEdge) {
      this.revealHiddenEdge({
        persist: true,
        reflow: true
      });
      this.focusInput();
      return;
    }

    this.cycleDisplayMode();
  },

  handleHistoryResizePointerDown(event) {
    if (event.button !== 0 || !this.shouldShowHistory) {
      return;
    }

    const historyShell = this.refs.historyShell;
    const target = event.currentTarget;

    if (!historyShell || !target) {
      return;
    }

    this.cleanupDrag();
    this.cleanupHistoryResize();

    this.historyResizeState = {
      historyBelow: this.isHistoryBelow,
      pointerId: event.pointerId,
      startHeight: historyShell.offsetHeight || this.getClampedHistoryHeight() || this.getDefaultHistoryAutoMaxHeight(),
      startY: event.clientY,
      target
    };

    if (target?.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
    }

    window.addEventListener("pointermove", this.historyResizeMoveHandler);
    window.addEventListener("pointerup", this.historyResizeEndHandler);
    window.addEventListener("pointercancel", this.historyResizeEndHandler);
    event.preventDefault();
    event.stopPropagation();
  },

  handleHistoryResizePointerMove(event) {
    if (!this.historyResizeState || event.pointerId !== this.historyResizeState.pointerId) {
      return;
    }

    const deltaY = event.clientY - this.historyResizeState.startY;
    const direction = this.historyResizeState.historyBelow ? 1 : -1;
    this.historyHeight = this.getClampedHistoryHeight(this.historyResizeState.startHeight + deltaY * direction);
  },

  handleHistoryResizePointerUp(event) {
    if (!this.historyResizeState || event.pointerId !== this.historyResizeState.pointerId) {
      return;
    }

    const finalHeight = this.getClampedHistoryHeight(this.historyHeight) ?? this.historyResizeState.startHeight;
    const resized = Math.abs(finalHeight - this.historyResizeState.startHeight) >= 1;
    this.cleanupHistoryResize();

    if (resized) {
      this.scheduleConfigPersist();
    }
  },

  cycleDisplayMode() {
    this.setDisplayMode(getNextDisplayMode(this.displayMode));
  },

  showFullMode(options = {}) {
    this.setDisplayMode(DISPLAY_MODE_FULL, options);
  },

  showCompactMode(options = {}) {
    this.setDisplayMode(DISPLAY_MODE_COMPACT, options);
  },

  setDisplayMode(nextMode, options = {}) {
    const previousMode = this.displayMode;
    const normalizedMode = normalizeDisplayMode(nextMode);
    const shouldPersist = options.persist !== false;
    const shouldHideBubble = options.hideBubble === true || normalizedMode === DISPLAY_MODE_FULL;
    const shouldFocusInput = options.focusInput !== false;
    const modeChanged = normalizedMode !== this.displayMode;
    const shouldScrollToLatestOnRender = normalizedMode === DISPLAY_MODE_FULL && previousMode !== DISPLAY_MODE_FULL;
    const revealedHiddenEdge = this.revealHiddenEdge({
      persist: shouldPersist,
      reflow: false
    });

    this.displayMode = normalizedMode;
    this.startDisplayModeTransition(
      modeChanged
        ? normalizedMode === DISPLAY_MODE_FULL
          ? "expanding"
          : "collapsing"
        : ""
    );
    this.closeComposerActionMenu();

    if (shouldPersist && modeChanged && !revealedHiddenEdge) {
      this.scheduleConfigPersist();
    }

    if (shouldHideBubble) {
      this.dismissUiBubble();
    }

    this.render({
      preserveScroll: !shouldScrollToLatestOnRender
    });

    if (shouldScrollToLatestOnRender) {
      this.scrollHistoryToLatest();
    }

    if (shouldFocusInput) {
      this.focusInput();
    }
  },

  async ensureDefaultSystemPrompt(options = {}) {
    const preserveStatus = options.preserveStatus === true;

    if (!this.defaultSystemPrompt || options.forceRefresh === true) {
      this.isLoadingDefaultSystemPrompt = true;

      try {
        this.defaultSystemPrompt = await agentLlm.fetchDefaultOnscreenAgentSystemPrompt({
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

  async refreshRuntimeSystemPrompt(options = {}) {
    await this.rebuildPromptInput({
      history: Array.isArray(options.history) ? options.history : this.history
    });
    return this.runtimeSystemPrompt;
  },

  cancelStreamingMessageRender() {
    if (this.streamingRenderFrame) {
      window.cancelAnimationFrame(this.streamingRenderFrame);
      this.streamingRenderFrame = 0;
    }

    this.pendingStreamingMessage = null;
  },

  applyPendingStreamingDelta() {
    const pendingMessage = this.pendingStreamingDeltaMessage;
    const pendingDelta = this.pendingStreamingDelta;
    this.pendingStreamingDelta = "";
    this.pendingStreamingDeltaMessage = null;

    if (!pendingMessage || pendingMessage.role !== "assistant" || !pendingDelta) {
      return false;
    }

    pendingMessage.content += pendingDelta;
    this.setStreamingAssistantStatus(pendingMessage.content);
    this.maybeShowCompactStreamingAssistantBubble(pendingMessage);
    this.scheduleStreamingMessageRender(pendingMessage);
    return true;
  },

  cancelPendingStreamingDelta() {
    if (this.pendingStreamingDeltaFrame) {
      window.cancelAnimationFrame(this.pendingStreamingDeltaFrame);
      this.pendingStreamingDeltaFrame = 0;
    }

    this.pendingStreamingDelta = "";
    this.pendingStreamingDeltaMessage = null;
  },

  flushPendingStreamingDelta() {
    if (this.pendingStreamingDeltaFrame) {
      window.cancelAnimationFrame(this.pendingStreamingDeltaFrame);
      this.pendingStreamingDeltaFrame = 0;
    }

    return this.applyPendingStreamingDelta();
  },

  queueStreamingDelta(message, delta) {
    if (!message || message.role !== "assistant" || typeof delta !== "string" || !delta) {
      return;
    }

    if (this.pendingStreamingDeltaMessage && this.pendingStreamingDeltaMessage !== message) {
      this.flushPendingStreamingDelta();
    }

    this.pendingStreamingDeltaMessage = message;
    this.pendingStreamingDelta += delta;

    if (this.pendingStreamingDeltaFrame) {
      return;
    }

    this.pendingStreamingDeltaFrame = window.requestAnimationFrame(() => {
      this.pendingStreamingDeltaFrame = 0;
      this.applyPendingStreamingDelta();
    });
  },

  scheduleStreamingMessageRender(message) {
    if (!message || message.role !== "assistant" || message.streaming !== true) {
      return;
    }

    this.pendingStreamingMessage = message;

    if (this.streamingRenderFrame || !this.isFullMode) {
      return;
    }

    this.streamingRenderFrame = window.requestAnimationFrame(() => {
      this.streamingRenderFrame = 0;
      const pendingMessage = this.pendingStreamingMessage;
      this.pendingStreamingMessage = null;

      if (!pendingMessage || !this.refs.thread || !this.isFullMode) {
        return;
      }

      const didPatchStreamingRow = agentView.updateStreamingAssistantMessage(this.refs.thread, pendingMessage, {
        scroller: this.refs.scroller
      });

      if (!didPatchStreamingRow) {
        this.render({
          preserveScroll: true
        });
      }
    });
  },

  render(options = {}) {
    if (!this.isFullMode) {
      return;
    }

    agentView.renderMessages(this.refs.thread, this.history, {
      isConversationBusy: this.isSending,
      outputOverrides: this.executionOutputOverrides,
      preserveScroll: options.preserveScroll === true,
      queuedMessages: this.getQueuedPreviewMessages(),
      rerunningMessageId: this.rerunningMessageId,
      scroller: this.refs.scroller
    });
  },

  scrollHistoryToLatest() {
    const applyScroll = () => {
      const scroller = this.refs.scroller;

      if (!scroller || !this.isFullMode) {
        return;
      }

      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        applyScroll();

        window.requestAnimationFrame(() => {
          applyScroll();
        });
      });
    });
  },

  focusInput() {
    const input = this.refs.input;

    if (!input || input.disabled || this.hiddenEdge) {
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
    return this.queuedSubmissions.map((submission, index) =>
      createMessage("user", submission.content, {
        attachments: Array.isArray(submission.attachments) ? submission.attachments.slice() : [],
        kind: "queued"
      })
    ).map((message, index) => ({
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

  closeComposerActionMenu() {
    this.composerActionMenuAnchor = null;
    this.composerActionMenuRenderToken += 1;
    this.isComposerActionMenuVisible = false;
    this.composerActionMenuPosition = createComposerActionMenuPosition();
  },

  openComposerActionMenu(anchor) {
    this.composerActionMenuAnchor = anchor || null;
    this.composerActionMenuRenderToken += 1;
    this.isComposerActionMenuVisible = false;
    const renderToken = this.composerActionMenuRenderToken;

    globalThis.requestAnimationFrame(() => {
      if (!this.isComposerActionMenuOpen || this.composerActionMenuRenderToken !== renderToken) {
        return;
      }

      this.positionComposerActionMenu();

      globalThis.requestAnimationFrame(() => {
        if (!this.isComposerActionMenuOpen || this.composerActionMenuRenderToken !== renderToken) {
          return;
        }

        this.positionComposerActionMenu();
        this.isComposerActionMenuVisible = true;
      });
    });
  },

  positionComposerActionMenu() {
    const actionMenu = this.refs.actionMenu || document.getElementById("onscreen-agent-composer-menu");

    if (!this.isComposerActionMenuOpen || !actionMenu || !this.composerActionMenuAnchor) {
      return;
    }

    this.refs.actionMenu = actionMenu;
    this.composerActionMenuPosition = positionPopover(actionMenu, this.composerActionMenuAnchor, {
      align: "end",
      placement: this.shouldOpenComposerActionMenuBelow ? "bottom" : "top"
    });
  },

  async submitComposerActionMenuAction(actionId) {
    this.closeComposerActionMenu();

    switch (actionId) {
      case "full-mode":
        this.showFullMode();
        return;
      case "attach":
        this.openAttachmentPicker();
        return;
      case "clear":
        if (this.isClearDisabled) {
          return;
        }

        await this.handleClearClick();
        return;
      case "compact-history":
        if (this.isCompactDisabled) {
          return;
        }

        await this.handleCompactClick();
        return;
      case "history":
        runOnNextFrame(() => {
          void this.openPromptHistoryDialog();
        });
        return;
      case "settings":
        runOnNextFrame(() => {
          this.openSettingsDialog();
        });
        return;
      default:
        return;
    }
  },

  toggleComposerActionMenu(event) {
    const anchor = event?.currentTarget || null;

    if (!anchor) {
      return;
    }

    if (this.composerActionMenuAnchor === anchor) {
      this.closeComposerActionMenu();
      return;
    }

    this.openComposerActionMenu(anchor);
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
      this.handleComposerSubmitAction();
    }
  },

  handleComposerSubmitAction() {
    if (this.isSending) {
      this.queueDraftSubmission();
      return;
    }

    void this.submitMessage();
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

  openSettingsDialog() {
    this.settingsDraft = {
      ...this.settings
    };
    this.syncHuggingFaceFromManager();
    this.prefillSettingsDraftDefaultHuggingFaceModel();

    if (!String(this.settingsDraft.huggingfaceDtype || "").trim()) {
      this.settingsDraft.huggingfaceDtype =
        DTYPE_OPTIONS[0]?.value || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.huggingfaceDtype;
    }

    this.systemPromptDraft = this.systemPrompt;
    void this.warmSettingsDraftLocalProvider().catch((error) => {
      this.status = error.message;
    });
    openDialog(resolveDialogRef(this.refs, "settingsDialog", SETTINGS_DIALOG_ELEMENT_ID));
  },

  closeSettingsDialog() {
    closeDialog(resolveDialogRef(this.refs, "settingsDialog", SETTINGS_DIALOG_ELEMENT_ID));
  },

  setSettingsProvider(provider) {
    this.settingsDraft = {
      ...this.settingsDraft,
      provider: config.normalizeOnscreenAgentLlmProvider(provider)
    };

    if (this.isSettingsDraftUsingLocalProvider) {
      this.prefillSettingsDraftDefaultHuggingFaceModel();
      void this.warmSettingsDraftLocalProvider().catch((error) => {
        this.status = error.message;
      });
    }
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

  requestOnscreenHuggingFaceModelUnload() {
    if (!this.canOnscreenUnloadHuggingFaceModel) {
      return;
    }

    void this.ensureHuggingFaceSubscription()
      .then(() => huggingfaceManager.unloadModel({
        clearPersistedSelection: false,
        reboot: false
      }))
      .then(() => this.syncHuggingFaceFromManager())
      .catch((error) => {
        this.status = error.message;
      });
  },

  requestOnscreenSelectedHuggingFaceModelAction() {
    if (!this.canOnscreenActOnSelectedHuggingFaceModel) {
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
          this.huggingface.activeModelId === selectedModelId &&
          this.huggingface.activeDtype === selectedDtype
        ) {
          this.status = `Unloading ${selectedModelId}...`;
          return huggingfaceManager.unloadModel({
            clearPersistedSelection: false,
            reboot: false
          });
        }

        this.status = this.isSavedHuggingFaceModel(selectedModelId, selectedDtype)
          ? `Loading ${selectedModelId} for local overlay chat...`
          : `Downloading and loading ${selectedModelId} for local overlay chat...`;
        return huggingfaceManager.loadModel({
          dtype: selectedDtype,
          modelInput: selectedModelId
        });
      })
      .then(() => this.syncHuggingFaceFromManager())
      .catch((error) => {
        this.status = error.message;
      });
  },

  openHuggingFaceConfiguration() {
    huggingfaceManager.openConfiguration();
  },

  resetSettingsDraftToDefaults() {
    const preservedApiKey =
      typeof this.settingsDraft.apiKey === "string" ? this.settingsDraft.apiKey : "";

    this.settingsDraft = {
      ...config.DEFAULT_ONSCREEN_AGENT_SETTINGS,
      apiKey: preservedApiKey
    };
    this.status = "LLM settings draft reset to defaults except API key.";
  },

  async saveSettingsFromDialog() {
    const provider = config.normalizeOnscreenAgentLlmProvider(this.settingsDraft.provider);
    const localProvider = config.normalizeOnscreenAgentLocalProvider(this.settingsDraft.localProvider);
    const paramsText = typeof this.settingsDraft.paramsText === "string" ? this.settingsDraft.paramsText.trim() : "";
    const draftPrompt = typeof this.systemPromptDraft === "string" ? this.systemPromptDraft.trim() : "";
    let maxTokens = config.DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens;

    try {
      maxTokens = config.parseOnscreenAgentMaxTokens(this.settingsDraft.maxTokens);
      llmParams.parseOnscreenAgentParamsText(paramsText);

      if (provider === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
        const huggingfaceModel = normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || "");
        const huggingfaceDtype = String(this.settingsDraft.huggingfaceDtype || "").trim();

        if (!huggingfaceModel || !huggingfaceDtype) {
          throw new Error("Choose a Hugging Face model and dtype before saving.");
        }
      }
    } catch (error) {
      this.status = error.message;
      return;
    }

    this.settings = {
      apiEndpoint: (this.settingsDraft.apiEndpoint || "").trim(),
      apiKey: (this.settingsDraft.apiKey || "").trim(),
      huggingfaceDtype: (this.settingsDraft.huggingfaceDtype || "").trim(),
      huggingfaceModel: normalizeHuggingFaceModelInput(this.settingsDraft.huggingfaceModel || ""),
      localProvider,
      maxTokens,
      model: (this.settingsDraft.model || "").trim(),
      paramsText,
      provider
    };
    this.systemPrompt = draftPrompt;
    this.systemPromptDraft = draftPrompt;

    try {
      await this.refreshRuntimeSystemPrompt();
      await this.persistConfig();
      this.status = provider === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL
        ? `Local ${getConfiguredLocalProviderLabel(this.settings)} settings updated. Preparing the selected model in the background.`
        : "API chat settings updated.";
      this.closeSettingsDialog();

      if (provider === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
        void this.autoLoadConfiguredLocalModel(this.settings).catch((error) => {
          this.status = error.message;
        });
      }
    } catch (error) {
      this.status = error.message;
    }
  },

  openRawDialogForMessage(messageId) {
    const message = this.history.find((entry) => entry.id === messageId && entry.role === "assistant");

    if (!message) {
      this.status = "That assistant message is no longer available.";
      return;
    }

    this.rawOutputTitle = "Raw LLM Output";
    this.rawOutputContent = typeof message.content === "string" ? message.content : "";
    openDialog(resolveDialogRef(this.refs, "rawDialog", RAW_DIALOG_ELEMENT_ID));
  },

  closeRawDialog() {
    closeDialog(resolveDialogRef(this.refs, "rawDialog", RAW_DIALOG_ELEMENT_ID));
  },

  async openPromptHistoryDialog() {
    try {
      this.flushPendingStreamingDelta();

      if (!this.promptInput) {
        await this.refreshRuntimeSystemPrompt();
      }

      const totalTokens = this.historyTokenCount;
      this.promptHistoryTitle = `Context window (${totalTokens.toLocaleString()} tokens)`;
      this.promptHistoryMode = "text";
      this.promptHistoryTargetMessageIndex = -1;
      openDialog(resolveDialogRef(this.refs, "historyDialog", HISTORY_DIALOG_ELEMENT_ID));
      this.schedulePromptHistoryScroll(-1);
    } catch (error) {
      this.status = error.message;
    }
  },

  closePromptHistoryDialog() {
    closeDialog(resolveDialogRef(this.refs, "historyDialog", HISTORY_DIALOG_ELEMENT_ID));
  },

  setPromptHistoryMode(mode) {
    this.promptHistoryMode = mode === "json" ? "json" : "text";
    this.schedulePromptHistoryScroll(this.promptHistoryTargetMessageIndex);
  },

  getPromptHistorySliceMessages(slice = "all") {
    return getPromptHistoryMessageSlice(this.promptHistoryMessages, slice, this.promptHistoryEntries);
  },

  serializePromptHistorySlice(slice = "all") {
    const messages = this.getPromptHistorySliceMessages(slice);

    if (slice === "system" && this.promptHistoryMode !== "json") {
      return formatPromptHistorySystemPromptText(messages);
    }

    if (slice === "system" && this.promptHistoryMode === "json") {
      return messages.length === 1 ? formatPromptHistoryMessageJson(messages[0]) : formatPromptHistoryJson(messages);
    }

    return serializePromptHistoryMessages(messages, this.promptHistoryMode);
  },

  getPromptHistoryFrame() {
    const dialog = resolveDialogRef(this.refs, "historyDialog", HISTORY_DIALOG_ELEMENT_ID);
    return dialog?.querySelector?.("[data-prompt-history-frame]") || null;
  },

  getPromptHistoryJsonOutput() {
    const dialog = resolveDialogRef(this.refs, "historyDialog", HISTORY_DIALOG_ELEMENT_ID);
    return dialog?.querySelector?.("[data-prompt-history-json-output]") || null;
  },

  schedulePromptHistoryScroll(messageIndex = -1) {
    window.requestAnimationFrame(() => {
      this.scrollPromptHistoryToMessage(messageIndex);
    });
  },

  scrollPromptHistoryToMessage(messageIndex = -1) {
    const frame = this.getPromptHistoryFrame();

    if (!frame) {
      return;
    }

    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
      frame.scrollTo({
        behavior: "auto",
        left: 0,
        top: 0
      });
      return;
    }

    if (this.promptHistoryMode === "json") {
      const output = this.getPromptHistoryJsonOutput();
      const startLineIndex = this.promptHistoryJsonMessageStartLines[messageIndex];

      if (!output || !Number.isInteger(startLineIndex)) {
        return;
      }

      const outputStyle = window.getComputedStyle(output);
      const paddingTop = Number.parseFloat(outputStyle.paddingTop) || 0;
      const fontSize = Number.parseFloat(outputStyle.fontSize) || 16;
      const lineHeight = Number.parseFloat(outputStyle.lineHeight) || fontSize * 1.4;
      const nextTop = Math.max(
        0,
        getOffsetTopWithinAncestor(output, frame) + paddingTop + startLineIndex * lineHeight
      );

      frame.scrollTo({
        behavior: "auto",
        left: 0,
        top: nextTop
      });
      return;
    }

    const target = frame.querySelector(`[data-prompt-history-message-index="${messageIndex}"]`);

    if (!target) {
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const nextTop = Math.max(0, frame.scrollTop + targetRect.top - frameRect.top);

    frame.scrollTo({
      behavior: "auto",
      left: 0,
      top: nextTop
    });
  },

  jumpToFirstPromptHistoryUserMessage() {
    const [firstUserMessageIndex] = this.promptHistoryUserMessageIndexes;

    if (!Number.isInteger(firstUserMessageIndex)) {
      return;
    }

    this.promptHistoryTargetMessageIndex = firstUserMessageIndex;
    this.schedulePromptHistoryScroll(firstUserMessageIndex);
  },

  jumpToAdjacentPromptHistoryUserMessage(direction = 1) {
    const userMessageIndexes = this.promptHistoryUserMessageIndexes;

    if (!userMessageIndexes.length) {
      return;
    }

    const activePosition = this.promptHistoryActiveUserMessagePosition;
    let nextPosition = -1;

    if (direction < 0) {
      if (activePosition > 0) {
        nextPosition = activePosition - 1;
      }
    } else if (activePosition === -1) {
      nextPosition = 0;
    } else if (activePosition < userMessageIndexes.length - 1) {
      nextPosition = activePosition + 1;
    }

    if (nextPosition === -1) {
      return;
    }

    const nextMessageIndex = userMessageIndexes[nextPosition];

    this.promptHistoryTargetMessageIndex = nextMessageIndex;
    this.schedulePromptHistoryScroll(nextMessageIndex);
  },

  jumpToPreviousPromptHistoryUserMessage() {
    this.jumpToAdjacentPromptHistoryUserMessage(-1);
  },

  jumpToNextPromptHistoryUserMessage() {
    this.jumpToAdjacentPromptHistoryUserMessage(1);
  },

  async copyPromptHistorySlice(slice = "all") {
    const sliceMessages = this.getPromptHistorySliceMessages(slice);
    const label =
      slice === "system" ? "system prompt" : slice === "history" ? "history" : "context window";
    const payload = this.serializePromptHistorySlice(slice);

    if (!sliceMessages.length || !payload) {
      this.status =
        slice === "system"
          ? "No system prompt available."
          : slice === "history"
            ? "No history available."
            : "No context window available.";
      return;
    }

    const copied = await agentView.copyTextToClipboard(payload);
    this.status = copied ? `${label[0].toUpperCase()}${label.slice(1)} copied.` : `Unable to copy ${label}.`;
  },

  async copyPromptHistorySystemPrompt() {
    await this.copyPromptHistorySlice("system");
  },

  async copyPromptHistoryHistory() {
    await this.copyPromptHistorySlice("history");
  },

  async copyPromptHistoryAll() {
    await this.copyPromptHistorySlice("all");
  },

  async handleClearClick() {
    if (this.isClearDisabled) {
      return;
    }

    this.closeComposerActionMenu();
    this.closeRawDialog();
    this.rawOutputContent = "";
    this.clearComposerDraft();
    this.queuedSubmissions = [];
    this.cancelStreamingMessageRender();
    this.cancelPendingStreamingDelta();
    await this.replaceHistory([], {
      refreshPrompt: false
    });
    this.executionOutputOverrides = Object.create(null);
    this.rerunningMessageId = "";
    this.stopRequested = false;
    this.activeRequestController?.abort();
    this.activeRequestController = null;
    this.dismissUiBubble({
      clearActive: true
    });
    this.compactAssistantBubble = null;
    this.compactAssistantBubbleMessageId = "";

    if (this.chatRuntime?.attachments) {
      this.chatRuntime.attachments.clear();
    }

    if (this.chatRuntime?.transient) {
      this.chatRuntime.transient.clear();
    }

    if (this.executionContext) {
      this.executionContext.reset();
    }

    await this.refreshRuntimeSystemPrompt();
    await this.persistHistory({
      immediate: true
    });
    this.render();
    this.status = "Chat cleared and execution context reset.";
  },

  async streamAssistantResponse(requestMessages, assistantMessage, preparedRequest) {
    let hasSeenDelta = false;
    const usingLocalProvider =
      config.normalizeOnscreenAgentLlmProvider(this.settings.provider) === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL;

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
      this.status = "Thinking...";
    }

    const controller = new AbortController();
    this.activeRequestController = controller;
    let responseMeta = null;

    try {
      responseMeta = await agentApi.streamOnscreenAgentCompletion({
        preparedRequest,
        onDelta: (delta) => {
          if (!hasSeenDelta) {
            hasSeenDelta = true;

            if (this.isFullMode) {
              this.status = "Streaming response...";
            }
          }

          this.queueStreamingDelta(assistantMessage, delta);
        },
        signal: controller.signal
      });
    } catch (error) {
      this.flushPendingStreamingDelta();
      assistantMessage.streaming = false;
      this.cancelStreamingMessageRender();

      if (this.activeRequestController === controller) {
        this.activeRequestController = null;
      }

      if (isAbortError(error) && this.stopRequested) {
        let hasContent = Boolean(assistantMessage.content.trim());

        if (hasContent) {
          applyConversationMessage(
            assistantMessage,
            await resolveProcessedOnscreenAgentMessage({
              history: requestMessages,
              message: assistantMessage,
              phase: "assistant-response",
              responseMeta,
              store: this
            })
          );
          hasContent = Boolean(assistantMessage.content.trim());
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

    this.flushPendingStreamingDelta();
    assistantMessage.streaming = false;
    this.cancelStreamingMessageRender();

    if (this.activeRequestController === controller) {
      this.activeRequestController = null;
    }

    applyConversationMessage(
      assistantMessage,
      await resolveProcessedOnscreenAgentMessage({
        history: requestMessages,
        message: assistantMessage,
        phase: "assistant-response",
        responseMeta,
        store: this
      })
    );
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
      await this.refreshHistoryMetrics();
    } catch (error) {
      this.status = error.message;
      return;
    }

    await this.compactHistory();
  },

  async compactHistory(options = {}) {
    const historyText = this.historyText.trim();
    const mode =
      options.mode === agentLlm.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
        ? agentLlm.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
        : agentLlm.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER;
    const preserveFocus = options.preserveFocus !== false;
    const statusText =
      typeof options.statusText === "string" && options.statusText.trim()
        ? options.statusText.trim()
        : mode === agentLlm.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
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
      const compactPrompt = await agentLlm.fetchOnscreenAgentHistoryCompactPrompt({
        mode
      });
      if (config.normalizeOnscreenAgentLlmProvider(this.settings.provider) === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
        await this.ensureActiveLocalRuntime(this.settings);
      }

      let trimmedHistoryText = historyText;

      for (let attempt = 0; attempt < MAX_COMPACT_TRIM_ATTEMPTS; attempt += 1) {
        let compactedHistory = "";
        let compactionError = null;

        try {
          await agentApi.streamOnscreenAgentCompletion({
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
        } catch (error) {
          compactionError = error;
        }

        if (!compactionError) {
          const normalizedCompactedHistory = compactedHistory.trim();

          if (!normalizedCompactedHistory) {
            throw new Error("History compaction returned no content.");
          }

          const compactedMessage = await createProcessedMessage(
            "user",
            normalizedCompactedHistory,
            {
              kind: "history-compact"
            },
            {
              history: this.history,
              mode,
              phase: "history-compact",
              store: this
            }
          );
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
      this.status = error.message;
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

  async executeAssistantBlocks(assistantContent) {
    const executionResults = await this.executionContext.executeFromContent(assistantContent, {
      onBeforeBlock: async ({ code, index, total }) => {
        if (!total) {
          return;
        }

        this.status = getExecutionStatusText(code, index, total);
      }
    });

    if (!executionResults.length) {
      return null;
    }

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
        this.status = error.message;
        return "failed";
      }

      const requestTokenCount = countTextTokens(
        formatPromptHistoryText(preparedRequest?.promptInput?.requestMessages)
      );

      if (requestTokenCount > this.getConfiguredMaxTokens()) {
        const pendingMessageIsLatestHistoryMessage = this.history[this.history.length - 1]?.id === nextUserMessage.id;
        const compactedMessage = await this.compactHistory({
          mode: agentLlm.ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC,
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
          this.status = error.message;
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
        const hasAssistantContent = Boolean(assistantMessage.content.trim());

        if (hasAssistantContent) {
          this.showCompactAssistantReplyBubble(assistantMessage.content, {
            messageId: assistantMessage.id
          });
        }

        if (boundaryActionAfterResponse) {
          return boundaryActionAfterResponse;
        }

        if (!hasAssistantContent) {
          if (emptyAssistantRetryCount < MAX_PROTOCOL_RETRY_COUNT) {
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

            nextUserMessage = await createProcessedMessage(
              "user",
              buildProtocolRetryMessage(),
              {
                kind: "protocol-retry"
              },
              {
                history: requestMessages,
                phase: "protocol-retry",
                responseMeta: streamResult.responseMeta,
                store: this
              }
            );
            this.status = hasVerifiedEmptyAssistantResponse(streamResult)
              ? "Retrying: assistant response was empty..."
              : "Retrying: no usable assistant content was received...";
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
      const executionResults = await this.executeAssistantBlocks(assistantMessage.content);

      if (!executionResults || !executionResults.length) {
        return "complete";
      }

      this.executionOutputOverrides[assistantMessage.id] = execution.createExecutionOutputSnapshots(executionResults);

      const executionOutputMessage = await createProcessedMessage(
        "user",
        execution.formatExecutionResultsMessage(executionResults),
        {
          kind: "execution-output"
        },
        {
          executionResults,
          history: this.history,
          phase: "execution-output",
          store: this
        }
      );

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

        if (outcome === "failed") {
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
      this.status = error.message;
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

    const userMessage = await createProcessedMessage(
      "user",
      draftSubmission.content,
      {
        attachments: draftSubmission.attachments
      },
      {
        draftSubmission,
        history: this.history,
        phase: "submit",
        store: this
      }
    );
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
        const copyPayload = agentView.getAssistantMessageCopyText(
          this.history,
          messageId,
          this.executionOutputOverrides
        );
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
    const inputMessage = findConversationInputMessage(this.history, messageId);
    this.chatRuntime.attachments.setActiveMessage(inputMessage?.id || "");
    this.render({
      preserveScroll: true
    });

    try {
      const executionResults = await this.executeAssistantBlocks(section.message.content);

      if (!executionResults || !executionResults.length) {
        this.status = "No execution code found to rerun.";
        return;
      }

      this.executionOutputOverrides[messageId] = execution.createExecutionOutputSnapshots(executionResults);
      this.status = "Execution refreshed.";
    } catch (error) {
      this.status = error.message;
    } finally {
      this.isSending = false;
      this.rerunningMessageId = "";
      this.render({
        preserveScroll: true
      });
    }
  }
};

const onscreenAgent = space.fw.createStore("onscreenAgent", model);
ensureOnscreenAgentRuntimeNamespace(onscreenAgent);

export { onscreenAgent };
