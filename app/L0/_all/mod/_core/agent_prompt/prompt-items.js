import { countTextTokens } from "/mod/_core/framework/js/token-count.js";

export const DEFAULT_PROMPT_BUDGET_RATIOS = Object.freeze({
  history: 40,
  singleMessage: 10,
  system: 30,
  transient: 30
});
export const PROMPT_BUDGET_PART_KEYS = Object.freeze(["system", "history", "transient"]);

const LONG_MESSAGE_DEFAULT_TO = 10000;

function clampPromptBudgetNumber(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function normalizePromptBudgetNumber(value, fallback, label) {
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    return fallback;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 100) {
    throw new Error(`${label} must be a number between 0 and 100.`);
  }

  return parsedValue;
}

export function parsePromptBudgetRatios(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ratios = {
    history: normalizePromptBudgetNumber(
      source.history,
      DEFAULT_PROMPT_BUDGET_RATIOS.history,
      "History max ratio"
    ),
    singleMessage: normalizePromptBudgetNumber(
      source.singleMessage,
      DEFAULT_PROMPT_BUDGET_RATIOS.singleMessage,
      "Single message max ratio"
    ),
    system: normalizePromptBudgetNumber(
      source.system,
      DEFAULT_PROMPT_BUDGET_RATIOS.system,
      "System prompt max ratio"
    ),
    transient: normalizePromptBudgetNumber(
      source.transient,
      DEFAULT_PROMPT_BUDGET_RATIOS.transient,
      "Transient prompt max ratio"
    )
  };
  const totalRatio = ratios.system + ratios.history + ratios.transient;

  if (Math.abs(totalRatio - 100) > 0.001) {
    throw new Error("System, history, and transient ratios must total 100.");
  }

  return ratios;
}

export function normalizePromptBudgetRatios(value = {}) {
  try {
    return parsePromptBudgetRatios(value);
  } catch {
    return { ...DEFAULT_PROMPT_BUDGET_RATIOS };
  }
}

function roundPromptBudgetValues(valuesByKey = {}, total = 100) {
  const entries = Object.entries(valuesByKey).map(([key, value]) => {
    const normalizedValue = Math.max(0, Number(value) || 0);
    const floorValue = Math.floor(normalizedValue);

    return {
      floorValue,
      key,
      remainder: normalizedValue - floorValue
    };
  });
  const roundedValues = Object.fromEntries(entries.map((entry) => [entry.key, entry.floorValue]));
  const currentTotal = entries.reduce((sum, entry) => sum + entry.floorValue, 0);
  let remaining = Math.max(0, Math.round(total) - currentTotal);

  entries
    .slice()
    .sort((left, right) => {
      const remainderCompare = right.remainder - left.remainder;

      if (remainderCompare !== 0) {
        return remainderCompare;
      }

      return left.key.localeCompare(right.key);
    })
    .forEach((entry) => {
      if (remaining <= 0) {
        return;
      }

      roundedValues[entry.key] += 1;
      remaining -= 1;
    });

  return roundedValues;
}

export function rebalancePromptBudgetRatios(value = {}, changedKey, nextValue) {
  const normalizedRatios = normalizePromptBudgetRatios(value);
  const normalizedChangedKey = String(changedKey || "").trim();

  if (!PROMPT_BUDGET_PART_KEYS.includes(normalizedChangedKey)) {
    return {
      ...normalizedRatios
    };
  }

  const targetValue = Math.round(clampPromptBudgetNumber(Number(nextValue)));
  const remainingKeys = PROMPT_BUDGET_PART_KEYS.filter((key) => key !== normalizedChangedKey);
  const remainingTotal = Math.max(0, 100 - targetValue);
  const previousRemainingTotal = remainingKeys.reduce((sum, key) => sum + normalizedRatios[key], 0);
  let redistributedValues = {};

  if (previousRemainingTotal <= 0) {
    redistributedValues = roundPromptBudgetValues(
      Object.fromEntries(
        remainingKeys.map((key) => [key, remainingTotal / Math.max(1, remainingKeys.length)])
      ),
      remainingTotal
    );
  } else {
    redistributedValues = roundPromptBudgetValues(
      Object.fromEntries(
        remainingKeys.map((key) => [
          key,
          (remainingTotal * normalizedRatios[key]) / previousRemainingTotal
        ])
      ),
      remainingTotal
    );
  }

  return {
    ...normalizedRatios,
    ...redistributedValues,
    [normalizedChangedKey]: targetValue
  };
}

