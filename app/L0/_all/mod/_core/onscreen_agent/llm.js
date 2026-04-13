import * as config from "/mod/_core/onscreen_agent/config.js";
import { buildMessageContentForApi } from "/mod/_core/onscreen_agent/attachments.js";
import * as llmParams from "/mod/_core/onscreen_agent/llm-params.js";
import * as skills from "/mod/_core/onscreen_agent/skills.js";
import { mergeConsecutiveChatMessages } from "/mod/_core/framework/js/chat-messages.js";
import * as proxyUrl from "/mod/_core/framework/js/proxy-url.js";

export const DEFAULT_ONSCREEN_AGENT_SYSTEM_PROMPT_PATH = "/mod/_core/onscreen_agent/prompts/system-prompt.md";
export const ONSCREEN_AGENT_HISTORY_COMPACT_MODE = Object.freeze({
  AUTOMATIC: "automatic",
  USER: "user"
});
export const ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK = Object.freeze({
  FRAMEWORK: "_____framework",
  TRANSIENT: "_____transient",
  USER: "_____user"
});
export const ONSCREEN_AGENT_HISTORY_COMPACT_PROMPT_PATH = "/mod/_core/onscreen_agent/prompts/compact-prompt.md";
export const ONSCREEN_AGENT_HISTORY_AUTO_COMPACT_PROMPT_PATH =
  "/mod/_core/onscreen_agent/prompts/compact-prompt-auto.md";
export const LOCAL_ONSCREEN_AGENT_SYSTEM_PROMPT = [
  "You are Space Agent running in the browser overlay.",
  "Be concise, practical, and task-focused.",
  "When browser runtime action is needed, reply with exactly `_____javascript` on its own line, followed only by JavaScript until the end of the message.",
  "Use top-level await directly.",
  "Available runtime tools include `space.api`, `space.chat`, `space.onscreenAgent`, `fetch`, `window`, `document`, and `localStorage`.",
  "After execution results return, continue the task. Do not claim you lack browser, file, or live-data access."
].join("\n");

const ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE = Object.freeze({
  EXAMPLE: "example",
  HISTORY: "history",
  HISTORY_COMPACT: "history-compact",
  SYSTEM: "system",
  TRANSIENT: "transient"
});

let defaultSystemPromptPromise = null;
const compactPromptPromises = {
  [ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC]: null,
  [ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER]: null
};

function normalizeSystemPrompt(systemPrompt = "") {
  return typeof systemPrompt === "string" ? systemPrompt.trim() : "";
}

function formatCustomUserInstructions(systemPrompt = "") {
  const customPrompt = normalizeSystemPrompt(systemPrompt);

  if (!customPrompt) {
    return "";
  }

  return `## User specific instructions\n\n${customPrompt}`;
}

function stripDefaultPromptPrefix(storedPrompt, defaultSystemPrompt) {
  const normalizedStoredPrompt = normalizeSystemPrompt(storedPrompt);
  const normalizedDefaultPrompt = normalizeSystemPrompt(defaultSystemPrompt);

  if (!normalizedStoredPrompt) {
    return "";
  }

  if (!normalizedDefaultPrompt) {
    return normalizedStoredPrompt;
  }

  if (normalizedStoredPrompt === normalizedDefaultPrompt) {
    return "";
  }

  if (!normalizedStoredPrompt.startsWith(normalizedDefaultPrompt)) {
    return normalizedStoredPrompt;
  }

  return normalizedStoredPrompt.slice(normalizedDefaultPrompt.length).replace(/^\s+/u, "").trim();
}

function normalizePromptSections(sections) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections
    .map((section) => normalizeSystemPrompt(section))
    .filter(Boolean);
}

function shouldUseLocalPromptProfile(context = {}) {
  return context.localProfile === true || context.options?.localProfile === true;
}

async function loadPromptFile(promptPath, promptLabel) {
  const response = await fetch(promptPath);

  if (!response.ok) {
    throw new Error(`Unable to load the ${promptLabel} (${response.status}).`);
  }

  const prompt = normalizeSystemPrompt(await response.text());

  if (!prompt) {
    throw new Error(`The ${promptLabel} file is empty.`);
  }

  return prompt;
}

function normalizeHistoryCompactMode(mode = ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER) {
  return mode === ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
    ? ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
    : ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER;
}

