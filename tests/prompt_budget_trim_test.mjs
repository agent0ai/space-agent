import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromptLongMessagePlaceholder,
  buildPromptOverflowTrimPlan,
  estimatePromptCharsForTokenRemoval,
  trimPromptLongMessage
} from "../app/L0/_all/mod/_core/agent_prompt/prompt-items.js";
import { countTextTokens } from "../app/L0/_all/mod/_core/framework/js/token-count.js";

let llmModulePromise = null;

function buildRepeatedText(label, repeatCount) {
  return Array.from({ length: repeatCount }, (_, index) => `${label}-${index + 1}`).join(" ");
}

function createTrimCandidate(id, label, repeatCount) {
  const text = buildRepeatedText(label, repeatCount);
  const tokenCount = countTextTokens(text);

  return {
    currentText: text,
    currentValueText: text,
    id,
    key: label,
    originalText: text,
    originalValueText: text,
    originalValueTokenCount: tokenCount,
    removedChars: 0,
    tokenCount,
    trimAllowed: true,
    trimPriority: 20
  };
}

function countCandidateTokens(candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).reduce(
    (sum, candidate) => sum + (Number.isFinite(Number(candidate?.tokenCount)) ? Number(candidate.tokenCount) : 0),
    0
  );
}

function applyRuntimeTrim(candidate, removeTokens) {
  const normalizedOverflowTokens = Math.max(1, Math.ceil(Number(removeTokens) || 0));
  const currentTokenCount = Math.max(0, candidate.tokenCount);
  const targetTokenCount = Math.max(0, currentTokenCount - normalizedOverflowTokens);
  const estimatedRemovedChars = candidate.removedChars + estimatePromptCharsForTokenRemoval(
    candidate.originalValueText,
    normalizedOverflowTokens,
    {
      tokenCount: candidate.originalValueTokenCount
    }
  );
  const placeholderTokenCount = countTextTokens(
    buildPromptLongMessagePlaceholder({
      id: candidate.id,
      removedChars: estimatedRemovedChars
    })
  );
  const nextRemovedChars = candidate.removedChars + estimatePromptCharsForTokenRemoval(
    candidate.originalValueText,
    normalizedOverflowTokens + placeholderTokenCount,
    {
      tokenCount: candidate.originalValueTokenCount
    }
  );
  let trimmedValue = trimPromptLongMessage(candidate.originalValueText, {
    id: candidate.id,
    minimumVisibleChars: 72,
    removeChars: nextRemovedChars
  });
  let trimmedValueTokenCount = countTextTokens(trimmedValue.text);

  if (trimmedValueTokenCount > targetTokenCount) {
    const additionalOverflowTokens = trimmedValueTokenCount - targetTokenCount;
    const recalibratedRemovedChars = trimmedValue.removedChars + estimatePromptCharsForTokenRemoval(
      candidate.originalValueText,
      additionalOverflowTokens,
      {
        tokenCount: candidate.originalValueTokenCount
      }
    );

    trimmedValue = trimPromptLongMessage(candidate.originalValueText, {
      id: candidate.id,
      minimumVisibleChars: 72,
      removeChars: recalibratedRemovedChars
    });
    trimmedValueTokenCount = countTextTokens(trimmedValue.text);
  }

  candidate.currentValueText = trimmedValue.text;
  candidate.currentText = trimmedValue.text;
  candidate.removedChars = trimmedValue.removedChars;
  candidate.tokenCount = trimmedValueTokenCount;
  return candidate;
}

async function loadLlmModule() {
  if (!llmModulePromise) {
    globalThis.space = { extend: (_meta, fn) => fn };
    llmModulePromise = import("../app/L0/_all/mod/_core/onscreen_agent/llm.js");
  }

  return llmModulePromise;
}

test("buildPromptOverflowTrimPlan keeps contributor trims above the 250-token minimum", () => {
  const candidates = [
    createTrimCandidate(1, "alpha", 320),
    createTrimCandidate(2, "beta", 220),
    createTrimCandidate(3, "gamma", 100),
    createTrimCandidate(4, "delta", 40)
  ];
  const beforeCounts = candidates.map((candidate) => candidate.tokenCount).sort((left, right) => right - left);
  const firstGap = beforeCounts[0] - beforeCounts[1];
  const secondGap = Math.max(4, beforeCounts[1] - beforeCounts[2]);
  const overflowTokens = firstGap + Math.min(16, (secondGap * 2) - 1);
  const plan = buildPromptOverflowTrimPlan(candidates, overflowTokens, {
    minimumStepTokens: 250
  });

  assert.equal(plan.selectedCount, 1);
  assert.deepEqual(
    plan.steps.map((step) => ({
      key: step.key,
      removeTokens: step.removeTokens
    })),
    [
      {
        key: "alpha",
        removeTokens: overflowTokens
      }
    ]
  );
});

