import assert from "node:assert/strict";
import test from "node:test";

import { parseCodexModelsResponse } from "../app/L0/_all/mod/_core/openai_codex/models_parser.js";

test("parseCodexModelsResponse returns sorted id+description pairs", () => {
  const result = parseCodexModelsResponse({
    models: [
      {
        description: "Flagship.",
        display_name: "GPT 5.4",
        priority: 20,
        slug: "gpt-5.4",
        supported_in_api: true,
        visibility: "public"
      },
      {
        description: "Cheap and fast.",
        display_name: "GPT 5.4 Mini",
        priority: 10,
        slug: "gpt-5.4-mini",
        supported_in_api: true,
        visibility: "public"
      }
    ]
  });

  assert.deepEqual(result, [
    { description: "Cheap and fast.", id: "gpt-5.4-mini" },
    { description: "Flagship.", id: "gpt-5.4" }
  ]);
});

test("parseCodexModelsResponse filters out hidden visibilities case-insensitively", () => {
  const result = parseCodexModelsResponse({
    models: [
      { slug: "a", visibility: "public", priority: 1 },
      { slug: "b", visibility: "hide", priority: 2 },
      { slug: "c", visibility: "HIDDEN", priority: 3 },
      { slug: "d", visibility: "Hide", priority: 4 },
      { slug: "e", visibility: "", priority: 5 }
    ]
  });

  assert.deepEqual(
    result.map((entry) => entry.id),
    ["a", "e"]
  );
});

test("parseCodexModelsResponse filters out supported_in_api false", () => {
  const result = parseCodexModelsResponse({
    models: [
      { slug: "keep", supported_in_api: true, priority: 1 },
      { slug: "drop", supported_in_api: false, priority: 2 },
      { slug: "missing-flag", priority: 3 }
    ]
  });

  assert.deepEqual(
    result.map((entry) => entry.id),
    ["keep", "missing-flag"]
  );
});

test("parseCodexModelsResponse sorts by priority then slug", () => {
  const result = parseCodexModelsResponse({
    models: [
      { slug: "zzz", priority: 10 },
      { slug: "aaa", priority: 10 },
      { slug: "bbb", priority: 5 },
      { slug: "ccc" }
    ]
  });

  assert.deepEqual(
    result.map((entry) => entry.id),
    ["bbb", "aaa", "zzz", "ccc"]
  );
});

test("parseCodexModelsResponse skips entries without a slug", () => {
  const result = parseCodexModelsResponse({
    models: [
      { priority: 1 },
      { slug: "", priority: 2 },
      { slug: "   ", priority: 3 },
      { slug: "ok", priority: 4 }
    ]
  });

  assert.deepEqual(
    result.map((entry) => entry.id),
    ["ok"]
  );
});

test("parseCodexModelsResponse falls back to display_name for description", () => {
  const result = parseCodexModelsResponse({
    models: [
      { slug: "a", display_name: "Alpha model", priority: 1 },
      { slug: "b", description: "  Beta  ", display_name: "unused", priority: 2 }
    ]
  });

  assert.equal(result[0].description, "Alpha model");
  assert.equal(result[1].description, "Beta");
});

test("parseCodexModelsResponse tolerates malformed payloads", () => {
  assert.deepEqual(parseCodexModelsResponse(null), []);
  assert.deepEqual(parseCodexModelsResponse(undefined), []);
  assert.deepEqual(parseCodexModelsResponse({}), []);
  assert.deepEqual(parseCodexModelsResponse({ models: null }), []);
  assert.deepEqual(parseCodexModelsResponse({ models: "not-an-array" }), []);
  assert.deepEqual(
    parseCodexModelsResponse({ models: [null, 42, "string", { not: "a slug" }] }),
    []
  );
});