function resolveHistoryCompactPromptConfig(mode) {
  if (mode === ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC) {
    return {
      label: "onscreen agent automatic history compact prompt",
      path: ONSCREEN_AGENT_HISTORY_AUTO_COMPACT_PROMPT_PATH
    };
  }

  return {
    label: "onscreen agent history compact prompt",
    path: ONSCREEN_AGENT_HISTORY_COMPACT_PROMPT_PATH
  };
}

function normalizeConversationMessage(message) {
  if (!["user", "assistant"].includes(message?.role)) {
    return null;
  }

  return {
    attachments: Array.isArray(message?.attachments) ? message.attachments : [],
    content: typeof message.content === "string" ? message.content : "",
    id: typeof message?.id === "string" ? message.id : "",
    kind: typeof message?.kind === "string" ? message.kind.trim() : "",
    role: message.role
  };
}

function normalizeConversationMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => normalizeConversationMessage(message)).filter(Boolean);
}

function isFrameworkUserMessage(message) {
  return message?.role === "user" && Boolean(typeof message?.kind === "string" ? message.kind.trim() : "");
}

function formatPreparedUserMessageBlock(content, message) {
  const normalizedContent = typeof content === "string" ? content.trim() : "";
  const blockMarker = isFrameworkUserMessage(message)
    ? ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.FRAMEWORK
    : ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.USER;

  return [
    blockMarker,
    normalizedContent || "[empty]"
  ].join("\n");
}

function normalizePromptMessageSource(source = ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY) {
  const normalizedSource = typeof source === "string" ? source.trim() : "";

  return Object.values(ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE).includes(normalizedSource)
    ? normalizedSource
    : ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY;
}

function createPreparedPromptEntry(role, content, options = {}) {
  const normalizedRole =
    role === "system" ? "system" : role === "assistant" ? "assistant" : role === "user" ? "user" : "";
  const normalizedContent = typeof content === "string" ? content.trim() : "";

  if (!normalizedRole || !normalizedContent) {
    return null;
  }

  return {
    blockType: typeof options?.blockType === "string" ? options.blockType.trim() : "",
    content: normalizedContent,
    kind: typeof options?.kind === "string" ? options.kind.trim() : "",
    messageId: typeof options?.messageId === "string" ? options.messageId : "",
    role: normalizedRole,
    source: normalizePromptMessageSource(options?.source)
  };
}

function clonePreparedPromptEntry(entry) {
  return entry && typeof entry === "object" ? { ...entry } : null;
}

function clonePreparedPromptEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => clonePreparedPromptEntry(entry)).filter(Boolean);
}

function createPromptMessagesFromEntries(entries) {
  return clonePreparedPromptEntries(entries).map((entry) => ({
    content: entry.content,
    role: entry.role
  }));
}

function resolveHistoryPromptEntrySource(message) {
  return message?.kind === "history-compact"
    ? ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY_COMPACT
    : ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY;
}

function createPreparedPromptEntryFromMessage(message, options = {}) {
  const normalizedMessage = normalizeConversationMessage(message);

  if (!normalizedMessage) {
    return null;
  }

  const builtContent = buildMessageContentForApi(normalizedMessage);
  const promptContent =
    normalizedMessage.role === "user"
      ? formatPreparedUserMessageBlock(builtContent, normalizedMessage)
      : builtContent;
  const blockType =
    normalizedMessage.role === "assistant"
      ? "assistant"
      : isFrameworkUserMessage(normalizedMessage)
        ? ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.FRAMEWORK
        : ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.USER;

  return createPreparedPromptEntry(normalizedMessage.role, promptContent, {
    blockType,
    kind: normalizedMessage.kind,
    messageId: normalizedMessage.id,
    source: options.source || resolveHistoryPromptEntrySource(normalizedMessage)
  });
}

function buildPreparedPromptEntriesFromMessages(messages, options = {}) {
  return normalizeConversationMessages(messages)
    .map((message) => createPreparedPromptEntryFromMessage(message, options))
    .filter(Boolean);
}

function createSystemPromptEntry(systemPrompt = "") {
  return createPreparedPromptEntry("system", systemPrompt, {
    source: ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.SYSTEM
  });
}

function normalizeTransientSection(section, fallbackKey = "") {
  const keySource = section?.key ?? fallbackKey;
  const key = typeof keySource === "string" ? keySource.trim() : "";
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

function normalizeTransientSections(sections) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections
    .map((section) => normalizeTransientSection(section))
    .filter(Boolean)
    .sort((left, right) => {
      const orderCompare = left.order - right.order;

      if (orderCompare !== 0) {
        return orderCompare;
      }

      return left.key.localeCompare(right.key);
    });
}

