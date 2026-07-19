import * as config from "/mod/_core/onscreen_agent/config.js";
import {
  buildPromptLongMessagePlaceholder,
  buildPromptOverflowTrimPlan,
  comparePromptTrimCandidates,
  estimatePromptCharsForTokenRemoval,
  listPromptItems,
  mergePromptItemMaps,
  normalizePromptBudgetRatios,
  normalizePromptItemDefinition,
  normalizePromptItemMap,
  trimPromptLongMessage
} from "/mod/_core/agent_prompt/prompt-items.js";
import { createAgentPromptInstance } from "/mod/_core/agent_prompt/prompt-runtime.js";
import { buildMessagePromptParts, MESSAGE_PROMPT_PART_BLOCK } from "/mod/_core/onscreen_agent/attachments.js";
import * as llmParams from "/mod/_core/onscreen_agent/llm-params.js";
import * as skills from "/mod/_core/onscreen_agent/skills.js";
import { mergeConsecutiveChatMessages } from "/mod/_core/framework/js/chat-messages.js";
import { countTextTokens } from "/mod/_core/framework/js/token-count.js";
import * as proxyUrl from "/mod/_core/framework/js/proxy-url.js";
import {
  estimateVisualDataTokens,
  normalizeVisionModelConfig,
  normalizeVisualDataList,
  prepareChatMessagesForVisionTransport
} from "/mod/_core/agent-chat/visual-data.js";

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

const ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE = Object.freeze({
  EXAMPLE: "example",
  HISTORY: "history",
  HISTORY_COMPACT: "history-compact",
  SYSTEM: "system",
  TRANSIENT: "transient"
});
const ONSCREEN_AGENT_EXAMPLE_RESET_TEXT = "start of new conversation - don't refer to previous contents";
const MIN_PROMPT_PART_TRIM_TOKENS = 250;
const ONSCREEN_AGENT_SYSTEM_ITEM_KEY = Object.freeze({
  AUTO_LOADED_SKILLS: "onscreen:system:auto-loaded-skills",
  BASE: "onscreen:system:base",
  CUSTOM: "onscreen:system:custom-instructions",
  LOADED_SKILLS: "onscreen:system:loaded-skills",
  SKILLS: "onscreen:system:skills"
});
const ONSCREEN_AGENT_SYSTEM_ITEM_ORDER = Object.freeze({
  AUTO_LOADED_SKILLS: 310,
  BASE: 0,
  CUSTOM_AFTER_BASE: 20,
  CUSTOM_END: 900,
  LOADED_SKILLS: 320,
  SKILLS: 300
});
const ONSCREEN_AGENT_SYSTEM_ITEM_TRIM_PRIORITY = Object.freeze({
  AUTO_LOADED_SKILLS: 20,
  CUSTOM: 5,
  LOADED_SKILLS: 20,
  SKILLS: 10
});
const ONSCREEN_AGENT_TRANSIENT_ITEM_PREFIX = "onscreen:transient";

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

function resolveCustomPromptPlacement(options = {}) {
  return options?.customPromptPlacement === "end" ? "end" : "after-base";
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

function formatPromptSourcePath(sourcePath = "") {
  const normalizedPath = String(sourcePath || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");

  return normalizedPath ? `/${normalizedPath}` : "";
}

function renderSystemPromptItem(item = {}) {
  const value = typeof item?.value === "string" ? item.value : "";

  if (!value.trim()) {
    return "";
  }

  const sourcePath = formatPromptSourcePath(item.sourcePath);

  if (!sourcePath) {
    return value;
  }

  return [
    `source: ${sourcePath}`,
    value
  ].join("\n");
}

function renderSystemPromptItems(items = {}) {
  return listPromptItems(items)
    .map((item) => renderSystemPromptItem(item))
    .filter((item) => item.trim());
}

function createSystemPromptItem(key, value, options = {}) {
  return normalizePromptItemDefinition(key, {
    ...options,
    value
  });
}

function buildBaseSystemPromptItems(context = {}) {
  const items = Object.create(null);
  const customPromptPlacement = resolveCustomPromptPlacement(context.options);
  const customPromptOrder =
    customPromptPlacement === "end"
      ? ONSCREEN_AGENT_SYSTEM_ITEM_ORDER.CUSTOM_END
      : ONSCREEN_AGENT_SYSTEM_ITEM_ORDER.CUSTOM_AFTER_BASE;
  const systemItems = [
    createSystemPromptItem(ONSCREEN_AGENT_SYSTEM_ITEM_KEY.BASE, context.basePrompt, {
      order: ONSCREEN_AGENT_SYSTEM_ITEM_ORDER.BASE,
      trimAllowed: false
    }),
    createSystemPromptItem(ONSCREEN_AGENT_SYSTEM_ITEM_KEY.CUSTOM, context.customPrompt, {
      order: customPromptOrder,
      trimPriority: ONSCREEN_AGENT_SYSTEM_ITEM_TRIM_PRIORITY.CUSTOM
    }),
    createSystemPromptItem(ONSCREEN_AGENT_SYSTEM_ITEM_KEY.SKILLS, context.skillsSection, {
      order: ONSCREEN_AGENT_SYSTEM_ITEM_ORDER.SKILLS,
      trimPriority: ONSCREEN_AGENT_SYSTEM_ITEM_TRIM_PRIORITY.SKILLS
    }),
    createSystemPromptItem(ONSCREEN_AGENT_SYSTEM_ITEM_KEY.AUTO_LOADED_SKILLS, context.autoLoadedSkillsSection, {
      order: ONSCREEN_AGENT_SYSTEM_ITEM_ORDER.AUTO_LOADED_SKILLS,
      trimPriority: ONSCREEN_AGENT_SYSTEM_ITEM_TRIM_PRIORITY.AUTO_LOADED_SKILLS
    }),
    createSystemPromptItem(ONSCREEN_AGENT_SYSTEM_ITEM_KEY.LOADED_SKILLS, context.loadedSkillsSection, {
      order: ONSCREEN_AGENT_SYSTEM_ITEM_ORDER.LOADED_SKILLS,
      trimPriority: ONSCREEN_AGENT_SYSTEM_ITEM_TRIM_PRIORITY.LOADED_SKILLS
    })
  ];

  systemItems.filter(Boolean).forEach((item) => {
    items[item.key] = {
      ...item
    };
  });

  return items;
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

  const content = typeof message.content === "string" ? message.content : "";
  const visualData = normalizeVisualDataList(message?.visualData);
  const tokenCount = Number.isFinite(Number(message?.tokenCount))
    ? Math.max(0, Math.floor(Number(message.tokenCount)))
    : countTextTokens(content);

  if (message && typeof message === "object" && !Array.isArray(message) && !Number.isFinite(Number(message?.tokenCount))) {
    message.tokenCount = tokenCount;
  }

  return {
    attachments: Array.isArray(message?.attachments) ? message.attachments : [],
    content,
    id: typeof message?.id === "string" ? message.id : "",
    kind: typeof message?.kind === "string" ? message.kind.trim() : "",
    role: message.role,
    tokenCount,
    visualData
  };
}

function normalizeConversationMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => normalizeConversationMessage(message)).filter(Boolean);
}

