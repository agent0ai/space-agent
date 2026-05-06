// Shared helpers for redirecting an API-mode chat request to the
// authenticated `/api/anthropic_subscription_completions` endpoint when
// the user opted into the Claude subscription provider. The per-surface
// extension hooks call into these so behavior stays in lockstep across
// the admin and onscreen agent surfaces.

const ANTHROPIC_SUBSCRIPTION_ENDPOINT_PATH = "/api/anthropic_subscription_completions";
const ANTHROPIC_SUBSCRIPTION_DEFAULT_MODEL = "claude-sonnet-4-6";

// Friendly aliases users can pick from in the settings dialog. The alias
// strings are forwarded verbatim to Anthropic so the upstream resolves
// them to the latest dated release; when Anthropic introduces a newer
// model, users can keep using the same alias without a Space Agent
// update, or switch to the "Custom..." option to type a dated id.
const ANTHROPIC_SUBSCRIPTION_CURATED_MODELS = Object.freeze([
  Object.freeze({ value: "claude-opus-4-7", label: "Claude Opus 4.7" }),
  Object.freeze({ value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }),
  Object.freeze({ value: "claude-haiku-4-5", label: "Claude Haiku 4.5" })
]);

function isAnthropicSubscriptionCuratedModel(value) {
  const normalized = String(value || "").trim();
  return ANTHROPIC_SUBSCRIPTION_CURATED_MODELS.some((entry) => entry.value === normalized);
}

function normalizeSubscriptionModelId(value) {
  let model = String(value || "").trim();
  if (!model) {
    return "";
  }
  // Strip "<provider>/" prefixes such as "anthropic/" or "openai/"
  const slashIndex = model.indexOf("/");
  if (slashIndex !== -1) {
    model = model.slice(slashIndex + 1);
  }
  // OpenRouter aliases use dotted version separators ("4.5"); Anthropic
  // expects dashes ("4-5"). Normalize so a copy-paste from another
  // provider just works.
  return model.replace(/\./g, "-");
}

function isAnthropicSubscriptionProvider(value) {
  return String(value || "").trim().toLowerCase() === "subscription";
}

function buildAnthropicSubscriptionUrl(origin = "") {
  if (typeof origin === "string" && origin) {
    return `${origin.replace(/\/+$/u, "")}${ANTHROPIC_SUBSCRIPTION_ENDPOINT_PATH}`;
  }
  if (typeof globalThis.location?.origin === "string") {
    return `${globalThis.location.origin}${ANTHROPIC_SUBSCRIPTION_ENDPOINT_PATH}`;
  }
  return ANTHROPIC_SUBSCRIPTION_ENDPOINT_PATH;
}

function applyAnthropicSubscriptionRequest(apiRequest = {}) {
  if (!apiRequest || typeof apiRequest !== "object") {
    return apiRequest;
  }

  const headers =
    apiRequest.headers && typeof apiRequest.headers === "object"
      ? { ...apiRequest.headers }
      : {};

  // The server injects the bearer token. Strip any client-supplied
  // Authorization so it never leaks through the proxy and so a stale
  // user-entered API key cannot accidentally override the OAuth path.
  delete headers.Authorization;
  delete headers.authorization;

  const requestBody =
    apiRequest.requestBody && typeof apiRequest.requestBody === "object"
      ? { ...apiRequest.requestBody }
      : null;

  if (requestBody) {
    const normalized = normalizeSubscriptionModelId(requestBody.model);
    if (!normalized || normalized.startsWith("gpt-") || normalized.startsWith("o1") || normalized.startsWith("o3")) {
      requestBody.model = ANTHROPIC_SUBSCRIPTION_DEFAULT_MODEL;
    } else {
      requestBody.model = normalized;
    }
  }

  return {
    ...apiRequest,
    apiEndpoint: buildAnthropicSubscriptionUrl(),
    headers,
    requestBody: requestBody || apiRequest.requestBody,
    requestUrl: buildAnthropicSubscriptionUrl()
  };
}

export {
  ANTHROPIC_SUBSCRIPTION_CURATED_MODELS,
  ANTHROPIC_SUBSCRIPTION_DEFAULT_MODEL,
  ANTHROPIC_SUBSCRIPTION_ENDPOINT_PATH,
  applyAnthropicSubscriptionRequest,
  buildAnthropicSubscriptionUrl,
  isAnthropicSubscriptionCuratedModel,
  isAnthropicSubscriptionProvider,
  normalizeSubscriptionModelId
};
