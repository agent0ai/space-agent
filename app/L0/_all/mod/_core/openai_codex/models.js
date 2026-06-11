export const CODEX_DEFAULT_MODEL_ID = "gpt-5.4-mini";

export const CODEX_MODEL_CATALOG = Object.freeze([
  {
    description: "Cheapest and fastest. Recommended default for ChatGPT Plus.",
    id: "gpt-5.4-mini"
  },
  {
    description: "Flagship general-purpose model.",
    id: "gpt-5.4"
  },
  {
    description: "Code-optimized, latest codex variant.",
    id: "gpt-5.3-codex"
  },
  {
    description: "Code-optimized, previous generation.",
    id: "gpt-5.2-codex"
  },
  {
    description: "Maximum code-optimized performance.",
    id: "gpt-5.1-codex-max"
  },
  {
    description: "Smallest code-optimized variant.",
    id: "gpt-5.1-codex-mini"
  }
]);

export function normalizeCodexModelId(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return CODEX_DEFAULT_MODEL_ID;
  }

  return normalized;
}

export function isKnownCodexModelId(value) {
  const normalized = String(value || "").trim();

  return CODEX_MODEL_CATALOG.some((entry) => entry.id === normalized);
}
