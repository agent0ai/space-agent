const CHAT_COMPLETIONS_FIELDS_TO_DROP = new Set([
  "frequency_penalty",
  "logit_bias",
  "max_output_tokens",
  "max_tokens",
  "n",
  "presence_penalty",
  "response_format",
  "stop",
  "temperature",
  "tool_choice",
  "tools",
  "top_logprobs",
  "top_p"
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Codex's Responses API distinguishes the text-content type by source role:
// user-authored content uses `input_text`, assistant-authored content uses
// `output_text`. Posting `input_text` under a role:"assistant" entry yields
// an `invalid_value` 400 from the API, so the text-type must be passed in by
// the caller rather than hard-coded here.
function convertContentParts(content, textType) {
  if (typeof content === "string") {
    return [
      {
        text: content,
        type: textType
      }
    ];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return {
          text: part,
          type: textType
        };
      }

      if (!isObject(part)) {
        return null;
      }

      if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
        return {
          text: typeof part.text === "string" ? part.text : "",
          type: textType
        };
      }

      if (part.type === "image_url") {
        const imageUrl =
          typeof part.image_url === "string"
            ? part.image_url
            : isObject(part.image_url)
              ? part.image_url.url
              : "";
        const detail = isObject(part.image_url) ? part.image_url.detail : undefined;

        const converted = {
          image_url: imageUrl,
          type: "input_image"
        };

        if (typeof detail === "string" && detail) {
          converted.detail = detail;
        }

        return converted;
      }

      if (part.type === "input_image") {
        return { ...part };
      }

      return null;
    })
    .filter(Boolean);
}

function textTypeForRole(role) {
  return role === "assistant" ? "output_text" : "input_text";
}

function extractInstructionsAndInput(messages) {
  if (!Array.isArray(messages)) {
    return {
      input: [],
      instructions: ""
    };
  }

  let instructions = "";
  let systemConsumed = false;
  const input = [];

  for (const message of messages) {
    if (!isObject(message)) {
      continue;
    }

    const role = message.role;

    if (role === "system") {
      if (!systemConsumed) {
        instructions = typeof message.content === "string"
          ? message.content
          : convertContentParts(message.content, "input_text")
              .map((part) => part.text || "")
              .join("");
        systemConsumed = true;
      }

      continue;
    }

    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const textType = textTypeForRole(role);
    const contentParts = convertContentParts(message.content, textType);
    const hasMeaningfulPart = contentParts.some(
      (part) => (part.type !== "input_text" && part.type !== "output_text") ||
        (typeof part.text === "string" && part.text.length > 0)
    );

    if (!hasMeaningfulPart) {
      continue;
    }

    input.push({
      content: contentParts,
      role
    });
  }

  return {
    input,
    instructions
  };
}

export function chatToResponsesRequest(chatBody = {}) {
  const body = isObject(chatBody) ? chatBody : {};
  const { input, instructions } = extractInstructionsAndInput(body.messages);

  const responsesBody = {
    input,
    model: typeof body.model === "string" ? body.model : "",
    store: false
  };

  if (instructions) {
    responsesBody.instructions = instructions;
  }

  if (body.stream === true) {
    responsesBody.stream = true;
  }

  for (const [key, value] of Object.entries(body)) {
    if (key === "messages" || key === "model" || key === "stream" || key === "store") {
      continue;
    }

    if (CHAT_COMPLETIONS_FIELDS_TO_DROP.has(key)) {
      continue;
    }

    responsesBody[key] = value;
  }

  return responsesBody;
}