function formatPreparedUserMessageBlock(content, blockMarker) {
  const normalizedContent = typeof content === "string" ? content.trim() : "";

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
  const visualData = normalizedRole === "user" ? normalizeVisualDataList(options.visualData) : [];

  if (!normalizedRole || (!normalizedContent && !visualData.length)) {
    return null;
  }
  const visualTokenCount = estimateVisualDataTokens(visualData, options.modelConfig);

  return {
    blockType: typeof options?.blockType === "string" ? options.blockType.trim() : "",
    content: normalizedContent,
    kind: typeof options?.kind === "string" ? options.kind.trim() : "",
    messageId: typeof options?.messageId === "string" ? options.messageId : "",
    role: normalizedRole,
    source: normalizePromptMessageSource(options?.source),
    tokenCount: Number.isFinite(Number(options?.tokenCount))
      ? Math.max(0, Math.floor(Number(options.tokenCount)))
      : countTextTokens(normalizedContent) + visualTokenCount,
    visualData
  };
}

function clonePreparedPromptEntry(entry) {
  return entry && typeof entry === "object"
    ? {
        ...entry,
        visualData: normalizeVisualDataList(entry.visualData)
      }
    : null;
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
    role: entry.role,
    tokenCount: Number.isFinite(Number(entry?.tokenCount)) ? Math.max(0, Math.floor(Number(entry.tokenCount))) : 0,
    visualData: normalizeVisualDataList(entry.visualData)
  }));
}

function resolveHistoryPromptEntrySource(message) {
  return message?.kind === "history-compact"
    ? ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY_COMPACT
    : ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY;
}

function createExampleResetPromptEntry() {
  return createPreparedPromptEntry(
    "user",
    formatPreparedUserMessageBlock(
      ONSCREEN_AGENT_EXAMPLE_RESET_TEXT,
      ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.FRAMEWORK
    ),
    {
      blockType: ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.FRAMEWORK,
      source: ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.EXAMPLE
    }
  );
}

function appendExampleResetPromptEntry(entries) {
  const normalizedEntries = clonePreparedPromptEntries(entries);

  if (!normalizedEntries.length) {
    return normalizedEntries;
  }

  const resetEntry = createExampleResetPromptEntry();
  return resetEntry ? [...normalizedEntries, resetEntry] : normalizedEntries;
}

function createPreparedPromptEntriesFromMessage(message, options = {}) {
  const normalizedMessage = normalizeConversationMessage(message);

  if (!normalizedMessage) {
    return [];
  }

  const source = options.source || resolveHistoryPromptEntrySource(normalizedMessage);
  const modelConfig = normalizeVisionModelConfig(options.modelConfig);

  return buildMessagePromptParts(normalizedMessage)
    .map((part) => {
      if (part.blockType === MESSAGE_PROMPT_PART_BLOCK.ASSISTANT) {
        return createPreparedPromptEntry("assistant", part.content, {
          blockType: "assistant",
          kind: normalizedMessage.kind,
          messageId: normalizedMessage.id,
          source,
          modelConfig
        });
      }

      const blockType =
        part.blockType === MESSAGE_PROMPT_PART_BLOCK.FRAMEWORK
          ? ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.FRAMEWORK
          : ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.USER;

      return createPreparedPromptEntry(
        "user",
        formatPreparedUserMessageBlock(part.content, blockType),
        {
          blockType,
          kind: normalizedMessage.kind,
          messageId: normalizedMessage.id,
          source,
          modelConfig,
          visualData: part.visualData
        }
      );
    })
    .filter(Boolean);
}

