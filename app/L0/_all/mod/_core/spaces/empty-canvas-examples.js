const EMPTY_CANVAS_EXAMPLES_CONFIG_URL = "/mod/_core/spaces/empty-canvas-examples.yaml";
const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

let emptyCanvasExamplesPromise = null;

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (
    !runtime.utils ||
    typeof runtime.utils !== "object" ||
    !runtime.utils.yaml ||
    typeof runtime.utils.yaml.parse !== "function"
  ) {
    throw new Error("space.utils.yaml.parse is not available.");
  }

  return runtime;
}

function collapseWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeExampleId(value, fallbackIndex) {
  const normalizedValue = collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalizedValue || `example-${fallbackIndex + 1}`;
}

function compileExampleCode(source, label) {
  try {
    return new AsyncFunction("helpers", "example", "event", String(source || ""));
  } catch (error) {
    throw new Error(`Invalid empty-canvas example code for "${label}": ${error.message}`);
  }
}

function createExampleHelpers() {
  const runtime = getRuntime();

  return Object.freeze({
    runtime,
    async sendPrompt(promptText, options = {}) {
      if (
        !runtime.onscreenAgent ||
        typeof runtime.onscreenAgent !== "object" ||
        typeof runtime.onscreenAgent.submitExamplePrompt !== "function"
      ) {
        throw new Error("space.onscreenAgent.submitExamplePrompt(...) is not available.");
      }

      return runtime.onscreenAgent.submitExamplePrompt(promptText, options);
    }
  });
}

function normalizeExampleDefinition(rawExample, index) {
  const normalizedExample =
    rawExample && typeof rawExample === "object" && !Array.isArray(rawExample)
      ? rawExample
      : {};
  const text = collapseWhitespace(normalizedExample.text ?? normalizedExample.label ?? normalizedExample.prompt);
  const code = String(normalizedExample.code ?? normalizedExample.javascript ?? "").trim();

  if (!text) {
    throw new Error(`Empty-canvas example ${index + 1} is missing text.`);
  }

  if (!code) {
    throw new Error(`Empty-canvas example "${text}" is missing code.`);
  }

  const executeCode = compileExampleCode(code, text);
  const example = Object.freeze({
    id: normalizeExampleId(normalizedExample.id ?? text, index),
    text
  });

  return {
    ...example,
    async execute(event = null) {
      return executeCode(createExampleHelpers(), example, event);
    }
  };
}

function normalizeExamplesConfig(rawConfig) {
  const config =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
  const entries = Array.isArray(rawConfig)
    ? rawConfig
    : Array.isArray(config.examples)
      ? config.examples
      : [];

  return entries.map((entry, index) => normalizeExampleDefinition(entry, index));
}

export async function loadEmptyCanvasExamples() {
  if (!emptyCanvasExamplesPromise) {
    emptyCanvasExamplesPromise = (async () => {
      const runtime = getRuntime();
      const response = await fetch(EMPTY_CANVAS_EXAMPLES_CONFIG_URL, {
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(
          `Unable to read ${EMPTY_CANVAS_EXAMPLES_CONFIG_URL}: ${response.status} ${response.statusText}`
        );
      }

      const source = await response.text();
      return normalizeExamplesConfig(runtime.utils.yaml.parse(source));
    })().catch((error) => {
      emptyCanvasExamplesPromise = null;
      throw error;
    });
  }

  return emptyCanvasExamplesPromise;
}
