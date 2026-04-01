import { createStore } from "/mod/_core/framework/AlpineStore.js";
import { initializeRuntime } from "/mod/_core/framework/runtime.js";
import { buildPromptMessages, streamChatCompletion } from "/mod/_core/chat/api.js";
import {
  createExecutionOutputSnapshots,
  createExecutionContext,
  formatExecutionResultsMessage
} from "/mod/_core/chat/execution-context.js";
import { fetchDefaultSystemPrompt } from "/mod/_core/chat/system-prompt.js";
import {
  clearChatDraft,
  clearChatHistory,
  clearSystemPrompt,
  loadChatDraft,
  loadChatHistory,
  loadChatSettings,
  loadSystemPrompt,
  saveChatDraft,
  saveChatHistory,
  saveChatSettings,
  saveSystemPrompt
} from "/mod/_core/chat/storage.js";
import {
  autoResizeTextarea,
  copyTextToClipboard,
  findExecuteSection,
  getTerminalInputText,
  getTerminalOutputText,
  renderMessages,
  summarizeLlmConfig,
  summarizeSystemPrompt
} from "/mod/_core/chat/chat-view.js";
import {
  createAttachmentRuntime,
  createDraftAttachments,
  normalizeStoredMessage,
  serializeAttachmentMetadata
} from "/mod/_core/chat/attachments.js";
import { parseLlmParamsText } from "/mod/_core/chat/llm-params.js";

const runtime = initializeRuntime({
  proxyPath: "/api/proxy"
});

function ensureCurrentChatRuntime(targetRuntime) {
  if (!targetRuntime.currentChat || typeof targetRuntime.currentChat !== "object") {
    targetRuntime.currentChat = {};
  }

  if (!Array.isArray(targetRuntime.currentChat.messages)) {
    targetRuntime.currentChat.messages = [];
  }

  if (!targetRuntime.currentChat.attachments || typeof targetRuntime.currentChat.attachments !== "object") {
    targetRuntime.currentChat.attachments = createAttachmentRuntime();
  }

  return targetRuntime.currentChat;
}

ensureCurrentChatRuntime(runtime);