function buildPreparedPromptEntriesFromMessages(messages, options = {}) {
  return normalizeConversationMessages(messages)
    .flatMap((message) => createPreparedPromptEntriesFromMessage(message, options));
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

function createTransientPromptItem(section = {}, fallbackKey = "") {
  const normalizedSection = normalizeTransientSection(section, fallbackKey);

  if (!normalizedSection) {
    return null;
  }

  return normalizePromptItemDefinition(normalizedSection.key, {
    heading: normalizedSection.heading,
    key: normalizedSection.key,
    order: normalizedSection.order,
    trimPriority: Number.isFinite(section?.trimPriority) ? Number(section.trimPriority) : 0,
    value: normalizedSection.content
  });
}

function normalizeTransientItems(items = {}) {
  return normalizePromptItemMap(items, {
    fromArray(entry, index) {
      return createTransientPromptItem(entry, `${ONSCREEN_AGENT_TRANSIENT_ITEM_PREFIX}:${index + 1}`);
    },
    keyPrefix: ONSCREEN_AGENT_TRANSIENT_ITEM_PREFIX
  });
}

function listTransientPromptSections(items = {}) {
  return listPromptItems(normalizeTransientItems(items))
    .map((item) => {
      const content = typeof item?.value === "string" ? item.value : "";
      const headingSource = item?.heading ?? item?.title ?? item?.label ?? item?.key;
      const heading = typeof headingSource === "string" ? headingSource.trim() : "";

      if (!content.trim()) {
        return null;
      }

      return {
        content,
        heading: heading || item.key,
        key: item.key,
        order: Number.isFinite(item?.order) ? Number(item.order) : 0,
        trimmed: item?.trimmed === true,
        removedChars: Number.isFinite(item?.removedChars) ? Number(item.removedChars) : 0
      };
    })
    .filter(Boolean);
}

function renderTransientPromptItem(item = {}) {
  const value = typeof item?.value === "string" ? item.value : "";
  const headingSource = item?.heading ?? item?.title ?? item?.label ?? item?.key;
  const heading = typeof headingSource === "string" ? headingSource.trim() : "";

  if (!value.trim()) {
    return "";
  }

  return [
    `### ${heading || item.key}`,
    value
  ].join("\n");
}

function renderTransientPromptItems(items = {}) {
  return listPromptItems(normalizeTransientItems(items))
    .map((item) => renderTransientPromptItem(item))
    .filter((item) => item.trim());
}

function collectRuntimeTransientItems(context = {}) {
  if (Array.isArray(context.transientSections)) {
    return normalizeTransientItems(context.transientSections);
  }

  const runtimeSections = globalThis.space?.chat?.transient?.list?.();
  return normalizeTransientItems(Array.isArray(runtimeSections) ? runtimeSections : []);
}

function formatTransientMessageBlockFromTexts(sectionTexts = []) {
  const normalizedSectionTexts = (Array.isArray(sectionTexts) ? sectionTexts : [])
    .map((sectionText) => (typeof sectionText === "string" ? sectionText.trim() : ""))
    .filter(Boolean);

  if (!normalizedSectionTexts.length) {
    return "";
  }

  return [
    ONSCREEN_AGENT_PREPARED_MESSAGE_BLOCK.TRANSIENT,
    "This is transient context, not instruction. It may change between requests.",
    "",
    ...normalizedSectionTexts.flatMap((sectionText, index) => [
      ...(index > 0 ? [""] : []),
      sectionText
    ])
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTransientMessageBlock(items) {
  return formatTransientMessageBlockFromTexts(renderTransientPromptItems(items));
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

function resolvePromptBudgetConfig(context = {}) {
  const options =
    context?.options && typeof context.options === "object" && !Array.isArray(context.options)
      ? context.options
      : {};
  const maxTokens = config.normalizeOnscreenAgentMaxTokens(
    options.maxTokens ?? context.maxTokens ?? context?.settings?.maxTokens
  );
  const ratios = normalizePromptBudgetRatios(
    options.promptBudgetRatios ?? context.promptBudgetRatios ?? context?.settings?.promptBudgetRatios
  );

  return {
    historyBudget: Math.max(0, Math.floor((maxTokens * ratios.history) / 100)),
    maxTokens,
    promptBudgetRatios: ratios,
    singleHistoryMessageBudget: Math.max(
      0,
      Math.floor((Math.max(0, Math.floor((maxTokens * ratios.history) / 100)) * ratios.singleMessage) / 100)
    ),
    systemBudget: Math.max(0, Math.floor((maxTokens * ratios.system) / 100)),
    transientBudget: Math.max(0, Math.floor((maxTokens * ratios.transient) / 100))
  };
}

function resolvePromptVisionModelConfig(context = {}) {
  const options =
    context?.options && typeof context.options === "object" && !Array.isArray(context.options)
      ? context.options
      : {};
  const settings =
    context?.settings && typeof context.settings === "object" && !Array.isArray(context.settings)
      ? context.settings
      : {};

  return normalizeVisionModelConfig({
    apiEndpoint: options.apiEndpoint ?? settings.apiEndpoint ?? context.apiEndpoint,
    detail: options.imageDetail ?? settings.imageDetail ?? context.imageDetail,
    model: options.model ?? settings.model ?? context.model,
    provider: options.provider ?? settings.provider ?? context.provider,
    supportsVision:
      options.supportsVision === true ||
      settings.supportsVision === true ||
      context.supportsVision === true
  });
}

function createPromptContributor(options = {}) {
  const renderValue =
    typeof options.renderValue === "function"
      ? options.renderValue
      : (valueText) => String(valueText ?? "");
  const originalValueText =
    typeof options.valueText === "string" ? options.valueText : String(options.valueText ?? "");
  const originalValueTokenCount = Number.isFinite(Number(options.valueTokenCount))
    ? Math.max(0, Math.floor(Number(options.valueTokenCount)))
    : countTextTokens(originalValueText);
  const fixedTokenCount = Number.isFinite(Number(options.fixedTokenCount))
    ? Math.max(0, Math.floor(Number(options.fixedTokenCount)))
    : 0;
  const contributor = {
    blockType: typeof options.blockType === "string" ? options.blockType.trim() : "",
    currentText: "",
    currentValueText: originalValueText,
    exhausted: false,
    fullText: "",
    fixedTokenCount,
    heading: typeof options.heading === "string" ? options.heading.trim() : "",
    id: 0,
    key: typeof options.key === "string" ? options.key.trim() : "",
    messageId: typeof options.messageId === "string" ? options.messageId : "",
    minimumVisibleChars: Number.isFinite(Number(options.minimumVisibleChars))
      ? Math.max(24, Math.round(Number(options.minimumVisibleChars)))
      : 48,
    order: Number.isFinite(Number(options.order)) ? Number(options.order) : 0,
    originalValueTokenCount,
    originalValueText,
    part: typeof options.part === "string" ? options.part.trim() : "",
    removedChars: 0,
    renderValue,
    role: typeof options.role === "string" ? options.role.trim() : "",
    source: typeof options.source === "string" ? options.source.trim() : "",
    sourcePath: typeof options.sourcePath === "string" ? options.sourcePath.trim() : "",
    tokenCount: 0,
    trimAllowed: options.trimAllowed !== false && Boolean(originalValueText.trim()),
    trimmed: false,
    trimPriority: Number.isFinite(Number(options.trimPriority)) ? Number(options.trimPriority) : 0,
    valueTokenCount: 0
  };

  contributor.fullText = renderValue(originalValueText);
  contributor.currentText = contributor.fullText;
  contributor.valueTokenCount = originalValueTokenCount;
  contributor.tokenCount = Number.isFinite(Number(options.tokenCount))
    ? Math.max(0, Math.floor(Number(options.tokenCount)))
    : countTextTokens(contributor.currentText) + fixedTokenCount;
  return contributor;
}

function clonePromptContributorPromptEntry(entry, contributor) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    ...entry,
    content: contributor?.currentText || entry.content,
    promptItemId: Number.isFinite(Number(contributor?.id)) ? Number(contributor.id) : 0,
    removedChars: Number.isFinite(Number(contributor?.removedChars)) ? Number(contributor.removedChars) : 0,
    tokenCount: Number.isFinite(Number(contributor?.tokenCount))
      ? Math.max(0, Math.floor(Number(contributor.tokenCount)))
      : Number.isFinite(Number(entry?.tokenCount))
        ? Math.max(0, Math.floor(Number(entry.tokenCount)))
        : 0,
    trimmed: contributor?.trimmed === true,
    visualData: normalizeVisualDataList(entry.visualData)
  };
}

function canTrimPromptContributor(contributor) {
  return Boolean(
    contributor &&
      contributor.trimAllowed !== false &&
      typeof contributor.originalValueText === "string" &&
      contributor.originalValueText.trim() &&
      contributor.exhausted !== true
  );
}

function trimPromptContributorByOverflow(contributor, overflowTokens) {
  if (!canTrimPromptContributor(contributor)) {
    return false;
  }

  const normalizedOverflowTokens = Number.isFinite(Number(overflowTokens))
    ? Math.max(1, Math.ceil(Number(overflowTokens)))
    : 1;
  const currentTokenCount = Math.max(0, contributor.tokenCount);
  const targetTokenCount = Math.max(0, currentTokenCount - normalizedOverflowTokens);
  const originalValueTokenCount = Math.max(1, contributor.originalValueTokenCount);
  const estimatedRemovedChars = contributor.removedChars + estimatePromptCharsForTokenRemoval(
    contributor.originalValueText,
    normalizedOverflowTokens,
    {
      tokenCount: originalValueTokenCount
    }
  );
  const placeholderTokenCount = countTextTokens(
    buildPromptLongMessagePlaceholder({
      id: contributor.id,
      removedChars: estimatedRemovedChars
    })
  );
  const nextRemovedChars = contributor.removedChars + estimatePromptCharsForTokenRemoval(
    contributor.originalValueText,
    normalizedOverflowTokens + placeholderTokenCount,
    {
      tokenCount: originalValueTokenCount
    }
  );
  let trimmedValue = trimPromptLongMessage(contributor.originalValueText, {
    id: contributor.id,
    minimumVisibleChars: contributor.minimumVisibleChars,
    removeChars: nextRemovedChars
  });
  let trimmedValueTokenCount = countTextTokens(trimmedValue.text);

  if (trimmedValueTokenCount > targetTokenCount) {
    const additionalOverflowTokens = trimmedValueTokenCount - targetTokenCount;
    const recalibratedRemovedChars = trimmedValue.removedChars + estimatePromptCharsForTokenRemoval(
      contributor.originalValueText,
      additionalOverflowTokens,
      {
        tokenCount: originalValueTokenCount
      }
    );

    trimmedValue = trimPromptLongMessage(contributor.originalValueText, {
      id: contributor.id,
      minimumVisibleChars: contributor.minimumVisibleChars,
      removeChars: recalibratedRemovedChars
    });
    trimmedValueTokenCount = countTextTokens(trimmedValue.text);
  }

  if (trimmedValue.removedChars <= contributor.removedChars) {
    contributor.exhausted = true;
    return false;
  }

  contributor.currentValueText = trimmedValue.text;
  contributor.removedChars = trimmedValue.removedChars;
  contributor.trimmed = contributor.removedChars > 0;
  contributor.currentText = contributor.renderValue(contributor.currentValueText);
  contributor.valueTokenCount = trimmedValueTokenCount;
  contributor.tokenCount =
    contributor.currentText === contributor.currentValueText
      ? trimmedValueTokenCount + contributor.fixedTokenCount
      : countTextTokens(contributor.currentText) + contributor.fixedTokenCount;
  return true;
}

function trimPromptContributorToTokenLimit(contributor, tokenLimit) {
  const normalizedTokenLimit = Number.isFinite(Number(tokenLimit))
    ? Math.max(0, Math.floor(Number(tokenLimit)))
    : 0;

  if (contributor.tokenCount > normalizedTokenLimit) {
    trimPromptContributorByOverflow(
      contributor,
      contributor.tokenCount - normalizedTokenLimit
    );
  }

  return contributor;
}

function countSystemPromptTokensFromContributors(contributors = []) {
  return countTextTokens(
    (Array.isArray(contributors) ? contributors : [])
      .map((contributor) => contributor?.currentText || "")
      .filter((entry) => entry.trim())
      .join("\n\n")
  );
}

function countHistoryPromptTokensFromContributors(contributors = []) {
  return (Array.isArray(contributors) ? contributors : []).reduce(
    (total, contributor) =>
      total + (Number.isFinite(Number(contributor?.tokenCount)) ? Math.max(0, Math.floor(Number(contributor.tokenCount))) : 0),
    0
  );
}

function countTransientPromptTokensFromContributors(contributors = []) {
  return countTextTokens(
    formatTransientMessageBlockFromTexts(
      (Array.isArray(contributors) ? contributors : [])
        .map((contributor) => contributor?.currentText || "")
        .filter((entry) => entry.trim())
    )
  );
}

function buildPromptPartCombinedText(contributors = []) {
  return (Array.isArray(contributors) ? contributors : [])
    .map((contributor) => contributor?.currentText || "")
    .filter((entry) => entry.trim())
    .join("\n\n");
}

function createPromptPartSectionContributor(part, contributors = [], options = {}) {
  const bodyText = buildPromptPartCombinedText(contributors);

  if (!bodyText.trim()) {
    return null;
  }

  const contributor = createPromptContributor({
    heading: typeof options.heading === "string" ? options.heading.trim() : `${part} body`,
    key: typeof options.key === "string" ? options.key.trim() : `${part}:body`,
    minimumVisibleChars: Number.isFinite(Number(options.minimumVisibleChars))
      ? Math.max(24, Math.round(Number(options.minimumVisibleChars)))
      : part === "system"
        ? 96
        : 72,
    order: Number.isFinite(Number(options.order)) ? Number(options.order) : -1,
    part,
    renderValue: (valueText) => valueText,
    trimAllowed: true,
    trimPriority: Number.isFinite(Number(options.trimPriority)) ? Number(options.trimPriority) : 100,
    valueText: bodyText,
    valueTokenCount: countTextTokens(bodyText)
  });

  contributor.id = Number.isFinite(Number(options.id)) ? Math.max(1, Math.floor(Number(options.id))) : 0;
  return contributor;
}

function buildPromptPartTrimPlan({
  budgetTokens,
  contributors = [],
  countTokens,
  part,
  sectionPromptItemId
} = {}) {
  const normalizedBudgetTokens = Number.isFinite(Number(budgetTokens))
    ? Math.max(0, Math.floor(Number(budgetTokens)))
    : 0;
  const totalTokens = countTokens(contributors);
  const overflowTokens = Math.max(0, totalTokens - normalizedBudgetTokens);
  const itemPlan = buildPromptOverflowTrimPlan(
    [...(Array.isArray(contributors) ? contributors : [])]
      .filter((contributor) => canTrimPromptContributor(contributor))
      .sort(comparePromptTrimCandidates),
    overflowTokens,
    {
      minimumStepTokens: MIN_PROMPT_PART_TRIM_TOKENS
    }
  );
  let sectionContributor = null;
  let plan = {
    mode: "none",
    totalTokens
  };

  if (overflowTokens <= 0) {
    return plan;
  }

  if (Array.isArray(itemPlan?.steps) && itemPlan.steps.length) {
    return {
      ...itemPlan,
      mode: "contributors",
      totalTokens
    };
  }

  if (part === "system" || part === "transient") {
    sectionContributor = createPromptPartSectionContributor(part, contributors, {
      heading: part === "system" ? "system prompt" : "transient context",
      id: sectionPromptItemId
    });

    if (sectionContributor && canTrimPromptContributor(sectionContributor)) {
      return {
        mode: "section",
        overflowTokens,
        sectionContributor,
        totalTokens
      };
    }
  }

  return plan;
}

function applyPromptPartBudget({
  budgetTokens,
  contributors = [],
  countTokens,
  part,
  sectionPromptItemId
} = {}) {
  const plan = buildPromptPartTrimPlan({
    budgetTokens,
    contributors,
    countTokens,
    part,
    sectionPromptItemId
  });

  if (plan.mode === "contributors") {
    const didTrim = plan.steps.reduce(
      (trimmed, step) => trimPromptContributorByOverflow(step.contributor, step.removeTokens) || trimmed,
      false
    );

    return {
      mode: didTrim ? "contributors" : "none",
      totalTokens: didTrim ? countTokens(contributors) : plan.totalTokens
    };
  }

  if (plan.mode === "section" && plan.sectionContributor) {
    const didTrim = trimPromptContributorByOverflow(plan.sectionContributor, plan.overflowTokens);

    return {
      mode: didTrim ? "section" : "none",
      sectionContributor: didTrim ? plan.sectionContributor : null,
      totalTokens: didTrim ? countTextTokens(plan.sectionContributor.currentText) : plan.totalTokens
    };
  }

  return {
    mode: "none",
    totalTokens: plan.totalTokens
  };
}

function createPromptAccessEntry(contributor) {
  if (!contributor || typeof contributor !== "object") {
    return null;
  }

  return {
    blockType: contributor.blockType,
    content: contributor.currentText,
    fullText: contributor.fullText,
    heading: contributor.heading,
    id: contributor.id,
    key: contributor.key,
    messageId: contributor.messageId,
    order: contributor.order,
    part: contributor.part,
    removedChars: contributor.removedChars,
    role: contributor.role,
    source: contributor.source,
    sourcePath: contributor.sourcePath,
    tokens: contributor.tokenCount,
    trimmed: contributor.trimmed === true
  };
}

function buildPromptInputWithBudgets({
  budgetConfig,
  exampleEntries = [],
  historyEntries = [],
  modelConfig = {},
  systemItems = {},
  transientItems = {}
} = {}) {
  const systemContributors = listPromptItems(systemItems)
    .map((item) =>
      createPromptContributor({
        heading: typeof item?.heading === "string" ? item.heading.trim() : "",
        key: item?.key,
        minimumVisibleChars: 96,
        order: item?.order,
        part: "system",
        renderValue: (valueText) =>
          renderSystemPromptItem({
            ...item,
            value: valueText
          }),
        sourcePath: item?.sourcePath,
        trimAllowed: item?.trimAllowed !== false,
        trimPriority: item?.trimPriority,
        valueText: typeof item?.value === "string" ? item.value : "",
        valueTokenCount: item?.valueTokenCount
      })
    )
    .filter((contributor) => contributor.currentText.trim());
  const allHistoryEntries = [
    ...clonePreparedPromptEntries(exampleEntries),
    ...clonePreparedPromptEntries(historyEntries)
  ];
  const historyContributors = allHistoryEntries.map((entry) =>
    createPromptContributor({
      blockType: entry?.blockType,
      fixedTokenCount: estimateVisualDataTokens(entry?.visualData, modelConfig),
      key: entry?.messageId || `${entry?.source || "history"}:${entry?.role || "user"}`,
      messageId: entry?.messageId,
      minimumVisibleChars: 72,
      part: "history",
      renderValue: (valueText) => valueText,
      role: entry?.role,
      source: entry?.source,
      trimAllowed:
        entry?.source !== ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.EXAMPLE &&
        typeof entry?.content === "string" &&
        entry.content.trim(),
      trimPriority:
        entry?.source === ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY ||
        entry?.source === ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY_COMPACT
          ? 20
          : 0,
      valueText: typeof entry?.content === "string" ? entry.content : "",
      valueTokenCount: countTextTokens(typeof entry?.content === "string" ? entry.content : ""),
      tokenCount: entry?.tokenCount
    })
  );
  const transientContributors = listPromptItems(normalizeTransientItems(transientItems))
    .map((item) =>
      createPromptContributor({
        heading: typeof item?.heading === "string" ? item.heading.trim() : "",
        key: item?.key,
        minimumVisibleChars: 72,
        order: item?.order,
        part: "transient",
        renderValue: (valueText) =>
          renderTransientPromptItem({
            ...item,
            value: valueText
          }),
        sourcePath: item?.sourcePath,
        trimAllowed: item?.trimAllowed !== false,
        trimPriority: item?.trimPriority,
        valueText: typeof item?.value === "string" ? item.value : "",
        valueTokenCount: item?.valueTokenCount
      })
    )
    .filter((contributor) => contributor.currentText.trim());
  const orderedContributors = [
    ...systemContributors,
    ...historyContributors,
    ...transientContributors
  ];

  orderedContributors.forEach((contributor, index) => {
    contributor.id = index + 1;
  });

  if (budgetConfig.singleHistoryMessageBudget >= 0) {
    historyContributors.forEach((contributor) => {
      if (
        contributor.source !== ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY &&
        contributor.source !== ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.HISTORY_COMPACT
      ) {
        return;
      }

      trimPromptContributorToTokenLimit(contributor, budgetConfig.singleHistoryMessageBudget);
    });
  }

  const systemTrimResult = applyPromptPartBudget({
    budgetTokens: budgetConfig.systemBudget,
    contributors: systemContributors,
    countTokens: countSystemPromptTokensFromContributors,
    part: "system",
    sectionPromptItemId: orderedContributors.length + 1
  });
  applyPromptPartBudget({
    budgetTokens: budgetConfig.historyBudget,
    contributors: historyContributors,
    countTokens: countHistoryPromptTokensFromContributors,
    part: "history"
  });
  const transientTrimResult = applyPromptPartBudget({
    budgetTokens: budgetConfig.transientBudget,
    contributors: transientContributors,
    countTokens: countTransientPromptTokensFromContributors,
    part: "transient",
    sectionPromptItemId: orderedContributors.length + 2
  });

  const finalSystemContributors =
    systemTrimResult.mode === "section" && systemTrimResult.sectionContributor
      ? [systemTrimResult.sectionContributor]
      : systemContributors;
  const finalTransientContributors =
    transientTrimResult.mode === "section" && transientTrimResult.sectionContributor
      ? [transientTrimResult.sectionContributor]
      : transientContributors;
  const promptAccessContributors = [
    ...finalSystemContributors,
    ...historyContributors,
    ...finalTransientContributors
  ];
  const systemPromptSections = finalSystemContributors
    .map((contributor) => contributor.currentText)
    .filter((entry) => entry.trim());
  const systemPrompt = systemPromptSections.join("\n\n");
  const finalHistoryEntries = allHistoryEntries
    .map((entry, index) => clonePromptContributorPromptEntry(entry, historyContributors[index]))
    .filter(Boolean);
  const finalExampleEntries = finalHistoryEntries.filter(
    (entry) => entry?.source === ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.EXAMPLE
  );
  const finalHistoryOnlyEntries = finalHistoryEntries.filter(
    (entry) => entry?.source !== ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.EXAMPLE
  );
  const transientBlock = formatTransientMessageBlockFromTexts(
    finalTransientContributors
      .map((contributor) => contributor.currentText)
      .filter((entry) => entry.trim())
  );
  const transientEntry = createTransientPromptEntry(transientBlock);
  const systemEntry = createSystemPromptEntry(systemPrompt);
  const requestEntries = [systemEntry, ...finalHistoryEntries, transientEntry].filter(Boolean);
  const promptItems = promptAccessContributors
    .map((contributor) => createPromptAccessEntry(contributor))
    .filter(Boolean);

  return {
    exampleEntries: clonePreparedPromptEntries(finalExampleEntries),
    exampleMessages: createPromptMessagesFromEntries(finalExampleEntries),
    historyEntries: clonePreparedPromptEntries(finalHistoryOnlyEntries),
    historyMessages: createPromptMessagesFromEntries(finalHistoryOnlyEntries),
    promptItems,
    requestEntries: clonePreparedPromptEntries(requestEntries),
    requestMessages: createPromptMessagesFromEntries(requestEntries),
    systemItems: normalizePromptItemMap(systemItems),
    systemPrompt,
    systemPromptSections,
    transientBlock,
    transientEntry: clonePreparedPromptEntry(transientEntry),
    transientItems: normalizeTransientItems(transientItems),
    transientSections: finalTransientContributors.map((contributor) => ({
      content: contributor.currentValueText,
      heading: contributor.heading || contributor.key,
      key: contributor.key,
      order: contributor.order,
      promptItemId: contributor.id,
      removedChars: contributor.removedChars,
      trimmed: contributor.trimmed === true
    }))
  };
}

function createEmptyPromptInput() {
  return {
    exampleEntries: [],
    exampleMessages: [],
    historyEntries: [],
    historyMessages: [],
    promptItems: [],
    requestEntries: [],
    requestMessages: [],
    systemItems: {},
    systemPrompt: "",
    systemPromptSections: [],
    transientBlock: "",
    transientEntry: null,
    transientItems: {},
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
    promptItems: Array.isArray(normalizedPromptInput.promptItems)
      ? normalizedPromptInput.promptItems.map((item) => ({ ...item }))
      : [],
    requestEntries: clonePreparedPromptEntries(normalizedPromptInput.requestEntries),
    requestMessages: createPromptMessagesFromEntries(normalizedPromptInput.requestEntries),
    systemItems: normalizePromptItemMap(normalizedPromptInput.systemItems),
    systemPrompt: normalizeSystemPrompt(normalizedPromptInput.systemPrompt),
    systemPromptSections: normalizePromptSections(normalizedPromptInput.systemPromptSections),
    transientBlock: typeof normalizedPromptInput.transientBlock === "string" ? normalizedPromptInput.transientBlock : "",
    transientEntry: clonePreparedPromptEntry(normalizedPromptInput.transientEntry),
    transientItems: normalizeTransientItems(normalizedPromptInput.transientItems),
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
    const basePrompt = normalizeSystemPrompt(
      context.defaultSystemPrompt || (await fetchDefaultOnscreenAgentSystemPrompt())
    );
    const customPrompt = formatCustomUserInstructions(context.systemPrompt);
    const skillPromptContext = await skills.buildOnscreenSkillPromptContext();
    const skillsSection = skillPromptContext.catalogSection;
    const autoLoadedSkillsSection = skillPromptContext.autoLoadedSkillsSection;
    const systemItems = buildBaseSystemPromptItems({
      autoLoadedSkillsSection,
      basePrompt,
      customPrompt,
      loadedSkillsSection: skillPromptContext.loadedSkillsSection,
      options: context.options,
      skillsSection
    });

    return {
      ...context,
      autoLoadedSkillsSection,
      basePrompt,
      customPrompt,
      loadedSkillsSection: skillPromptContext.loadedSkillsSection,
      loadedTransientSections: [
        ...(Array.isArray(skillPromptContext.autoLoadedTransientSections)
          ? skillPromptContext.autoLoadedTransientSections
          : []),
        ...(Array.isArray(skillPromptContext.loadedTransientSections)
          ? skillPromptContext.loadedTransientSections
          : [])
      ],
      sections: renderSystemPromptItems(systemItems),
      systemItems,
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

    return renderSystemPromptItems(promptContext?.systemItems).join("\n\n");
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
    const transientItems = mergePromptItemMaps(
      normalizeTransientItems(context.transientItems),
      normalizeTransientItems(context.sections)
    );

    return {
      ...context,
      sections: listTransientPromptSections(transientItems),
      transientItems
    };
  }
);

export const buildOnscreenAgentPromptInput = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentPromptInput(context = {}) {
    const { prompt, ...promptInputContext } = context;
    const historyMessagesInput = Array.isArray(context.historyMessages) ? context.historyMessages : context.messages;
    const systemPromptContext = await buildOnscreenAgentSystemPromptSections({
      defaultSystemPrompt: context.defaultSystemPrompt,
      options: context.options,
      systemPrompt: context.systemPrompt
    });
    const historyMessagesForPrompt = Array.isArray(historyMessagesInput) ? historyMessagesInput : [];
    const systemItems = normalizePromptItemMap(systemPromptContext?.systemItems);
    const runtimeSystemPrompt = renderSystemPromptItems(systemItems).join("\n\n");
    const modelConfig = resolvePromptVisionModelConfig(context);
    const exampleContext = await buildOnscreenAgentExampleMessages({
      ...context,
      historyMessages: historyMessagesForPrompt,
      runtimeSystemPrompt,
      systemPrompt: runtimeSystemPrompt,
      systemPromptContext
    });
    const exampleEntries = appendExampleResetPromptEntry(
      buildPreparedPromptEntriesFromMessages(exampleContext?.exampleMessages, {
        modelConfig,
        source: ONSCREEN_AGENT_PROMPT_MESSAGE_SOURCE.EXAMPLE
      })
    );
    const historyContext = await buildOnscreenAgentHistoryMessages({
      ...context,
      exampleEntries: clonePreparedPromptEntries(exampleEntries),
      historyMessages: historyMessagesForPrompt,
      runtimeSystemPrompt,
      systemPrompt: runtimeSystemPrompt,
      systemPromptContext
    });
    const historyEntries = normalizeConversationMessages(historyContext?.historyMessages)
      .flatMap((message) =>
        createPreparedPromptEntriesFromMessage(message, {
          modelConfig,
          source: resolveHistoryPromptEntrySource(message)
        })
      )
      .filter(Boolean);
    const transientSeedSections = filterDuplicateTransientSections(
      listTransientPromptSections(
        mergePromptItemMaps(
          collectRuntimeTransientItems(context),
          normalizeTransientItems(
            Array.isArray(systemPromptContext?.loadedTransientSections)
              ? systemPromptContext.loadedTransientSections
              : []
          )
        )
      ),
      historyEntries
    );
    const transientContext = await buildOnscreenAgentTransientSections({
      ...context,
      exampleEntries: clonePreparedPromptEntries(exampleEntries),
      historyEntries: clonePreparedPromptEntries(historyEntries),
      requestEntries: [...clonePreparedPromptEntries(exampleEntries), ...clonePreparedPromptEntries(historyEntries)],
      sections: transientSeedSections,
      runtimeSystemPrompt,
      systemPrompt: runtimeSystemPrompt,
      systemPromptContext
    });
    const transientItems = normalizeTransientItems(transientContext?.transientItems);
    const budgetConfig = resolvePromptBudgetConfig(context);
    const builtPromptInput = buildPromptInputWithBudgets({
      budgetConfig,
      exampleEntries,
      historyEntries,
      modelConfig,
      systemItems,
      transientItems
    });

    return {
      ...promptInputContext,
      systemPromptContext,
      systemItems,
      transientItems,
      ...builtPromptInput
    };
  }
);

export const buildOnscreenAgentPromptMessageContext = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentPromptMessageContext(context = {}) {
    const promptInput = await buildOnscreenAgentPromptInput(context);
    const { prompt, ...promptMessageContext } = context;

    return {
      ...promptMessageContext,
      exampleEntries: clonePreparedPromptEntries(promptInput.exampleEntries),
      historyEntries: clonePreparedPromptEntries(promptInput.historyEntries),
      promptItems: Array.isArray(promptInput.promptItems)
        ? promptInput.promptItems.map((item) => ({ ...item }))
        : [],
      requestEntries: clonePreparedPromptEntries(promptInput.requestEntries),
      requestMessages: createPromptMessagesFromEntries(promptInput.requestEntries),
      systemPrompt: promptInput.systemPrompt,
      transientBlock: promptInput.transientBlock,
      transientSections: normalizeTransientSections(promptInput.transientSections)
    };
  }
);

export function planOnscreenAgentPromptPartTrim(options = {}) {
  return buildPromptPartTrimPlan(options);
}

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

async function updateOnscreenAgentPromptHistory({
  context = {},
  historyMessages = [],
  prompt,
  promptInput = {}
} = {}) {
  const historyContext = await buildOnscreenAgentHistoryMessages({
    ...context,
    exampleEntries: clonePreparedPromptEntries(promptInput.exampleEntries),
    historyMessages,
    prompt,
    runtimeSystemPrompt: promptInput.systemPrompt,
    systemPrompt: promptInput.systemPrompt,
    systemPromptContext: promptInput.systemPromptContext
  });
  const historyEntries = normalizeConversationMessages(historyContext?.historyMessages)
    .flatMap((message) =>
      createPreparedPromptEntriesFromMessage(message, {
        modelConfig: resolvePromptVisionModelConfig(context),
        source: resolveHistoryPromptEntrySource(message)
      })
    )
    .filter(Boolean);
  const transientSeedSections = filterDuplicateTransientSections(
    listTransientPromptSections(
      mergePromptItemMaps(
        collectRuntimeTransientItems(context),
        normalizeTransientItems(
          Array.isArray(promptInput?.systemPromptContext?.loadedTransientSections)
            ? promptInput.systemPromptContext.loadedTransientSections
            : []
        )
      )
    ),
    historyEntries
  );
  const transientContext = await buildOnscreenAgentTransientSections({
    ...context,
    exampleEntries: clonePreparedPromptEntries(promptInput.exampleEntries),
    historyEntries: clonePreparedPromptEntries(historyEntries),
    requestEntries: [
      ...clonePreparedPromptEntries(promptInput.exampleEntries),
      ...clonePreparedPromptEntries(historyEntries)
    ],
    sections: transientSeedSections,
    runtimeSystemPrompt: promptInput.systemPrompt,
    systemPrompt: promptInput.systemPrompt,
    systemPromptContext: promptInput.systemPromptContext
  });
  const budgetConfig = resolvePromptBudgetConfig(context);
  const rebuiltPromptInput = buildPromptInputWithBudgets({
    budgetConfig,
    exampleEntries: promptInput.exampleEntries,
    historyEntries,
    modelConfig: resolvePromptVisionModelConfig(context),
    systemItems: normalizePromptItemMap(
      promptInput?.systemItems || promptInput?.systemPromptContext?.systemItems
    ),
    transientItems: normalizeTransientItems(transientContext?.transientItems)
  });

  return {
    ...promptInput,
    transientItems: normalizeTransientItems(transientContext?.transientItems),
    ...rebuiltPromptInput
  };
}

export function createOnscreenAgentPromptInstance(options = {}) {
  return createAgentPromptInstance({
    ...options,
    buildPromptInput: async (context) => buildOnscreenAgentPromptInput(context),
    updatePromptHistory: async (context) => updateOnscreenAgentPromptHistory(context)
  });
}

function buildOnscreenAgentVisionModelConfig(settings = {}) {
  const provider = config.normalizeOnscreenAgentLlmProvider(settings?.provider);

  return normalizeVisionModelConfig({
    apiEndpoint: settings?.apiEndpoint,
    model: settings?.model,
    provider,
    supportsVision:
      provider === config.ONSCREEN_AGENT_LLM_PROVIDER.API &&
      config.normalizeOnscreenAgentSupportsVision(settings?.supportsVision)
  });
}

function createRequestBody(settings, promptInput) {
  const requestMessages = mergeConsecutiveChatMessages(
    Array.isArray(promptInput?.requestMessages) ? promptInput.requestMessages : []
  );

  return {
    ...llmParams.parseOnscreenAgentParamsText(settings.paramsText || ""),
    model: settings.model || config.DEFAULT_ONSCREEN_AGENT_SETTINGS.model,
    stream: true,
    messages: prepareChatMessagesForVisionTransport(
      requestMessages,
      buildOnscreenAgentVisionModelConfig(settings)
    )
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