export function stringifyPromptItemValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyPromptItemValue(entry))
      .filter((entry) => String(entry ?? "").trim())
      .join("\n\n");
  }

  if (value == null) {
    return "";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function normalizePromptItemKey(key, fallbackKey = "") {
  return String(key || fallbackKey || "").trim();
}

export function normalizePromptItemDefinition(key, input, options = {}) {
  const normalizedKey = normalizePromptItemKey(key, options.fallbackKey);

  if (!normalizedKey) {
    return null;
  }

  if (input && typeof input === "object" && !Array.isArray(input) && Object.hasOwn(input, "value")) {
    const { order, value, valueTokenCount, ...metadata } = input;
    const normalizedValue = stringifyPromptItemValue(value);

    if (!normalizedValue.trim()) {
      return null;
    }

    return {
      ...metadata,
      key: normalizedKey,
      order: Number.isFinite(order) ? Number(order) : 0,
      valueTokenCount: Number.isFinite(Number(valueTokenCount))
        ? Math.max(0, Math.floor(Number(valueTokenCount)))
        : countTextTokens(normalizedValue),
      value: normalizedValue
    };
  }

  const normalizedValue = stringifyPromptItemValue(input);

  if (!normalizedValue.trim()) {
    return null;
  }

  return {
    key: normalizedKey,
    order: 0,
    valueTokenCount: countTextTokens(normalizedValue),
    value: normalizedValue
  };
}

export function normalizePromptItemMap(input, options = {}) {
  const keyPrefix = typeof options.keyPrefix === "string" && options.keyPrefix.trim()
    ? options.keyPrefix.trim()
    : "item";
  const normalizedItems = Object.create(null);

  if (Array.isArray(input)) {
    input.forEach((entry, index) => {
      const normalizedEntry = typeof options.fromArray === "function"
        ? options.fromArray(entry, index)
        : normalizePromptItemDefinition(`${keyPrefix}:${index + 1}`, entry);

      if (!normalizedEntry) {
        return;
      }

      normalizedItems[normalizedEntry.key] = {
        ...normalizedEntry
      };
    });

    return normalizedItems;
  }

  if (!input || typeof input !== "object") {
    return normalizedItems;
  }

  Object.entries(input).forEach(([key, entry]) => {
    const normalizedEntry = normalizePromptItemDefinition(key, entry);

    if (!normalizedEntry) {
      return;
    }

    normalizedItems[normalizedEntry.key] = {
      ...normalizedEntry
    };
  });

  return normalizedItems;
}

export function mergePromptItemMaps(...inputs) {
  return inputs.reduce((mergedItems, input) => {
    const normalizedItems = normalizePromptItemMap(input);

    Object.values(normalizedItems).forEach((item) => {
      mergedItems[item.key] = {
        ...item
      };
    });

    return mergedItems;
  }, Object.create(null));
}

export function listPromptItems(input) {
  return Object.values(normalizePromptItemMap(input)).sort((left, right) => {
    const orderCompare = left.order - right.order;

    if (orderCompare !== 0) {
      return orderCompare;
    }

    return left.key.localeCompare(right.key);
  });
}

export function setPromptItem(items, key, value) {
  const mergedItems = mergePromptItemMaps(items);
  const normalizedItem = normalizePromptItemDefinition(key, value);

  if (!normalizedItem) {
    delete mergedItems[String(key || "").trim()];
    return mergedItems;
  }

  mergedItems[normalizedItem.key] = {
    ...normalizedItem
  };
  return mergedItems;
}

export function deletePromptItem(items, key) {
  const mergedItems = mergePromptItemMaps(items);
  const normalizedKey = String(key || "").trim();

  if (!normalizedKey) {
    return mergedItems;
  }

  delete mergedItems[normalizedKey];
  return mergedItems;
}

export function comparePromptTrimCandidates(left, right) {
  const leftTokenCount = Number.isFinite(Number(left?.tokenCount)) ? Math.max(0, Math.floor(Number(left.tokenCount))) : 0;
  const rightTokenCount = Number.isFinite(Number(right?.tokenCount))
    ? Math.max(0, Math.floor(Number(right.tokenCount)))
    : 0;
  const tokenCompare = rightTokenCount - leftTokenCount;

  if (tokenCompare !== 0) {
    return tokenCompare;
  }

  const leftPriority = Number.isFinite(Number(left?.trimPriority)) ? Number(left.trimPriority) : 0;
  const rightPriority = Number.isFinite(Number(right?.trimPriority)) ? Number(right.trimPriority) : 0;
  const priorityCompare = rightPriority - leftPriority;

  if (priorityCompare !== 0) {
    return priorityCompare;
  }

  const leftId = Number.isFinite(Number(left?.id)) ? Number(left.id) : 0;
  const rightId = Number.isFinite(Number(right?.id)) ? Number(right.id) : 0;

  if (leftId !== rightId) {
    return leftId - rightId;
  }

  const leftKey = typeof left?.key === "string" ? left.key : "";
  const rightKey = typeof right?.key === "string" ? right.key : "";
  return leftKey.localeCompare(rightKey);
}

export function estimatePromptCharsForTokenRemoval(text = "", removeTokens, options = {}) {
  const normalizedText = typeof text === "string" ? text : String(text ?? "");

  if (!normalizedText.length) {
    return 0;
  }

  const normalizedRemoveTokens = Number.isFinite(Number(removeTokens))
    ? Math.max(0, Math.ceil(Number(removeTokens)))
    : 0;

  if (!normalizedRemoveTokens) {
    return 0;
  }

  const tokenCount = Number.isFinite(Number(options.tokenCount))
    ? Math.max(1, Math.floor(Number(options.tokenCount)))
    : Math.max(1, countTextTokens(normalizedText));

  return Math.max(1, Math.ceil((normalizedText.length / tokenCount) * normalizedRemoveTokens));
}

function buildPromptOverflowTrimPlanCore(candidates = [], overflowTokens) {
  const normalizedOverflowTokens = Number.isFinite(Number(overflowTokens))
    ? Math.max(0, Math.ceil(Number(overflowTokens)))
    : 0;

  if (!normalizedOverflowTokens || !Array.isArray(candidates) || !candidates.length) {
    return {
      candidateCount: Array.isArray(candidates) ? candidates.length : 0,
      overflowTokens: normalizedOverflowTokens,
      plannedRemovalTokens: 0,
      selectedCount: 0,
      steps: [],
      targetTokenCeiling: 0
    };
  }

  const plannedRemovals = new Array(candidates.length).fill(0);
  let activeCount = 1;
  let currentLevel = candidates[0].tokenCount;
  let remainingOverflowTokens = normalizedOverflowTokens;

  for (let index = 1; index < candidates.length && remainingOverflowTokens > 0; index += 1) {
    const nextLevel = candidates[index].tokenCount;
    const bandDrop = Math.max(0, currentLevel - nextLevel);

    if (bandDrop > 0) {
      const bandCapacity = bandDrop * activeCount;

      if (bandCapacity >= remainingOverflowTokens) {
        break;
      }

      for (let activeIndex = 0; activeIndex < activeCount; activeIndex += 1) {
        plannedRemovals[activeIndex] += bandDrop;
      }

      remainingOverflowTokens -= bandCapacity;
      currentLevel = nextLevel;
    }

    activeCount += 1;
  }

  let targetTokenCeiling = Math.max(0, currentLevel);

  if (remainingOverflowTokens > 0 && activeCount > 0) {
    const fullDrop = Math.floor(remainingOverflowTokens / activeCount);
    const extraDropCount = remainingOverflowTokens % activeCount;

    if (fullDrop > 0) {
      for (let activeIndex = 0; activeIndex < activeCount; activeIndex += 1) {
        plannedRemovals[activeIndex] += fullDrop;
      }

      targetTokenCeiling = Math.max(0, currentLevel - fullDrop);
    }

    for (let activeIndex = 0; activeIndex < extraDropCount; activeIndex += 1) {
      plannedRemovals[activeIndex] += 1;
    }

    if (extraDropCount > 0) {
      targetTokenCeiling = Math.max(0, targetTokenCeiling - 1);
    }
  }

  const steps = candidates
    .map((candidate, index) => {
      const removeTokens = Math.max(0, plannedRemovals[index]);

      if (!removeTokens) {
        return null;
      }

      return {
        beforeTokens: candidate.tokenCount,
        contributor: candidate.contributor,
        id: candidate.id,
        key: candidate.key,
        removeTokens,
        targetTokens: Math.max(0, candidate.tokenCount - removeTokens),
        trimPriority: candidate.trimPriority
      };
    })
    .filter(Boolean);
  const plannedRemovalTokens = steps.reduce((sum, step) => sum + step.removeTokens, 0);

  return {
    candidateCount: candidates.length,
    overflowTokens: normalizedOverflowTokens,
    plannedRemovalTokens,
    selectedCount: candidates.length,
    steps,
    targetTokenCeiling
  };
}

export function buildPromptOverflowTrimPlan(contributors = [], overflowTokens, options = {}) {
  const normalizedOverflowTokens = Number.isFinite(Number(overflowTokens))
    ? Math.max(0, Math.ceil(Number(overflowTokens)))
    : 0;
  const minimumStepTokens = Number.isFinite(Number(options.minimumStepTokens))
    ? Math.max(0, Math.ceil(Number(options.minimumStepTokens)))
    : 0;
  const candidates = (Array.isArray(contributors) ? contributors : [])
    .filter((contributor) => contributor?.trimAllowed !== false)
    .map((contributor, index) => ({
      contributor,
      id: Number.isFinite(Number(contributor?.id)) ? Number(contributor.id) : 0,
      index,
      key: typeof contributor?.key === "string" ? contributor.key : "",
      tokenCount: Number.isFinite(Number(contributor?.tokenCount))
        ? Math.max(0, Math.floor(Number(contributor.tokenCount)))
        : 0,
      trimPriority: Number.isFinite(Number(contributor?.trimPriority)) ? Number(contributor.trimPriority) : 0
    }))
    .filter((candidate) => candidate.tokenCount > 0)
    .sort(comparePromptTrimCandidates);

  if (!normalizedOverflowTokens || !candidates.length) {
    return {
      candidateCount: candidates.length,
      minimumStepTokens,
      overflowTokens: normalizedOverflowTokens,
      plannedRemovalTokens: 0,
      selectedCount: 0,
      targetTokenCeiling: 0,
      steps: []
    };
  }

  for (let selectedCount = candidates.length; selectedCount >= 1; selectedCount -= 1) {
    const selectedCandidates = candidates.slice(0, selectedCount);
    const plan = buildPromptOverflowTrimPlanCore(selectedCandidates, normalizedOverflowTokens);

    if (
      !minimumStepTokens ||
      (plan.steps.length && plan.steps.every((step) => step.removeTokens >= minimumStepTokens))
    ) {
      return {
        ...plan,
        candidateCount: candidates.length,
        minimumStepTokens
      };
    }
  }

  return {
    candidateCount: candidates.length,
    minimumStepTokens,
    overflowTokens: normalizedOverflowTokens,
    plannedRemovalTokens: 0,
    selectedCount: 0,
    targetTokenCeiling: 0,
    steps: []
  };
}

// Pad the removed-chars counter to a fixed width so the placeholder string has
// a byte-stable length regardless of how many characters were trimmed. Each
// time the trimmer runs the counter changes (because chars-needed drifts with
// content and token budget), and without padding that changes the byte offset
// of every token after the placeholder. For backends with prefix prompt-cache
// reuse (llama.cpp `--prompt-cache`, qwen serve, vLLM prefix cache, etc.) the
// drifting placeholder forces a full prompt re-prefill on every turn instead
// of a warm-cache continuation — turning a 10s warm reply into multi-minute
// full PP for long-context sessions. 10 digits cover up to ~10 billion
// characters which is far above any realistic message length.
const LONG_MESSAGE_REMOVED_CHARS_PAD_WIDTH = 10;

export function buildPromptLongMessagePlaceholder({ id, removedChars } = {}) {
  const normalizedId = Number.isFinite(Number(id)) ? Math.max(1, Math.round(Number(id))) : 0;
  const normalizedRemovedChars = Number.isFinite(Number(removedChars))
    ? Math.max(0, Math.round(Number(removedChars)))
    : 0;

  if (!normalizedId || !normalizedRemovedChars) {
    return "";
  }

  const paddedRemovedChars = String(normalizedRemovedChars).padStart(
    LONG_MESSAGE_REMOVED_CHARS_PAD_WIDTH,
    "0"
  );

  return `<<${paddedRemovedChars} characters removed to optimize context, read with space.chat.readLongMessage({id: ${normalizedId}, from: 0, to:${LONG_MESSAGE_DEFAULT_TO}})>>`;
}

export function trimPromptLongMessage(text, options = {}) {
  const normalizedText = typeof text === "string" ? text : String(text ?? "");

  if (!normalizedText.length) {
    return {
      placeholder: "",
      removedChars: 0,
      text: normalizedText
    };
  }

  const requestedRemovedChars = Number.isFinite(Number(options.removeChars))
    ? Math.max(0, Math.round(Number(options.removeChars)))
    : 0;

  if (!requestedRemovedChars) {
    return {
      placeholder: "",
      removedChars: 0,
      text: normalizedText
    };
  }

  const minimumVisibleChars = Number.isFinite(Number(options.minimumVisibleChars))
    ? Math.max(0, Math.round(Number(options.minimumVisibleChars)))
    : 48;
  const maximumRemovedChars = Math.max(0, normalizedText.length - minimumVisibleChars);
  const removedChars = Math.min(requestedRemovedChars, maximumRemovedChars);

  if (!removedChars) {
    return {
      placeholder: "",
      removedChars: 0,
      text: normalizedText
    };
  }

  const placeholder = buildPromptLongMessagePlaceholder({
    id: options.id,
    removedChars
  });
  const visibleChars = Math.max(0, normalizedText.length - removedChars);
  let prefixChars = Math.floor(visibleChars / 2);
  let suffixChars = visibleChars - prefixChars;
  const minimumEdgeChars = Math.min(24, Math.floor(normalizedText.length / 2));

  if (visibleChars >= minimumEdgeChars * 2) {
    prefixChars = Math.max(prefixChars, minimumEdgeChars);
    suffixChars = Math.max(suffixChars, minimumEdgeChars);
    const totalVisibleChars = prefixChars + suffixChars;

    if (totalVisibleChars > visibleChars) {
      const overflowChars = totalVisibleChars - visibleChars;
      const suffixOverflow = Math.min(overflowChars, suffixChars - minimumEdgeChars);
      suffixChars -= suffixOverflow;
      prefixChars -= overflowChars - suffixOverflow;
    }
  }

  return {
    placeholder,
    removedChars,
    text: `${normalizedText.slice(0, prefixChars)}${placeholder}${normalizedText.slice(normalizedText.length - suffixChars)}`
  };
}

function clonePromptAccessEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const { fullText, ...metadata } = entry;
  return {
    ...metadata
  };
}