function createMessage(role, content, options = {}) {
  return {
    attachments: Array.isArray(options.attachments) ? options.attachments.slice() : [],
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: typeof options.kind === "string" ? options.kind : "",
    role,
    content
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

function openDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
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

const MAX_PROTOCOL_RETRY_COUNT = 2;

function summarizeProtocolMessage(message, maxLength = 280) {
  const normalizedMessage = typeof message === "string" ? message.replace(/\s+/g, " ").trim() : "";

  if (normalizedMessage.length <= maxLength) {
    return normalizedMessage;
  }

  return `${normalizedMessage.slice(0, maxLength - 3)}...`;
}

function isExecutionFollowUpKind(kind) {
  return kind === "execution-output" || kind === "execution-retry";
}

function executionResultHasUsableOutput(result) {
  if (result?.error) {
    return true;
  }

  if (result?.result !== undefined) {
    return true;
  }

  return Array.isArray(result?.logs) && result.logs.length > 0;
}

function executionResultsNeedReturnedValue(results) {
  if (!Array.isArray(results) || !results.length) {
    return false;
  }

  return results.every((result) => !executionResultHasUsableOutput(result));
}

function buildMissingExecutionResultRetryMessage(executionOutputText) {
  const summarizedOutput = summarizeProtocolMessage(executionOutputText);

  return [
    "Protocol correction: the last browser execution finished but returned no result.",
    `Execution output: "${summarizedOutput}"`,
    "Agent One already runs your JavaScript inside an async function.",
    "Use top-level await directly and end with a top-level return for the value you need.",
    "Do not wrap the whole snippet in an async IIFE like `(async () => { ... })()` unless you also return it.",
    "Execute again now. Do not stop until you have a result or a clear error."
  ].join("\n");
}

function buildEmptyAssistantRetryMessage(executionOutputText) {
  const summarizedOutput = summarizeProtocolMessage(executionOutputText);

  return [
    "Protocol correction: your last reply after browser execution was empty.",
    `Execution output: "${summarizedOutput}"`,
    "Read the execution output and continue.",
    "If another browser step is needed, execute again now.",
    "Do not stop until you provide a user-facing answer or a clear error."
  ].join("\n");
}

const model = {
  focusFrameId: 0,
  runtime,
  layoutFrameId: 0,
  layoutResizeHandler: null,
  refs: {
    composerWrap: null,
    input: null,
    attachmentInput: null,
    historyDialog: null,
    rawDialog: null,
    settingsDialog: null,
    systemDialog: null,
    thread: null
  },
  defaultSystemPrompt: "",
  draft: loadChatDraft(),
  draftAttachments: [],
  executionContext: null,
  executionOutputOverrides: Object.create(null),
  history: loadChatHistory().map((message) => normalizeStoredMessage(message)),
  isLoadingDefaultSystemPrompt: false,
  isSending: false,
  promptHistoryMessages: [],
  promptHistoryMode: "text",
  promptHistoryTitle: "Prompt History",
  rawOutputContent: "",
  rawOutputTitle: "Raw LLM Output",
  rerunningMessageId: "",
  settings: loadChatSettings(),
  settingsDraft: loadChatSettings(),
  status: "Ready.",
  systemPrompt: loadSystemPrompt(),
  systemPromptDraft: loadSystemPrompt(),

  get composerPlaceholder() {
    const statusText = typeof this.status === "string" ? this.status.trim() : "";

    if (!statusText) {
      return "Message Agent One...";
    }

    return statusText === "Ready." ? "Ready. Message Agent One..." : statusText;
  },

  get isComposerInputDisabled() {
    return false;
  },

  get isComposerSubmitDisabled() {
    return this.isSending || this.isLoadingDefaultSystemPrompt || (!this.draft.trim() && !this.draftAttachments.length);
  },

  get llmSummary() {
    return summarizeLlmConfig(this.settings.apiEndpoint, this.settings.model);
  },

  get promptSummary() {
    return summarizeSystemPrompt(this.systemPrompt);
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
      role: typeof message?.role === "string" ? message.role.toUpperCase() : "UNKNOWN"
    }));
  },

  init() {
    this.executionContext = createExecutionContext({
      targetWindow: window
    });
    this.syncCurrentChatRuntime();

    this.status = this.systemPrompt.trim() ? "Ready." : "Loading default system prompt...";

    if (!this.systemPrompt.trim()) {
      this.isLoadingDefaultSystemPrompt = true;
    }

    this.ensureDefaultSystemPrompt({
      preserveStatus: Boolean(this.systemPrompt.trim())
    })
      .then(() => {
        this.focusInput();
      })
      .catch((error) => {
        this.isLoadingDefaultSystemPrompt = false;
        this.status = this.systemPrompt.trim() ? "Ready." : error.message;
        this.render();
      });
  },

  mount(refs = {}) {
    if (!this.executionContext) {
      this.init();
    }

    this.refs = {
      composerWrap: refs.composerWrap || null,
      input: refs.input || null,
      attachmentInput: refs.attachmentInput || null,
      historyDialog: refs.historyDialog || null,
      rawDialog: refs.rawDialog || null,
      settingsDialog: refs.settingsDialog || null,
      systemDialog: refs.systemDialog || null,
      thread: refs.thread || null
    };

    if (!this.layoutResizeHandler) {
      this.layoutResizeHandler = () => {
        this.scheduleLayoutUpdate();
      };
      window.addEventListener("resize", this.layoutResizeHandler);
    }

    this.settingsDraft = {
      ...this.settings
    };
    this.systemPromptDraft = this.systemPrompt || this.defaultSystemPrompt;

    if (this.refs.input) {
      this.refs.input.value = this.draft;
      autoResizeTextarea(this.refs.input);
    }

    this.render();
    this.focusInput();
  },

  unmount() {
    if (this.focusFrameId) {
      window.cancelAnimationFrame(this.focusFrameId);
      this.focusFrameId = 0;
    }

    if (this.layoutFrameId) {
      window.cancelAnimationFrame(this.layoutFrameId);
      this.layoutFrameId = 0;
    }

    if (this.layoutResizeHandler) {
      window.removeEventListener("resize", this.layoutResizeHandler);
      this.layoutResizeHandler = null;
    }

    document.body.style.removeProperty("--chat-footer-clearance");
    document.body.style.removeProperty("--chat-footer-blur-height");

    this.refs = {
      composerWrap: null,
      input: null,
      attachmentInput: null,
      historyDialog: null,
      rawDialog: null,
      settingsDialog: null,
      systemDialog: null,
      thread: null
    };
  },

  async ensureDefaultSystemPrompt(options = {}) {
    const shouldReplaceSystemPrompt = options.replaceCurrent === true;
    const preserveStatus = options.preserveStatus === true;

    if (!this.defaultSystemPrompt || options.forceRefresh === true) {
      this.isLoadingDefaultSystemPrompt = true;

      try {
        this.defaultSystemPrompt = await fetchDefaultSystemPrompt({
          forceRefresh: options.forceRefresh
        });
      } finally {
        this.isLoadingDefaultSystemPrompt = false;
      }
    }

    if (shouldReplaceSystemPrompt || !this.systemPrompt.trim()) {
      this.systemPrompt = this.defaultSystemPrompt;
      this.systemPromptDraft = this.defaultSystemPrompt;
    }

    if (!preserveStatus) {
      this.status = "Ready.";
    }

    return this.defaultSystemPrompt;
  },

  syncCurrentChatRuntime() {
    this.runtime.currentChat.messages = this.history.map((message) => createRuntimeMessageSnapshot(message));
  },

  persistHistory() {
    this.syncCurrentChatRuntime();

    saveChatHistory(
      this.history.map((message) => ({
        attachments: Array.isArray(message.attachments)
          ? message.attachments.map((attachment) => serializeAttachmentMetadata(attachment))
          : [],
        id: message.id,
        kind: message.kind || "",
        role: message.role,
        content: message.content
      }))
    );
  },

  render(options = {}) {
    renderMessages(this.refs.thread, this.history, {
      isConversationBusy: this.isSending,
      outputOverrides: this.executionOutputOverrides,
      preserveScroll: options.preserveScroll === true,
      rerunningMessageId: this.rerunningMessageId
    });
    this.scheduleLayoutUpdate();
  },

  scheduleLayoutUpdate() {
    if (this.layoutFrameId) {
      window.cancelAnimationFrame(this.layoutFrameId);
    }

    this.layoutFrameId = window.requestAnimationFrame(() => {
      this.layoutFrameId = 0;
      this.updateLayoutMetrics();
    });
  },

  updateLayoutMetrics() {
    const composerWrap = this.refs.composerWrap;

    if (!composerWrap) {
      return;
    }

    const scroller = document.scrollingElement || document.documentElement;
    const composerHeight = Math.ceil(composerWrap.getBoundingClientRect().height);
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const documentHeight = Math.max(scroller.scrollHeight, document.body.scrollHeight, document.documentElement.scrollHeight);
    const isOverflowing = documentHeight - viewportHeight > 8;
    const footerClearance = isOverflowing ? Math.max(Math.round(composerHeight * 0.72), 120) : 12;
    const blurHeight = Math.max(composerHeight + 120, Math.round(viewportHeight * 0.34), 260);

    document.body.style.setProperty("--chat-footer-clearance", `${footerClearance}px`);
    document.body.style.setProperty("--chat-footer-blur-height", `${blurHeight}px`);
  },

  focusInput() {
    if (this.focusFrameId) {
      window.cancelAnimationFrame(this.focusFrameId);
    }

    this.focusFrameId = window.requestAnimationFrame(() => {
      this.focusFrameId = 0;

      const input = this.refs.input;

      if (!input || input.disabled) {
        return;
      }

      try {
        input.focus({
          preventScroll: true
        });
      } catch (error) {
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
    saveChatDraft(this.draft);

    if (this.refs.input) {
      autoResizeTextarea(this.refs.input);
    }
  },

  handleDraftInput(event) {
    this.syncDraft(event.target.value);
  },

  openAttachmentPicker() {
    if (this.isSending || this.isLoadingDefaultSystemPrompt) {
      return;
    }

    this.refs.attachmentInput?.click();
  },

  handleAttachmentInput(event) {
    const nextAttachments = createDraftAttachments(event?.target?.files);

    if (!nextAttachments.length) {
      if (event?.target) {
        event.target.value = "";
      }
      return;
    }

    const existingKeys = new Set(
      this.draftAttachments.map((attachment) => `${attachment.name}::${attachment.size}::${attachment.lastModified}::${attachment.type}`)
    );
    const uniqueAttachments = nextAttachments.filter((attachment) => {
      const key = `${attachment.name}::${attachment.size}::${attachment.lastModified}::${attachment.type}`;

      if (existingKeys.has(key)) {
        return false;
      }

      existingKeys.add(key);
      return true;
    });

    if (uniqueAttachments.length) {
      this.draftAttachments = [...this.draftAttachments, ...uniqueAttachments];
      this.render({
        preserveScroll: true
      });
      this.status = `${this.draftAttachments.length} attachment${this.draftAttachments.length === 1 ? "" : "s"} ready.`;
    }

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
      this.submitMessage();
    }
  },

  openSystemDialog() {
    this.systemPromptDraft = this.systemPrompt || this.defaultSystemPrompt;
    openDialog(this.refs.systemDialog);
  },

  closeSystemDialog() {
    closeDialog(this.refs.systemDialog);
  },

  async loadDefaultSystemPromptIntoEditor() {
    this.status = "Loading default system prompt...";

    try {
      const defaultSystemPrompt = await this.ensureDefaultSystemPrompt({
        forceRefresh: true,
        preserveStatus: true,
        replaceCurrent: false
      });
      this.systemPromptDraft = defaultSystemPrompt;
      this.status = "Default system prompt loaded into the editor.";
    } catch (error) {
      this.status = error.message;
    }
  },

  saveSystemPromptFromDialog() {
    const defaultPrompt = typeof this.defaultSystemPrompt === "string" ? this.defaultSystemPrompt.trim() : "";
    const draftPrompt = typeof this.systemPromptDraft === "string" ? this.systemPromptDraft.trim() : "";

    if (!draftPrompt || (defaultPrompt && draftPrompt === defaultPrompt)) {
      this.systemPrompt = this.defaultSystemPrompt;
      this.systemPromptDraft = this.defaultSystemPrompt;
      clearSystemPrompt();
      this.status = "System prompt reset to default.";
      this.closeSystemDialog();
      return;
    }

    this.systemPrompt = this.systemPromptDraft;
    saveSystemPrompt(this.systemPrompt);
    this.status = "Custom system prompt updated.";
    this.closeSystemDialog();
  },

  openSettingsDialog() {
    this.settingsDraft = {
      ...this.settings
    };
    openDialog(this.refs.settingsDialog);
  },

  closeSettingsDialog() {
    closeDialog(this.refs.settingsDialog);
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

  openPromptHistoryDialog() {
    this.promptHistoryTitle = "Full Prompt History";
    this.promptHistoryMessages = buildPromptMessages(this.systemPrompt, this.history);
    this.promptHistoryMode = "text";
    openDialog(this.refs.historyDialog);
  },

  closePromptHistoryDialog() {
    closeDialog(this.refs.historyDialog);
  },

  setPromptHistoryMode(mode) {
    this.promptHistoryMode = mode === "json" ? "json" : "text";
  },

  async copyPromptHistory() {
    const copied = await copyTextToClipboard(this.promptHistoryContent || "");
    this.status = copied ? "Prompt history copied." : "Unable to copy prompt history.";
  },

  saveSettingsFromDialog() {
    const paramsText = typeof this.settingsDraft.paramsText === "string" ? this.settingsDraft.paramsText.trim() : "";

    try {
      parseLlmParamsText(paramsText);
    } catch (error) {
      this.status = error.message;
      return;
    }

    this.settings = {
      apiEndpoint: (this.settingsDraft.apiEndpoint || "").trim(),
      apiKey: (this.settingsDraft.apiKey || "").trim(),
      model: (this.settingsDraft.model || "").trim(),
      paramsText
    };

    saveChatSettings(this.settings);
    this.status = "LLM settings updated.";
    this.closeSettingsDialog();
  },

  async handleClearClick() {
    this.closeRawDialog();
    this.rawOutputContent = "";
    this.draftAttachments = [];
    this.history = [];
    this.executionOutputOverrides = Object.create(null);
    this.runtime.currentChat.attachments.clear();

    if (this.refs.attachmentInput) {
      this.refs.attachmentInput.value = "";
    }

    this.persistHistory();
    clearChatHistory();
    this.executionContext.reset();
    this.render();
    this.status = "Chat cleared and execution context reset.";
  },

  async streamAssistantResponse(requestMessages, assistantMessage) {
    this.status = "Streaming response...";

    await streamChatCompletion({
      settings: this.settings,
      systemPrompt: this.systemPrompt,
      messages: requestMessages,
      onDelta: (delta) => {
        assistantMessage.content += delta;
        this.persistHistory();
        this.render();
      }
    });

    assistantMessage.streaming = false;
    this.persistHistory();
    this.render();
    return Boolean(assistantMessage.content.trim());
  },

  async executeAssistantBlocks(assistantContent) {
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

    return executionResults;
  },

  async runConversationLoop(initialUserMessage) {
    this.runtime.currentChat.attachments.rememberMessageAttachments(
      initialUserMessage.id,
      initialUserMessage.attachments
    );
    this.runtime.currentChat.attachments.setActiveMessage(initialUserMessage.id);

    let nextUserMessage = initialUserMessage;
    let emptyAssistantRetryCount = 0;
    let missingExecutionResultRetryCount = 0;

    while (nextUserMessage) {
      const requestMessages =
        this.history[this.history.length - 1]?.id === nextUserMessage.id
          ? [...this.history]
          : [...this.history, nextUserMessage];
      const assistantMessage = createStreamingAssistantMessage();

      this.history = [...requestMessages, assistantMessage];
      this.persistHistory();
      this.render();

      try {
        const hasAssistantContent = await this.streamAssistantResponse(requestMessages, assistantMessage);

        if (!hasAssistantContent) {
          if (isExecutionFollowUpKind(nextUserMessage.kind) && emptyAssistantRetryCount < MAX_PROTOCOL_RETRY_COUNT) {
            emptyAssistantRetryCount += 1;
            this.history = requestMessages;
            this.persistHistory();
            this.render();
            nextUserMessage = createMessage("user", buildEmptyAssistantRetryMessage(nextUserMessage.content), {
              kind: "execution-retry"
            });
            this.status = "Retrying: assistant reply was empty after execution...";
            continue;
          }

          assistantMessage.content = "[No content returned]";
          this.persistHistory();
          this.render();
          return;
        }
      } catch (error) {
        assistantMessage.streaming = false;

        if (!assistantMessage.content.trim()) {
          this.history = requestMessages;
        }

        this.persistHistory();
        this.render();
        throw error;
      }

      emptyAssistantRetryCount = 0;
      const executionResults = await this.executeAssistantBlocks(assistantMessage.content);

      if (!executionResults || !executionResults.length) {
        return;
      }

      const executionOutputMessage = createMessage("user", formatExecutionResultsMessage(executionResults), {
        kind: "execution-output"
      });
      this.history = [...this.history, executionOutputMessage];
      this.persistHistory();
      this.render();

      if (
        executionResultsNeedReturnedValue(executionResults) &&
        missingExecutionResultRetryCount < MAX_PROTOCOL_RETRY_COUNT
      ) {
        missingExecutionResultRetryCount += 1;
        nextUserMessage = createMessage("user", buildMissingExecutionResultRetryMessage(executionOutputMessage.content), {
          kind: "execution-retry"
        });
        this.status = "Retrying: browser code returned no result...";
        continue;
      }

      missingExecutionResultRetryCount = 0;
      nextUserMessage = executionOutputMessage;
      this.status = "Sending code execution output...";
    }
  },

  async submitMessage() {
    if (this.isSending) {
      return;
    }

    if (this.isLoadingDefaultSystemPrompt) {
      this.status = "Loading default system prompt...";
      return;
    }

    const messageText = this.draft.trim();
    const selectedAttachments = this.draftAttachments.slice();

    if (!messageText && !selectedAttachments.length) {
      return;
    }

    this.isSending = true;
    const userMessage = createMessage("user", messageText, {
      attachments: selectedAttachments
    });

    this.draft = "";
    this.draftAttachments = [];
    clearChatDraft();

    if (this.refs.input) {
      this.refs.input.value = "";
      autoResizeTextarea(this.refs.input);
    }

    if (this.refs.attachmentInput) {
      this.refs.attachmentInput.value = "";
    }

    try {
      await this.runConversationLoop(userMessage);
      this.status = "Ready.";
    } catch (error) {
      this.status = error.message;
    } finally {
      this.isSending = false;
      this.render();
      this.focusInput();
    }
  },

  async handleThreadClick(event) {
    const messageActionButton = event.target.closest("[data-message-action]");

    if (messageActionButton && this.refs.thread && this.refs.thread.contains(messageActionButton)) {
      const action = messageActionButton.dataset.messageAction;
      const messageId = messageActionButton.dataset.messageId;

      if (action === "show-raw" && messageId) {
        this.openRawDialogForMessage(messageId);
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

    const section = findExecuteSection(this.history, messageId, this.executionOutputOverrides);

    if (!section) {
      this.status = "That execution step is no longer available.";
      return;
    }

    if (action === "copy-input") {
      const copied = await copyTextToClipboard(getTerminalInputText(section.executeDisplay));
      this.status = copied ? "Input copied." : "Unable to copy input.";
      return;
    }

    if (action === "copy-output") {
      if (!Array.isArray(section.outputResults) || !section.outputResults.length) {
        this.status = "No execution output to copy yet.";
        return;
      }

      const outputText = getTerminalOutputText(section.outputResults);
      const copied = outputText ? await copyTextToClipboard(outputText) : false;
      this.status = copied ? "Output copied." : "Unable to copy output.";
      return;
    }

    if (action !== "rerun" || this.isSending) {
      return;
    }

    this.isSending = true;
    this.rerunningMessageId = messageId;
    const inputMessage = findConversationInputMessage(this.history, messageId);
    this.runtime.currentChat.attachments.setActiveMessage(inputMessage?.id || "");
    this.render({
      preserveScroll: true
    });

    try {
      const executionResults = await this.executeAssistantBlocks(section.message.content);

      if (!executionResults || !executionResults.length) {
        this.status = "No execution code found to rerun.";
        return;
      }

      this.executionOutputOverrides[messageId] = createExecutionOutputSnapshots(executionResults);
      this.render({
        preserveScroll: true
      });
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

const store = createStore("chatStore", model);

export { store };
