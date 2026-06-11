export const AGENT_PERSONALITY_PATH = "~/conf/personality.system.include.md";

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (
    !runtime.api ||
    typeof runtime.api.fileRead !== "function" ||
    typeof runtime.api.fileWrite !== "function"
  ) {
    throw new Error("space.api helpers are not available.");
  }

  return runtime;
}

export async function loadAgentPersonality() {
  const runtime = getRuntime();

  // Idempotent read: this config is optional. Use ifExists so a missing
  // file returns content: null instead of throwing 404.
  try {
    const result = await runtime.api.fileRead(AGENT_PERSONALITY_PATH, "utf8", { ifExists: true });
    return String(result?.content || "");
  } catch (error) {
    throw new Error(`Unable to load agent personality: ${error.message}`);
  }
}

export async function saveAgentPersonality(content) {
  const runtime = getRuntime();
  const normalizedContent = String(content ?? "");

  try {
    await runtime.api.fileWrite({
      files: [
        { path: "~/conf/" },
        {
          path: AGENT_PERSONALITY_PATH,
          content: normalizedContent
        }
      ]
    });
  } catch (error) {
    throw new Error(`Unable to save agent personality: ${error.message}`);
  }
}
