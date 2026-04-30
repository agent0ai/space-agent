const MISTRAL_HOST = "mistral.ai";

const ALLOWED_MESSAGE_FIELDS = ["role", "content", "name", "tool_calls", "tool_call_id"];

export function isMistralEndpoint(endpoint = "") {
  const normalizedEndpoint = String(endpoint || "").trim();

  if (!normalizedEndpoint) {
    return false;
  }

  try {
    const url = new URL(normalizedEndpoint, globalThis.location?.origin || "http://localhost");
    return url.hostname === MISTRAL_HOST || url.hostname.endsWith(`.${MISTRAL_HOST}`);
  } catch {
    return normalizedEndpoint.includes(MISTRAL_HOST);
  }
}

function stripMessage(message) {
  if (!message || typeof message !== "object") {
    return message;
  }

  const stripped = {};

  for (const field of ALLOWED_MESSAGE_FIELDS) {
    if (message[field] !== undefined) {
      stripped[field] = message[field];
    }
  }

  return stripped;
}

export function applyMistralBodyRewrite(apiRequest = {}) {
  const requestBody =
    apiRequest?.requestBody && typeof apiRequest.requestBody === "object"
      ? apiRequest.requestBody
      : null;

  if (!requestBody || !Array.isArray(requestBody.messages)) {
    return apiRequest;
  }

  return {
    ...apiRequest,
    requestBody: {
      ...requestBody,
      messages: requestBody.messages.map((message) => stripMessage(message))
    }
  };
}
