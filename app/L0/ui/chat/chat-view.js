import { extractExecuteBlocks } from "./execution-context.js";
import { formatAttachmentSize } from "./attachments.js";
import { marked } from "./marked.esm.js";

const EXECUTION_STATUS_LINE_PATTERN = /^execution\s+(.+)$/i;
const EXECUTION_PRINT_LINE_PATTERN = /^(log|info|warn|error|debug|dir|table|assert):\s*/i;
const STICKY_SCROLL_THRESHOLD = 32;
const markdownRenderer = new marked.Renderer();

markdownRenderer.code = ({ lang, text }) => {
  const safeCode = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const languageClass = lang ? ` class="language-${lang}"` : "";
  return `<pre><code${languageClass}>${safeCode}</code></pre>`;
};

export function summarizeSystemPrompt(systemPrompt) {
  if (!systemPrompt.trim()) {
    return "No system prompt";
  }

  const preview = systemPrompt.trim().replace(/\s+/g, " ");
  return preview.length > 72 ? `${preview.slice(0, 72)}...` : preview;
}

export function summarizeEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.host;
  } catch (error) {
    return endpoint || "Not set";
  }
}

export function summarizeLlmConfig(apiEndpoint, model) {
  const provider = summarizeEndpoint(apiEndpoint);
  const normalizedModel = typeof model === "string" ? model.trim() : "";

  if (provider && normalizedModel) {
    return `${provider}/${normalizedModel}`;
  }

  return normalizedModel || provider || "Not set";
}

export function autoResizeTextarea(textarea) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

function stripExecuteBlocks(content) {
  if (typeof content !== "string" || !content.trim()) {
    return "";
  }

  let stripped = content;
  extractExecuteBlocks(content).forEach((block) => {
    stripped = stripped.replace(block.raw, "");
  });

  return stripped.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeExecuteNarration(content) {
  return stripExecuteBlocks(content);
}

function parseExecuteDisplayContent(content) {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  const executeBlocks = extractExecuteBlocks(content);

  if (executeBlocks.length) {
    let narration = content;

    executeBlocks.forEach((block) => {
      narration = narration.replace(block.raw, "");
    });

    return {
      blocks: executeBlocks.map((block) => block.code.trimEnd()),
      narration: normalizeExecuteNarration(narration)
    };
  }

  return null;
}

function parseExecutionOutputMessage(content) {
  if (typeof content !== "string") {
    return null;
  }

  const trimmed = content.trim();
  const lines = trimmed.split(/\r?\n/).map((line) => line.trimEnd());
  const results = [];
  let currentResult = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const statusMatch = line.match(EXECUTION_STATUS_LINE_PATTERN);

    if (statusMatch) {
      currentResult = {
        outputLines: [`execution ${statusMatch[1].trim()}`],
        status: statusMatch[1].trim()
      };
      results.push(currentResult);
      continue;
    }

    if (!currentResult) {
      return null;
    }

    currentResult.outputLines.push(line);
  }

  return results.length ? results : null;
}

function getExecutionOutputResults(message) {
  if (!message || message.role !== "user" || message.kind !== "execution-output") {
    return null;
  }

  return parseExecutionOutputMessage(message.content);
}

function getExecutionOutputLineModifier(line) {
  const trimmed = typeof line === "string" ? line.trim() : "";

  if (!trimmed) {
    return "is-muted";
  }

  if (/^execution\s+/i.test(trimmed)) {
    return "is-meta";
  }

  if (/^result:\s*/i.test(trimmed)) {
    return "is-result";
  }

  if (/^warn:\s*/i.test(trimmed)) {
    return "is-warn";
  }

  if (/^error:\s*/i.test(trimmed)) {
    return "is-error";
  }

  if (EXECUTION_PRINT_LINE_PATTERN.test(trimmed)) {
    return "is-print";
  }

  return "";
}

function appendTerminalLine(container, text, modifier) {
  const line = document.createElement("div");
  line.className = modifier ? `terminal-line ${modifier}` : "terminal-line";
  line.textContent = text;
  container.append(line);
}

function countCodeLines(text) {
  if (typeof text !== "string" || !text.length) {
    return 0;
  }

  return text.split("\n").length;
}