export function installPromptItemAccess(target = {}) {
  const chatRuntime = target && typeof target === "object" ? target : {};
  const itemsById = new Map();

  function syncPromptItems(entries = []) {
    itemsById.clear();
    chatRuntime.promptItems = (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const id = Number.isFinite(Number(entry.id)) ? Math.max(1, Math.round(Number(entry.id))) : 0;

        if (!id) {
          return null;
        }

        const promptItemEntry = {
          ...entry,
          content: typeof entry.content === "string" ? entry.content : "",
          fullText:
            typeof entry.fullText === "string"
              ? entry.fullText
              : typeof entry.content === "string"
                ? entry.content
                : "",
          id
        };

        itemsById.set(id, promptItemEntry);
        return clonePromptAccessEntry(promptItemEntry);
      })
      .filter(Boolean);

    return chatRuntime.promptItems;
  }

  function readLongMessage(input = {}) {
    const options =
      input && typeof input === "object" && !Array.isArray(input)
        ? input
        : { id: input };
    const id = Number.isFinite(Number(options.id)) ? Math.max(1, Math.round(Number(options.id))) : 0;

    if (!id) {
      throw new Error("readLongMessage requires a numeric prompt item id.");
    }

    const entry = itemsById.get(id);

    if (!entry) {
      throw new Error(`Prompt item ${id} is not available in the current chat context.`);
    }

    const fullText = typeof entry.fullText === "string" ? entry.fullText : "";
    const from = Number.isFinite(Number(options.from)) ? Math.max(0, Math.floor(Number(options.from))) : 0;
    const to = Number.isFinite(Number(options.to))
      ? Math.max(from, Math.floor(Number(options.to)))
      : LONG_MESSAGE_DEFAULT_TO;

    return fullText.slice(from, to);
  }

  chatRuntime.__setPromptItems = syncPromptItems;
  chatRuntime.readLongMessage = readLongMessage;

  if (!Array.isArray(chatRuntime.promptItems)) {
    chatRuntime.promptItems = [];
  }

  syncPromptItems(chatRuntime.promptItems);

  return chatRuntime;
}
