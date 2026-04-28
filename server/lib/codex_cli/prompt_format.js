function extractTextContent(value) {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");
}

function normalizeRole(value) {
  return value === "system" || value === "assistant" || value === "user"
    ? value
    : "user";
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const content = extractTextContent(message?.content || "").trim();

      if (!content) {
        return null;
      }

      return {
        content,
        role: normalizeRole(message?.role)
      };
    })
    .filter(Boolean);
}

function formatMessage(message, index) {
  return [
    `<message index="${index + 1}" role="${message.role}">`,
    message.content,
    "</message>"
  ].join("\n");
}

export function buildCodexPrompt({ messages, promptText, surface = "" } = {}) {
  const directPrompt = typeof promptText === "string" ? promptText.trim() : "";

  if (directPrompt) {
    return directPrompt;
  }

  const normalizedMessages = normalizeMessages(messages);

  if (!normalizedMessages.length) {
    throw Object.assign(new Error("Codex prompt is empty."), {
      statusCode: 400
    });
  }

  return [
    "You are running as a local Codex CLI worker for Space Agent.",
    "",
    "Use the existing Space Agent runtime contract in the messages below. Return only the assistant reply for the current turn unless the prompt explicitly asks for a plan or code.",
    surface ? `Surface: ${surface}` : "",
    "",
    "<conversation>",
    ...normalizedMessages.map(formatMessage),
    "</conversation>"
  ]
    .filter(Boolean)
    .join("\n");
}

export { normalizeMessages };
