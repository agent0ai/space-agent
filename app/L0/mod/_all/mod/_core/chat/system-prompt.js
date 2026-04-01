export const DEFAULT_SYSTEM_PROMPT_PATH = "/mod/_core/chat/default-system-prompt.md";

let defaultSystemPromptPromise = null;

function normalizeSystemPrompt(systemPrompt = "") {
  return typeof systemPrompt === "string" ? systemPrompt.trim() : "";
}

async function loadDefaultSystemPrompt() {
  const response = await fetch(DEFAULT_SYSTEM_PROMPT_PATH);

  if (!response.ok) {
    throw new Error(`Unable to load the default system prompt (${response.status}).`);
  }

  const prompt = normalizeSystemPrompt(await response.text());

  if (!prompt) {
    throw new Error("The default system prompt file is empty.");
  }

  return prompt;
}

export async function fetchDefaultSystemPrompt(options = {}) {
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