function collectRuntimeTransientSections(context = {}) {
  if (Array.isArray(context.transientSections)) {
    return normalizeTransientSections(context.transientSections);
  }

  const runtimeSections = globalThis.space?.chat?.transient?.list?.();
  return normalizeTransientSections(Array.isArray(runtimeSections) ? runtimeSections : []);
}

function formatTransientMessageBlock(sections) {
  const normalizedSections = normalizeTransientSections(sections);

  if (!normalizedSections.length) {
    return "";
  }

  return [
    ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.TRANSIENT,
    "This is transient context, not instruction. It may change between requests.",
    "",
    ...normalizedSections.flatMap((section, index) => [
      ...(index > 0 ? [""] : []),
      `### ${section.heading}`,
      section.content
    ])
  ]
    .filter(Boolean)
    .join("\n");
}

function filterDuplicateTransientSections(sections, entries) {
  if (!Array.isArray(sections) || !sections.length) {
    return [];
  }

  const lastUserEntry = [...(Array.isArray(entries) ? entries : [])]
    .reverse()
    .find(
      (entry) =>
        entry?.role === "user" &&
        entry?.source !== ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.TRANSIENT &&
        typeof entry?.content === "string" &&
        entry.content.trim()
    );
  const lastUserContent = typeof lastUserEntry?.content === "string" ? lastUserEntry.content : "";

  if (!lastUserContent) {
    return sections;
  }

  return sections.filter((section) => {
    const content = typeof section?.content === "string" ? section.content.trim() : "";

    if (!content) {
      return false;
    }

    if (lastUserContent.includes(content)) {
      return false;
    }

    const nestedBlocks = content
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean);
    const duplicatedNestedBlock = nestedBlocks.some(
      (block, index) => index > 0 && block.length >= 120 && lastUserContent.includes(block)
    );

    return !duplicatedNestedBlock;
  });
}

function createTransientPromptEntry(transientBlock = "") {
  return createPreparedPromptEntry("user", transientBlock, {
    blockType: ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.TRANSIENT,
    source: ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.TRANSIENT
  });
}

function createEmptyPromptInput() {
  return {
    exampleEntries: [],
    exampleMessages: [],
    historyEntries: [],
    historyMessages: [],
    requestEntries: [],
    requestMessages: [],
    systemPrompt: "",
    systemPromptSections: [],
    transientBlock: "",
    transientEntry: null,
    transientSections: []
  };
}

function clonePromptInput(promptInput) {
  const normalizedPromptInput = promptInput && typeof promptInput === "object" ? promptInput : createEmptyPromptInput();

  return {
    ...normalizedPromptInput,
    exampleEntries: clonePreparedPromptEntries(normalizedPromptInput.exampleEntries),
    exampleMessages: createPromptMessagesFromEntries(normalizedPromptInput.exampleEntries),
    historyEntries: clonePreparedPromptEntries(normalizedPromptInput.historyEntries),
    historyMessages: createPromptMessagesFromEntries(normalizedPromptInput.historyEntries),
    requestEntries: clonePreparedPromptEntries(normalizedPromptInput.requestEntries),
    requestMessages: createPromptMessagesFromEntries(normalizedPromptInput.requestEntries),
    systemPrompt: normalizeSystemPrompt(normalizedPromptInput.systemPrompt),
    systemPromptSections: normalizePromptSections(normalizedPromptInput.systemPromptSections),
    transientBlock: typeof normalizedPromptInput.transientBlock === "string" ? normalizedPromptInput.transientBlock : "",
    transientEntry: clonePreparedPromptEntry(normalizedPromptInput.transientEntry),
    transientSections: normalizeTransientSections(normalizedPromptInput.transientSections)
  };
}

export const fetchDefaultOnscreenAgentSystemPrompt = globalThis.space.extend(
  import.meta,
  async function fetchDefaultOnscreenAgentSystemPrompt(options = {}) {
    const forceRefresh = options.forceRefresh === true;

    if (!forceRefresh && defaultSystemPromptPromise) {
      return defaultSystemPromptPromise;
    }

    defaultSystemPromptPromise = loadPromptFile(
      DEFAULT_ONSCREEN_AGENT_SYSTEM_PROMPT_PATH,
      "default onscreen agent system prompt"
    ).catch((error) => {
      defaultSystemPromptPromise = null;
      throw error;
    });

    return defaultSystemPromptPromise;
  }
);

