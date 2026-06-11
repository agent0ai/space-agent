import assert from "node:assert/strict";
import test from "node:test";

import {
  LONG_MESSAGE_CUT_QUANTUM_CHARS,
  quantizeRemovedChars
} from "../app/L0/_all/mod/_core/agent_prompt/trim-quantum.js";

test("quantizeRemovedChars returns 0 unchanged so the no-trim state stays representable", () => {
  assert.equal(quantizeRemovedChars(0), 0);
  assert.equal(quantizeRemovedChars(-5), 0);
  assert.equal(quantizeRemovedChars(NaN), 0);
  assert.equal(quantizeRemovedChars(undefined), 0);
});

test("quantizeRemovedChars rounds any positive value up to the next quantum step", () => {
  assert.equal(quantizeRemovedChars(1), LONG_MESSAGE_CUT_QUANTUM_CHARS);
  assert.equal(quantizeRemovedChars(LONG_MESSAGE_CUT_QUANTUM_CHARS - 1), LONG_MESSAGE_CUT_QUANTUM_CHARS);
  assert.equal(quantizeRemovedChars(LONG_MESSAGE_CUT_QUANTUM_CHARS), LONG_MESSAGE_CUT_QUANTUM_CHARS);
  assert.equal(quantizeRemovedChars(LONG_MESSAGE_CUT_QUANTUM_CHARS + 1), 2 * LONG_MESSAGE_CUT_QUANTUM_CHARS);
});

test("quantizeRemovedChars holds the cut position stable across small per-turn drift", () => {
  // The onscreen trimmer plans `removeChars` from the live overflow budget,
  // which drifts by tens of characters as the conversation history grows.
  // The whole point of quantization is that those small drifts are absorbed
  // and the cut position remains byte-identical across turns. This guards
  // against a future refactor that accidentally narrows the quantum below
  // realistic per-turn drift.
  const baseline = 12_649; // empirically observed cut from a real Talk session
  const driftedSamples = [12_649, 12_661, 12_673, 12_685, 12_700];

  const quantized = driftedSamples.map((value) => quantizeRemovedChars(value));
  const reference = quantizeRemovedChars(baseline);

  for (const value of quantized) {
    assert.equal(value, reference);
  }
});

test("quantizeRemovedChars steps to the next quantum only when drift exceeds a full step", () => {
  const baseline = LONG_MESSAGE_CUT_QUANTUM_CHARS + 1;
  const oneStepLater = baseline + LONG_MESSAGE_CUT_QUANTUM_CHARS;

  assert.equal(quantizeRemovedChars(baseline), 2 * LONG_MESSAGE_CUT_QUANTUM_CHARS);
  assert.equal(quantizeRemovedChars(oneStepLater), 3 * LONG_MESSAGE_CUT_QUANTUM_CHARS);
});

test("quantizeRemovedChars accepts a custom quantum so future tuning can compare grid sizes", () => {
  assert.equal(quantizeRemovedChars(1, 1024), 1024);
  assert.equal(quantizeRemovedChars(1025, 1024), 2048);
  assert.equal(quantizeRemovedChars(1, 16_384), 16_384);
});

test("quantizeRemovedChars falls back to the default quantum when given a non-positive override", () => {
  assert.equal(quantizeRemovedChars(1, 0), LONG_MESSAGE_CUT_QUANTUM_CHARS);
  assert.equal(quantizeRemovedChars(1, -10), LONG_MESSAGE_CUT_QUANTUM_CHARS);
  assert.equal(quantizeRemovedChars(1, NaN), LONG_MESSAGE_CUT_QUANTUM_CHARS);
});