test("one-shot threshold plan trims only the qualifying outlier and leaves smaller items untouched", () => {
  const candidates = [
    createTrimCandidate(1, "alpha", 320),
    createTrimCandidate(2, "beta", 220),
    createTrimCandidate(3, "gamma", 100),
    createTrimCandidate(4, "delta", 40)
  ];
  const beforeTokens = countCandidateTokens(candidates);
  const beforeCountsByKey = Object.fromEntries(candidates.map((candidate) => [candidate.key, candidate.tokenCount]));
  const beforeCounts = candidates.map((candidate) => candidate.tokenCount).sort((left, right) => right - left);
  const firstGap = beforeCounts[0] - beforeCounts[1];
  const secondGap = Math.max(4, beforeCounts[1] - beforeCounts[2]);
  const overflowTokens = firstGap + Math.min(16, (secondGap * 2) - 1);
  const budgetTokens = beforeTokens - overflowTokens;
  const plan = buildPromptOverflowTrimPlan(candidates, overflowTokens, {
    minimumStepTokens: 250
  });
  const target = candidates[0];

  applyRuntimeTrim(target, plan.steps[0].removeTokens);
  const afterCountsByKey = {
    alpha: target.tokenCount,
    beta: candidates[1].tokenCount,
    gamma: candidates[2].tokenCount,
    delta: candidates[3].tokenCount
  };
  const afterTokens =
    afterCountsByKey.alpha + afterCountsByKey.beta + afterCountsByKey.gamma + afterCountsByKey.delta;

  assert.equal(plan.steps.length, 1);
  assert.equal(afterCountsByKey.alpha < beforeCountsByKey.alpha, true);
  assert.equal(afterCountsByKey.beta, beforeCountsByKey.beta);
  assert.equal(afterCountsByKey.gamma, beforeCountsByKey.gamma);
  assert.equal(afterCountsByKey.delta, beforeCountsByKey.delta);
  assert.equal(afterTokens < beforeTokens, true);
  assert.equal(afterTokens <= budgetTokens, true);
});

test("system part falls back to section-body compression when no contributor can meet the trim minimum", async () => {
  const { planOnscreenAgentPromptPartTrim } = await loadLlmModule();
  const contributors = [
    createTrimCandidate(1, "one", 70),
    createTrimCandidate(2, "two", 65),
    createTrimCandidate(3, "three", 60)
  ];
  const totalTokens = countCandidateTokens(contributors);
  const plan = planOnscreenAgentPromptPartTrim({
    budgetTokens: totalTokens - 120,
    contributors,
    countTokens(entries = []) {
      return countCandidateTokens(entries);
    },
    part: "system"
  });

  assert.equal(plan.mode, "section");
  assert.equal(typeof plan.sectionContributor?.originalValueText, "string");
  assert.match(plan.sectionContributor.originalValueText, /\n\n/u);
  assert.equal(plan.sectionContributor.tokenCount > 0, true);
});

test("buildPromptLongMessagePlaceholder pads removedChars to a fixed byte width across orders of magnitude", () => {
  // Prefix prompt-cache backends (llama.cpp `--prompt-cache`, qwen serve,
  // vLLM prefix cache, etc.) key cache hits on a byte-stable prompt prefix.
  // The placeholder appears inside every trimmed message and changes every
  // turn as the trimmer recalculates how many characters to drop. Without
  // padding, the counter `<<N characters removed ...>>` changes byte length
  // each turn (3 -> 4 digits when N crosses 1000), shifting every byte after
  // the placeholder and forcing a full prompt re-prefill instead of a warm-
  // cache continuation. Lock the placeholder length to be byte-stable
  // regardless of the counter's magnitude so the cache prefix stays valid
  // across turns.
  const placeholderSmall = buildPromptLongMessagePlaceholder({ id: 1, removedChars: 9 });
  const placeholderMedium = buildPromptLongMessagePlaceholder({ id: 1, removedChars: 4096 });
  const placeholderLarge = buildPromptLongMessagePlaceholder({ id: 1, removedChars: 500_000 });
  const placeholderHuge = buildPromptLongMessagePlaceholder({ id: 1, removedChars: 1_000_000_000 });

  assert.equal(placeholderSmall.length, placeholderMedium.length);
  assert.equal(placeholderSmall.length, placeholderLarge.length);
  assert.equal(placeholderSmall.length, placeholderHuge.length);
});

test("buildPromptLongMessagePlaceholder keeps the counter readable as a decimal number with leading zeros", () => {
  const placeholder = buildPromptLongMessagePlaceholder({ id: 7, removedChars: 42 });

  // The counter should still be parseable as a positive integer after the
  // leading-zero pad so anything that inspects it (logs, debug overlays,
  // future tooling) does not need to special-case the format.
  const match = placeholder.match(/<<(\d+) characters removed/u);

  assert.ok(match, "placeholder should start with `<<<digits> characters removed`");
  assert.equal(Number(match[1]), 42);
});