function getExecuteDisplayLineCount(executeDisplay) {
  if (!executeDisplay || !Array.isArray(executeDisplay.blocks) || !executeDisplay.blocks.length) {
    return 0;
  }

  return executeDisplay.blocks.reduce((total, block) => total + countCodeLines(block), 0);
}

function formatLineCount(lineCount) {
  return `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
}

function createTerminalOutputEntries(results, options = {}) {
  const pendingState = options.pendingState || "";

  if (!Array.isArray(results) || !results.length) {
    return [
      {
        modifier: "is-muted",
        text:
          pendingState === "generating"
            ? "Generating code..."
            : pendingState === "running"
              ? "Running..."
              : "No output yet."
      }
    ];
  }

  const entries = [];

  results.forEach((result, index) => {
    if (index > 0) {
      entries.push({
        type: "divider"
      });
    }

    const lines = Array.isArray(result?.outputLines) ? result.outputLines : [];

    lines.forEach((line) => {
      entries.push({
        modifier: getExecutionOutputLineModifier(line),
        text: line
      });
    });
  });

  return entries;
}

function appendTerminalOutput(container, results, pendingState = "") {
  createTerminalOutputEntries(results, {
    pendingState
  }).forEach((entry) => {
    if (entry.type === "divider") {
      const divider = document.createElement("div");
      divider.className = "terminal-divider";
      divider.setAttribute("aria-hidden", "true");
      container.append(divider);
      return;
    }

    appendTerminalLine(container, entry.text, entry.modifier);
  });
}

export function getTerminalInputText(executeDisplay) {
  if (!executeDisplay || !Array.isArray(executeDisplay.blocks)) {
    return "";
  }

  return executeDisplay.blocks.join("\n\n").trim();
}

export function getTerminalOutputText(results) {
  return createTerminalOutputEntries(results)
    .map((entry) => (entry.type === "divider" ? "" : entry.text))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createMessageContentBlock(text, className = "message-content") {
  const content = document.createElement("p");
  content.className = className;
  content.textContent = text;
  return content;
}

function createAttachmentList(attachments, options = {}) {
  if (!Array.isArray(attachments) || !attachments.length) {
    return null;
  }

  const list = document.createElement("div");
  list.className = options.className || "message-attachments";

  attachments.forEach((attachment) => {
    const item = document.createElement("div");
    item.className = "message-attachment";

    if (attachment.available === false) {
      item.classList.add("is-unavailable");
    }

    const name = document.createElement("span");
    name.className = "message-attachment-name";
    name.textContent = attachment.name || "Attachment";

    const meta = document.createElement("span");
    meta.className = "message-attachment-meta";
    meta.textContent = [
      attachment.type || "file",
      formatAttachmentSize(attachment.size),
      attachment.available === false ? "unavailable after reload" : "live"
    ]
      .filter(Boolean)
      .join(" • ");

    item.append(name, meta);
    list.append(item);
  });

  return list;
}

function createAssistantMarkdownBlock(text, className = "message-content message-markdown") {
  const normalizedText = stripExecuteBlocks(text);

  if (!normalizedText) {
    return null;
  }

  const content = document.createElement("div");
  content.className = className;
  content.innerHTML = marked.parse(normalizedText, {
    breaks: true,
    gfm: true,
    renderer: markdownRenderer
  });
  return content;
}

function createTerminalActionButton({ action, active = false, disabled = false, iconName, messageId, title }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-action";
  button.dataset.terminalAction = action;
  button.dataset.terminalMessageId = messageId;
  button.title = title;
  button.setAttribute("aria-label", title);

  if (active) {
    button.classList.add("is-active");
  }

  if (disabled) {
    button.disabled = true;
  }

  const icon = document.createElement("x-icon");
  icon.textContent = iconName;
  button.append(icon);
  return button;
}

function createAssistantMessageActionRow(message) {
  const actions = document.createElement("div");
  actions.className = "assistant-message-actions";

  const rawButton = document.createElement("button");
  rawButton.type = "button";
  rawButton.className = "assistant-message-action";
  rawButton.dataset.messageAction = "show-raw";
  rawButton.dataset.messageId = message.id;
  rawButton.textContent = "Raw";

  if (!message.content) {
    rawButton.disabled = true;
  }

  actions.append(rawButton);
  return actions;
}

function createTerminalCard({ executeDisplay, isConversationBusy, isStreaming, messageId, outputResults, rerunningMessageId }) {
  const lineCount = getExecuteDisplayLineCount(executeDisplay);
  const displayOutputResults = rerunningMessageId === messageId ? null : outputResults;
  const pendingState = isStreaming
    ? "generating"
    : rerunningMessageId === messageId || (!displayOutputResults && isConversationBusy)
      ? "running"
      : "";
  const terminal = document.createElement("section");
  terminal.className = "terminal-card";

  const terminalBar = document.createElement("div");
  terminalBar.className = "terminal-bar";

  const terminalTitle = document.createElement("span");
  terminalTitle.className = "terminal-title";
  terminalTitle.textContent = "browser-exec";

  const terminalActions = document.createElement("div");
  terminalActions.className = "terminal-actions";
  terminalActions.append(
    createTerminalActionButton({
      action: "copy-input",
      disabled: !getTerminalInputText(executeDisplay),
      iconName: "code",
      messageId,
      title: "Copy input"
    }),
    createTerminalActionButton({
      action: "copy-output",
      disabled: !Array.isArray(displayOutputResults) || !displayOutputResults.length,
      iconName: "content_copy",
      messageId,
      title: "Copy output"
    }),
    createTerminalActionButton({
      action: "rerun",
      active: rerunningMessageId === messageId,
      disabled: isConversationBusy || isStreaming || !getTerminalInputText(executeDisplay),
      iconName: "replay",
      messageId,
      title: "Run again"
    })
  );

  terminalBar.append(terminalTitle, terminalActions);

  const inputPane = document.createElement("div");
  inputPane.className = "terminal-pane terminal-pane-input";

  const inputLabel = document.createElement("span");
  inputLabel.className = "terminal-pane-label";
  inputLabel.textContent = lineCount ? `Input • ${formatLineCount(lineCount)}` : "Input";

  const inputBody = document.createElement("div");
  inputBody.className = "terminal-pane-scroll";
  inputBody.dataset.scrollKey = `${messageId}:input`;

  executeDisplay.blocks.forEach((block) => {
    const inputBlock = document.createElement("pre");
    inputBlock.className = "terminal-code";
    inputBlock.textContent = block || (isStreaming ? "" : "[empty]");
    inputBody.append(inputBlock);
  });

  inputPane.append(inputLabel, inputBody);

  const outputPane = document.createElement("div");
  outputPane.className = "terminal-pane terminal-pane-output";

  const outputLabel = document.createElement("span");
  outputLabel.className = "terminal-pane-label";
  outputLabel.textContent = "Output";

  const outputBody = document.createElement("div");
  outputBody.className = "terminal-pane-scroll";
  outputBody.dataset.scrollKey = `${messageId}:output`;
  appendTerminalOutput(outputBody, displayOutputResults || [], pendingState);

  outputPane.append(outputLabel, outputBody);
  terminal.append(inputPane, outputPane);
  terminal.prepend(terminalBar);
  return terminal;
}

function createStandardMessageBubble(message) {
  const bubble = document.createElement("article");
  bubble.className = "message-bubble";

  if (message.streaming) {
    bubble.classList.add("is-streaming");
  }

  if (message.role === "assistant") {
    bubble.classList.add("assistant-message-shell");
    const markdownBlock = createAssistantMarkdownBlock(message.content || (message.streaming ? "Streaming..." : ""));
    if (markdownBlock) {
      bubble.append(markdownBlock);
    }

    bubble.append(createAssistantMessageActionRow(message));
  } else {
    const hasTextContent = Boolean(message.content || message.streaming);
    const attachmentList = createAttachmentList(message.attachments, {
      className: "message-attachments"
    });

    if (hasTextContent) {
      bubble.append(createMessageContentBlock(message.content || (message.streaming ? "Streaming..." : "")));
    }

    if (attachmentList) {
      bubble.append(attachmentList);
    }

    if (!hasTextContent && !attachmentList) {
      bubble.append(createMessageContentBlock(message.streaming ? "Streaming..." : ""));
    }
  }

  return bubble;
}

function createAssistantSequenceBubble(group, options = {}) {
  const bubble = document.createElement("article");
  bubble.className = "message-bubble";

  if (group.sections.some((section) => Boolean(section.message.streaming))) {
    bubble.classList.add("is-streaming");
  }

  group.sections.forEach((section) => {
    const sectionElement = document.createElement("div");
    sectionElement.className = "assistant-sequence-section assistant-message-shell";

    if (section.type === "execute") {
      if (section.executeDisplay.narration) {
        const narrationBlock = createAssistantMarkdownBlock(
          section.executeDisplay.narration,
          "message-content message-markdown terminal-note"
        );

        if (narrationBlock) {
          sectionElement.append(narrationBlock);
        }
      }

      sectionElement.append(
        createTerminalCard({
          executeDisplay: section.executeDisplay,
          isConversationBusy: options.isConversationBusy,
          isStreaming: Boolean(section.message.streaming),
          messageId: section.message.id,
          outputResults: section.outputResults,
          rerunningMessageId: options.rerunningMessageId
        })
      );
    } else {
      sectionElement.classList.add("is-followup");
      const followupBlock = createAssistantMarkdownBlock(
        section.message.content || (section.message.streaming ? "Streaming..." : ""),
        "message-content message-markdown terminal-followup"
      );

      if (followupBlock) {
        sectionElement.append(followupBlock);
      }
    }

    sectionElement.append(createAssistantMessageActionRow(section.message));
    bubble.append(sectionElement);
  });

  return bubble;
}

function createStandaloneExecutionOutputBubble(outputResults, messageId = "") {
  const bubble = document.createElement("article");
  bubble.className = "message-bubble is-terminal-output";

  const terminal = document.createElement("section");
  terminal.className = "terminal-card is-output-only";

  const outputPane = document.createElement("div");
  outputPane.className = "terminal-pane terminal-pane-output";

  const outputLabel = document.createElement("span");
  outputLabel.className = "terminal-pane-label";
  outputLabel.textContent = "Output";
  const outputBody = document.createElement("div");
  outputBody.className = "terminal-pane-scroll";
  if (messageId) {
    outputBody.dataset.scrollKey = `${messageId}:output`;
  }
  appendTerminalOutput(outputBody, outputResults);
  outputPane.append(outputLabel, outputBody);

  terminal.append(outputPane);
  bubble.append(terminal);
  return bubble;
}

function getDocumentScroller() {
  return document.scrollingElement || document.documentElement;
}

function getMaxScrollTop(element) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function getMaxScrollLeft(element) {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

function isNearBottom(element) {
  return getMaxScrollTop(element) - element.scrollTop <= STICKY_SCROLL_THRESHOLD;
}

function createScrollSnapshot(element, options = {}) {
  if (!element) {
    return null;
  }

  return {
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    stickyBottom: options.forcePreserve === true ? false : isNearBottom(element)
  };
}

function restoreScrollSnapshot(element, snapshot, options = {}) {
  if (!element || !snapshot) {
    return;
  }

  element.scrollLeft = Math.min(snapshot.scrollLeft, getMaxScrollLeft(element));

  if (options.forcePreserve === true || !snapshot.stickyBottom) {
    element.scrollTop = Math.min(snapshot.scrollTop, getMaxScrollTop(element));
    return;
  }

  element.scrollTop = getMaxScrollTop(element);
}

function captureThreadScrollSnapshots(thread, options = {}) {
  const snapshots = {
    document: createScrollSnapshot(getDocumentScroller(), {
      forcePreserve: options.preserveScroll === true
    }),
    nodes: new Map()
  };

  thread.querySelectorAll("[data-scroll-key]").forEach((element) => {
    snapshots.nodes.set(element.dataset.scrollKey, createScrollSnapshot(element));
  });

  return snapshots;
}

function restoreThreadScrollSnapshots(thread, snapshots, options = {}) {
  restoreScrollSnapshot(getDocumentScroller(), snapshots?.document, {
    forcePreserve: options.preserveScroll === true
  });

  thread.querySelectorAll("[data-scroll-key]").forEach((element) => {
    restoreScrollSnapshot(element, snapshots?.nodes.get(element.dataset.scrollKey));
  });
}

function buildMessageDisplayGroups(history, options = {}) {
  const groups = [];
  const outputOverrides = options.outputOverrides || {};

  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    const executeDisplay = message.role === "assistant" ? parseExecuteDisplayContent(message.content) : null;
    const standaloneOutputResults = getExecutionOutputResults(message);

    if (executeDisplay) {
      const sections = [];
      let cursor = index;

      while (cursor < history.length) {
        const assistantMessage = history[cursor];

        if (assistantMessage.role !== "assistant") {
          break;
        }

        const assistantExecuteDisplay = parseExecuteDisplayContent(assistantMessage.content);

        if (assistantExecuteDisplay) {
          const nextMessage = history[cursor + 1];
          const outputResults = Array.isArray(outputOverrides[assistantMessage.id])
            ? outputOverrides[assistantMessage.id]
            : nextMessage
              ? getExecutionOutputResults(nextMessage)
              : null;

          sections.push({
            executeDisplay: assistantExecuteDisplay,
            message: assistantMessage,
            outputResults,
            type: "execute"
          });

          cursor += outputResults ? 2 : 1;
          continue;
        }

        sections.push({
          message: assistantMessage,
          type: "text"
        });
        cursor += 1;
        break;
      }

      groups.push({
        sections,
        type: "assistant-sequence"
      });

      index = cursor - 1;
      continue;
    }

    if (standaloneOutputResults) {
      groups.push({
        messageId: message.id,
        outputResults: standaloneOutputResults,
        type: "standalone-output"
      });
      continue;
    }

    groups.push({
      message,
      type: "standard"
    });
  }

  return groups;
}

export function renderMessages(thread, history, options = {}) {
  if (!thread) {
    return;
  }

  const scrollSnapshots = captureThreadScrollSnapshots(thread, options);

  thread.innerHTML = "";
  thread.classList.remove("is-empty");

  if (!history.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "chat-empty";
    emptyState.textContent =
      "This is Agent One, a client-side personal agent. It runs and executes code directly in your browser. Your data and settings are stored in the browser's localStorage for convenience.";
    thread.classList.add("is-empty");
    thread.append(emptyState);
    window.requestAnimationFrame(() => {
      restoreThreadScrollSnapshots(thread, scrollSnapshots, options);
    });
    return;
  }

  buildMessageDisplayGroups(history, options).forEach((group) => {
    const row = document.createElement("div");

    if (group.type === "assistant-sequence") {
      row.className = "message-row assistant terminal-row";
      row.append(createAssistantSequenceBubble(group, options));
    } else if (group.type === "standalone-output") {
      row.className = "message-row assistant terminal-row execution-output-row";
      row.append(createStandaloneExecutionOutputBubble(group.outputResults, group.messageId));
    } else {
      row.className = `message-row ${group.message.role}`;
      row.append(createStandardMessageBubble(group.message));
    }

    thread.append(row);
  });

  window.requestAnimationFrame(() => {
    restoreThreadScrollSnapshots(thread, scrollSnapshots, options);
  });
}

export async function copyTextToClipboard(text) {
  if (typeof text !== "string" || !text.length) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Fall back to a temporary textarea below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  const copied = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
  textarea.remove();
  return copied;
}

export function findExecuteSection(history, messageId, outputOverrides = {}) {
  const messageIndex = history.findIndex((message) => message.id === messageId && message.role === "assistant");

  if (messageIndex === -1) {
    return null;
  }

  const message = history[messageIndex];
  const executeDisplay = parseExecuteDisplayContent(message.content);

  if (!executeDisplay) {
    return null;
  }

  const nextMessage = history[messageIndex + 1];
  const outputResults = Array.isArray(outputOverrides[messageId])
    ? outputOverrides[messageId]
    : nextMessage
      ? getExecutionOutputResults(nextMessage)
      : null;

  return {
    executeDisplay,
    message,
    outputResults
  };
}