export const fetchOnscreenAgentHistoryCompactPrompt = globalThis.space.extend(
  import.meta,
  async function fetchOnscreenAgentHistoryCompactPrompt(options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const mode = normalizeHistoryCompactMode(options.mode);

    if (!forceRefresh && compactPromptPromises[mode]) {
      return compactPromptPromises[mode];
    }

    const promptConfig = resolveHistoryCompactPromptConfig(mode);
    compactPromptPromises[mode] = loadPromptFile(promptConfig.path, promptConfig.label).catch((error) => {
      compactPromptPromises[mode] = null;
      throw error;
    });

    return compactPromptPromises[mode];
  }
);

export function extractCustomOnscreenAgentSystemPrompt(storedPrompt = "", defaultSystemPrompt = "") {
  return stripDefaultPromptPrefix(storedPrompt, defaultSystemPrompt);
}

export const buildOnscreenAgentSystemPromptSections = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentSystemPromptSections(context = {}) {
    if (shouldUseLocalPromptProfile(context)) {
      const customPrompt = formatCustomUserInstructions(context.systemPrompt);

      return {
        ...context,
        justLoadedSkillsSection: "",
        basePrompt: LOCAL_ONSCREEN_AGENT_SYSTEM_PROMPT,
        customPrompt,
        localProfile: true,
        sections: [LOCAL_ONSCREEN_AGENT_SYSTEM_PROMPT, customPrompt].filter(Boolean),
        skillsSection: ""
      };
    }

    const basePrompt = normalizeSystemPrompt(
      context.defaultSystemPrompt || (await fetchDefaultOnscreenAgentSystemPrompt())
    );
    const customPrompt = formatCustomUserInstructions(context.systemPrompt);
    const skillsSection = await skills.buildOnscreenSkillsPromptSection();
    const justLoadedSkillsSection = await skills.buildOnscreenJustLoadedSkillsPromptSection();

    return {
      ...context,
      justLoadedSkillsSection,
      basePrompt,
      customPrompt,
      sections: [basePrompt, customPrompt, skillsSection, justLoadedSkillsSection].filter(Boolean),
      skillsSection
    };
  }
);

export const buildRuntimeOnscreenAgentSystemPrompt = globalThis.space.extend(
  import.meta,
  async function buildRuntimeOnscreenAgentSystemPrompt(systemPrompt = "", options = {}) {
    const promptContext = await buildOnscreenAgentSystemPromptSections({
      defaultSystemPrompt: options.defaultSystemPrompt,
      options,
      systemPrompt
    });

    return normalizePromptSections(promptContext?.sections).join("\n\n");
  }
);

export const buildOnscreenAgentExampleMessages = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentExampleMessages(context = {}) {
    return {
      ...context,
      exampleMessages: normalizeConversationMessages(context.exampleMessages)
    };
  }
);

export const buildOnscreenAgentHistoryMessages = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentHistoryMessages(context = {}) {
    const historyMessages = Array.isArray(context.historyMessages) ? context.historyMessages : context.messages;

    return {
      ...context,
      historyMessages: normalizeConversationMessages(historyMessages)
    };
  }
);

export const buildOnscreenAgentTransientSections = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentTransientSections(context = {}) {
    return {
      ...context,
      sections: normalizeTransientSections(context.sections)
    };
  }
);

