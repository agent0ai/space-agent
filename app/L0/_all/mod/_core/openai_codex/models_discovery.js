import { CODEX_MODELS_ENDPOINT, applyCodexHeaders } from "/mod/_core/openai_codex/request.js";
import { parseCodexModelsResponse } from "/mod/_core/openai_codex/models_parser.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveProxyUrl(url) {
  const proxy = globalThis.space?.proxy;

  if (proxy && typeof proxy.buildUrl === "function") {
    try {
      return proxy.buildUrl(url);
    } catch {
      return "";
    }
  }

  return "";
}

async function fetchModelsJson(url, headers, fetchImpl) {
  const response = await fetchImpl(url, {
    credentials: "omit",
    headers,
    method: "GET"
  });

  if (!response.ok) {
    const error = new Error(`Codex models request failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

// Discover the Codex catalog live. Tries a direct browser fetch first; if that
// fails because of a network or CORS error, retries through the space-agent
// outbound proxy at `/api/proxy` (existing infrastructure, not a new backend
// endpoint). Any failure falls through with an empty array so callers fall
// back to the static catalog shipped in `models.js`.
export async function discoverCodexModels({
  accessToken,
  chatGPTAccountId,
  fetchImpl
} = {}) {
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;

  if (typeof fetchFn !== "function") {
    return [];
  }

  const token = normalizeText(accessToken);

  if (!token) {
    return [];
  }

  const withAuth = applyCodexHeaders(
    {},
    {
      accessToken: token,
      chatGPTAccountId: normalizeText(chatGPTAccountId)
    }
  );
  const headers = {
    ...(withAuth?.headers || {}),
    Accept: "application/json"
  };

  try {
    const payload = await fetchModelsJson(CODEX_MODELS_ENDPOINT, headers, fetchFn);
    return parseCodexModelsResponse(payload);
  } catch {
    // First attempt failed (network, CORS, 5xx, etc.). Fall through to the
    // proxy-based retry when that infrastructure is available.
  }

  const proxyUrl = resolveProxyUrl(CODEX_MODELS_ENDPOINT);

  if (!proxyUrl) {
    return [];
  }

  try {
    const payload = await fetchModelsJson(proxyUrl, headers, fetchFn);
    return parseCodexModelsResponse(payload);
  } catch {
    return [];
  }
}
