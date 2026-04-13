import * as skills from "/mod/_core/admin/views/agent/skills.js";

export const DEFAULT_ADMIN_SYSTEM_PROMPT_PATH = "/mod/_core/admin/views/agent/system-prompt.md";
export const ADMIN_HISTORY_COMPACT_MODE = Object.freeze({
  AUTOMATIC: "automatic",
  USER: "user"
});
export const ADMIN_HISTORY_COMPACT_PROMPT_PATH = "/mod/_core/admin/views/agent/compact-prompt.md";
export const ADMIN_HISTORY_AUTO_COMPACT_PROMPT_PATH = "/mod/_core/admin/views/agent/compact-prompt-auto.md";
export const LOCAL_ADMIN_SYSTEM_PROMPT = [
  "You are the Space Agent Admin assistant running in the browser admin UI.",
  "Be concise, practical, and task-focused.",
  "When runtime action is needed, reply with exactly `_____javascript` on its own line, followed only by JavaScript until the end of the message.",
  "Use top-level await directly.",
  "Available runtime tools include `space.api`, `space.chat`, `fetch`, `window`, `document`, and `localStorage`.",
  "After execution results return, continue the task. Do not claim you lack browser, file, or live-data access."
].join("\n");

let defaultSystemPromptPromise = null;
const compactPromptPromises = {
  [ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC]: null,
  [ADMIN_HISTORY_COMPACT_MODE.USER]: null
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

async function loadDefaultSystemPrompt() {
  return loadPromptFile(DEFAULT_ADMIN_SYSTEM_PROMPT_PATH, "default admin system prompt");
}

function normalizeHistoryCompactMode(mode = ADMIN_HISTORY_COMPACT_MODE.USER) {
  return mode === ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC
    ? ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC
    : ADMIN_HISTORY_COMPACT_MODE.USER;
}

function resolveHistoryCompactPromptConfig(mode) {
  if (mode === ADMIN_HISTORY_COMPACT_MODE.AUTOMATIC) {
    return {
      label: "admin automatic history compact prompt",
      path: ADMIN_HISTORY_AUTO_COMPACT_PROMPT_PATH
    };
  }

  return {
    label: "admin history compact prompt",
    path: ADMIN_HISTORY_COMPACT_PROMPT_PATH
  };
}

async function loadCompactPrompt(mode) {
  const promptConfig = resolveHistoryCompactPromptConfig(mode);
  return loadPromptFile(promptConfig.path, promptConfig.label);
}

export async function fetchDefaultAdminSystemPrompt(options = {}) {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && defaultSystemPromptPromise) {
    return defaultSystemPromptPromise;
  }

  defaultSystemPromptPromise = loadDefaultSystemPrompt().catch((error) => {
    defaultSystemPromptPromise = null;
    throw error;
  });

  return defaultSystemPromptPromise;
}

export async function fetchAdminHistoryCompactPrompt(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const mode = normalizeHistoryCompactMode(options.mode);

  if (!forceRefresh && compactPromptPromises[mode]) {
    return compactPromptPromises[mode];
  }

  compactPromptPromises[mode] = loadCompactPrompt(mode).catch((error) => {
    compactPromptPromises[mode] = null;
    throw error;
  });

  return compactPromptPromises[mode];
}

export function extractCustomAdminSystemPrompt(storedPrompt = "", defaultSystemPrompt = "") {
  return stripDefaultPromptPrefix(storedPrompt, defaultSystemPrompt);
}

export async function buildRuntimeAdminSystemPrompt(systemPrompt = "", options = {}) {
  if (options.localProfile === true) {
    const customPrompt = formatCustomUserInstructions(systemPrompt);
    return [LOCAL_ADMIN_SYSTEM_PROMPT, customPrompt].filter(Boolean).join("\n\n");
  }

  const basePrompt = normalizeSystemPrompt(
    options.defaultSystemPrompt || (await fetchDefaultAdminSystemPrompt())
  );
  const customPrompt = formatCustomUserInstructions(systemPrompt);
  const skillsSection = await skills.buildAdminSkillsPromptSection();
  const justLoadedSkillsSection = await skills.buildAdminJustLoadedSkillsPromptSection();

  return [basePrompt, customPrompt, skillsSection, justLoadedSkillsSection].filter(Boolean).join("\n\n");
}