export const buildOnscreenAgentPromptInput = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentPromptInput(context = {}) {
    const historyMessagesInput = Array.isArray(context.historyMessages) ? context.historyMessages : context.messages;
    const systemPromptContext = await buildOnscreenAgentSystemPromptSections({
      defaultSystemPrompt: context.defaultSystemPrompt,
      options: context.options,
      systemPrompt: context.systemPrompt
    });
    const runtimeSystemPrompt = normalizePromptSections(systemPromptContext?.sections).join("\n\n");
    const exampleContext = await buildOnscreenAgentExampleMessages({
      ...context,
      historyMessages: historyMessagesInput,
      runtimeSystemPrompt,
      systemPrompt: runtimeSystemPrompt,
      systemPromptContext
    });
    const exampleEntries = buildPreparedPromptEntriesFromMessages(exampleContext?.exampleMessages, {
      source: ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.EXAMPLE
    });
    const historyContext = await buildOnscreenAgentHistoryMessages({
      ...context,
      exampleEntries: clonePreparedPromptEntries(exampleEntries),
      historyMessages: historyMessagesInput,
      runtimeSystemPrompt,
      systemPrompt: runtimeSystemPrompt,
      systemPromptContext
    });
    const historyEntries = normalizeConversationMessages(historyContext?.historyMessages)
      .map((message) =>
        createPreparedPromptEntryFromMessage(message, {
          source: resolveHistoryPromptEntrySource(message)
        })
      )
      .filter(Boolean);
    const transientContext = await buildOnscreenAgentTransientSections({
      ...context,
      exampleEntries: clonePreparedPromptEntries(exampleEntries),
      historyEntries: clonePreparedPromptEntries(historyEntries),
      requestEntries: [...clonePreparedPromptEntries(exampleEntries), ...clonePreparedPromptEntries(historyEntries)],
      sections: collectRuntimeTransientSections(context),
      runtimeSystemPrompt,
      systemPrompt: runtimeSystemPrompt,
      systemPromptContext
    });
    const transientSections = filterDuplicateTransientSections(
      normalizeTransientSections(transientContext?.sections),
      historyEntries
    );
    const transientBlock = formatTransientMessageBlock(transientSections);
    const transientEntry = createTransientPromptEntry(transientBlock);
    const systemEntry = createSystemPromptEntry(runtimeSystemPrompt);
    const requestEntries = [systemEntry, ...exampleEntries, ...historyEntries, transientEntry].filter(Boolean);

    return {
      ...context,
      exampleEntries: clonePreparedPromptEntries(exampleEntries),
      exampleMessages: createPromptMessagesFromEntries(exampleEntries),
      historyEntries: clonePreparedPromptEntries(historyEntries),
      historyMessages: createPromptMessagesFromEntries(historyEntries),
      requestEntries: clonePreparedPromptEntries(requestEntries),
      requestMessages: createPromptMessagesFromEntries(requestEntries),
      systemPrompt: runtimeSystemPrompt,
      systemPromptContext,
      systemPromptSections: normalizePromptSections(systemPromptContext?.sections),
      transientBlock,
      transientEntry: clonePreparedPromptEntry(transientEntry),
      transientSections
    };
  }
);

export const buildOnscreenAgentPromptMessageContext = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentPromptMessageContext(context = {}) {
    const promptInput = await buildOnscreenAgentPromptInput(context);

    return {
      ...context,
      exampleEntries: clonePreparedPromptEntries(promptInput.exampleEntries),
      historyEntries: clonePreparedPromptEntries(promptInput.historyEntries),
      requestEntries: clonePreparedPromptEntries(promptInput.requestEntries),
      requestMessages: createPromptMessagesFromEntries(promptInput.requestEntries),
      systemPrompt: promptInput.systemPrompt,
      transientBlock: promptInput.transientBlock,
      transientSections: normalizeTransientSections(promptInput.transientSections)
    };
  }
);

export async function buildOnscreenAgentPromptMessages(systemPrompt, messages, options = {}) {
  const promptInput = await buildOnscreenAgentPromptInput({
    ...options,
    historyMessages: messages,
    messages,
    systemPrompt,
    transientSections: options.transientSections
  });

  return Array.isArray(promptInput?.requestMessages) ? promptInput.requestMessages : [];
}

class OnscreenAgentPromptInstance {
  constructor(options = {}) {
    const historyMessages = Array.isArray(options.historyMessages) ? options.historyMessages : options.messages;

    this.context = {
      defaultSystemPrompt: options.defaultSystemPrompt,
      exampleMessages: Array.isArray(options.exampleMessages) ? options.exampleMessages : [],
      historyMessages: Array.isArray(historyMessages) ? historyMessages : [],
      options: options.options && typeof options.options === "object" ? { ...options.options } : {},
      systemPrompt: typeof options.systemPrompt === "string" ? options.systemPrompt : "",
      transientSections: Array.isArray(options.transientSections) ? options.transientSections : []
    };
    this.promptInput = createEmptyPromptInput();
  }

  async build(context = {}) {
    const historyMessages = Array.isArray(context.historyMessages) ? context.historyMessages : context.messages;

    this.context = {
      ...this.context,
      ...context,
      historyMessages: Array.isArray(historyMessages) ? historyMessages : this.context.historyMessages,
      options: context.options && typeof context.options === "object" ? { ...context.options } : this.context.options,
      transientSections: Array.isArray(context.transientSections)
        ? context.transientSections
        : this.context.transientSections
    };
    this.promptInput = await buildOnscreenAgentPromptInput({
      ...this.context,
      prompt: this
    });
    return clonePromptInput(this.promptInput);
  }

