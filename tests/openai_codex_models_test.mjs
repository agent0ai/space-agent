import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_DEFAULT_MODEL_ID,
  CODEX_MODEL_CATALOG,
  isKnownCodexModelId,
  normalizeCodexModelId
} from "../app/L0/_all/mod/_core/openai_codex/models.js";

test("CODEX_MODEL_CATALOG exposes the documented 6 entries", () => {
  assert.equal(CODEX_MODEL_CATALOG.length, 6);
  for (const entry of CODEX_MODEL_CATALOG) {
    assert.ok(typeof entry.id === "string" && entry.id.startsWith("gpt-"));
    assert.ok(typeof entry.description === "string" && entry.description.length > 0);
  }
});

test("CODEX_DEFAULT_MODEL_ID appears in the catalog", () => {
  assert.ok(isKnownCodexModelId(CODEX_DEFAULT_MODEL_ID));
});

test("normalizeCodexModelId falls back to the default for empty input", () => {
  assert.equal(normalizeCodexModelId(""), CODEX_DEFAULT_MODEL_ID);
  assert.equal(normalizeCodexModelId(null), CODEX_DEFAULT_MODEL_ID);
  assert.equal(normalizeCodexModelId(undefined), CODEX_DEFAULT_MODEL_ID);
  assert.equal(normalizeCodexModelId("   "), CODEX_DEFAULT_MODEL_ID);
});

test("normalizeCodexModelId preserves any trimmed non-empty string", () => {
  assert.equal(normalizeCodexModelId("  gpt-5.4 "), "gpt-5.4");
  assert.equal(normalizeCodexModelId("future-model"), "future-model");
});

test("isKnownCodexModelId returns true only for catalog entries", () => {
  assert.equal(isKnownCodexModelId("gpt-5.4"), true);
  assert.equal(isKnownCodexModelId("gpt-5.4-mini"), true);
  assert.equal(isKnownCodexModelId("gpt-5.3-codex"), true);
  assert.equal(isKnownCodexModelId("gpt-does-not-exist"), false);
  assert.equal(isKnownCodexModelId(""), false);
});

test("CODEX_MODEL_CATALOG is frozen and cannot be mutated", () => {
  assert.throws(() => {
    CODEX_MODEL_CATALOG.push({ description: "x", id: "x" });
  }, TypeError);
});
