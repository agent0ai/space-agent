import { CODEX_MODELS_ENDPOINT, applyCodexHeaders } from "/mod/_core/openai_codex/request.js";
import { parseCodexModelsResponse } from "/mod/_core/openai_codex/models_parser.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Resolve the space-agent same-origin proxy URL for the Codex models endpoint.
// `chatgpt.com` does not send permissive CORS headers, so a direct browser
// fetch is always blocked. We therefore route the request through the
// space-agent outbound proxy (`/api/proxy`) on every call; this is existing
// infrastructure shared with other cross-origin reads and does not require a
// new backend endpoint. When the runtime does not expose the proxy helper
// (e.g. test environment without the framework namespace), discovery returns
// an empty list so callers fall back to the static catalog.
function resolveProxyUrl(targetUrl) {
  const runtimeProxy = globalThis.space?.proxy;

  if (!runtimeProxy || typeof runtimeProxy.buildUrl !== "function") {
    return "";
  }

  try {
    return runtimeProxy.buildUrl(targetUrl);
  } catch {
    return "";
  }
}

async function fetchModelsJson(url, headers, fetchImpl) {
  // `credentials: "same-origin"` is required because the URL here is always
  // the space-agent `/api/proxy` endpoint (the runtime's `space.proxy.buildUrl`
  // returns a same-origin URL). `/api/proxy` itself is an authenticated
  // endpoint that needs the browser's `space_session` cookie. The proxy
  // strips the `cookie` header before forwarding upstream, so this does not
  // leak space-agent session state to chatgpt.com.
  const response = await fetchImpl(url, {
    credentials: "same-origin",
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

  const proxyUrl = resolveProxyUrl(CODEX_MODELS_ENDPOINT);

  if (!proxyUrl) {
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
    const payload = await fetchModelsJson(proxyUrl, headers, fetchFn);
    return parseCodexModelsResponse(payload);
  } catch {
    return [];
  }
}