  async updateHistory(historyMessages, options = {}) {
    const nextHistoryMessages = Array.isArray(historyMessages) ? historyMessages : [];

    this.context = {
      ...this.context,
      ...options,
      historyMessages: nextHistoryMessages
    };

    if (!this.promptInput?.requestEntries?.length && !this.promptInput?.systemPrompt) {
      return this.build({
        ...options,
        historyMessages: nextHistoryMessages
      });
    }

    const historyContext = await buildOnscreenAgentHistoryMessages({
      ...this.context,
      exampleEntries: clonePreparedPromptEntries(this.promptInput.exampleEntries),
      historyMessages: nextHistoryMessages,
      prompt: this,
      runtimeSystemPrompt: this.promptInput.systemPrompt,
      systemPrompt: this.promptInput.systemPrompt,
      systemPromptContext: this.promptInput.systemPromptContext
    });
    const historyEntries = normalizeConversationMessages(historyContext?.historyMessages)
      .map((message) =>
        createPreparedPromptEntryFromMessage(message, {
          source: resolveHistoryPromptEntrySource(message)
        })
      )
      .filter(Boolean);
    const requestEntries = [
      createSystemPromptEntry(this.promptInput.systemPrompt),
      ...clonePreparedPromptEntries(this.promptInput.exampleEntries),
      ...clonePreparedPromptEntries(historyEntries),
      clonePreparedPromptEntry(this.promptInput.transientEntry)
    ].filter(Boolean);

    this.promptInput = {
      ...this.promptInput,
      historyEntries: clonePreparedPromptEntries(historyEntries),
      historyMessages: createPromptMessagesFromEntries(historyEntries),
      requestEntries: clonePreparedPromptEntries(requestEntries),
      requestMessages: createPromptMessagesFromEntries(requestEntries)
    };

    return clonePromptInput(this.promptInput);
  }

  getPromptInput() {
    return clonePromptInput(this.promptInput);
  }
}

export function createOnscreenAgentPromptInstance(options = {}) {
  return new OnscreenAgentPromptInstance(options);
}

function createRequestBody(settings, promptInput) {
  const requestMessages = mergeConsecutiveChatMessages(
    Array.isArray(promptInput?.requestMessages) ? promptInput.requestMessages : []
  );

  return {
    ...llmParams.parseOnscreenAgentParamsText(settings.paramsText || ""),
    model: settings.model || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.model,
    stream: true,
    messages: requestMessages
  };
}

function resolveChatRequestUrl(apiEndpoint) {
  if (!proxyUrl.isProxyableExternalUrl(apiEndpoint)) {
    return apiEndpoint;
  }

  if (window.space?.proxy?.buildUrl) {
    return window.space.proxy.buildUrl(apiEndpoint);
  }

  return proxyUrl.buildProxyUrl(apiEndpoint);
}

export const prepareOnscreenAgentCompletionRequest = globalThis.space.extend(
  import.meta,
  async function prepareOnscreenAgentCompletionRequest({
    defaultSystemPrompt,
    messages,
    options,
    promptInput,
    promptInstance,
    settings,
    systemPrompt,
    transientSections
  }) {
    const normalizedSettings =
      settings && typeof settings === "object" ? settings : config.DEFAULT_ONSCREEN_AGENT_SETTINGS;
    const effectivePromptInput =
      promptInput && typeof promptInput === "object"
        ? clonePromptInput(promptInput)
        : promptInstance && typeof promptInstance.build === "function"
          ? await promptInstance.build({
              defaultSystemPrompt,
              historyMessages: messages,
              options,
              systemPrompt,
              transientSections
            })
          : await buildOnscreenAgentPromptInput({
              defaultSystemPrompt,
              historyMessages: messages,
              messages,
              options,
              systemPrompt,
              transientSections
            });
    const requestMessages = Array.isArray(effectivePromptInput?.requestMessages)
      ? effectivePromptInput.requestMessages
      : [];

    return {
      messages: requestMessages,
      promptInput: effectivePromptInput,
      requestBody: createRequestBody(normalizedSettings, effectivePromptInput),
      requestUrl: resolveChatRequestUrl(normalizedSettings.apiEndpoint || ""),
      settings: normalizedSettings,
      systemPrompt: effectivePromptInput.systemPrompt || normalizeSystemPrompt(systemPrompt)
    };
  }
);
