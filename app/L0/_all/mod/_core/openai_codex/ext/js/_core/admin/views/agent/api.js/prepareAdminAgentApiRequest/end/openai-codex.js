import {
  CODEX_RESPONSES_ENDPOINT,
  applyCodexHeaders
} from "/mod/_core/openai_codex/request.js";
import { chatToResponsesRequest } from "/mod/_core/openai_codex/request_shape.js";
import {
  ensureFreshCodexAccessToken,
  normalizeCodexTokens
} from "/mod/_core/openai_codex/token_manager.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCodexTokensFromSettings(settings) {
  const raw = settings?.codexTokens;

  if (!raw) {
    return null;
  }

  if (isObject(raw)) {
    return normalizeCodexTokens(raw);
  }

  if (typeof raw !== "string") {
    return null;
  }

  try {
    return normalizeCodexTokens(JSON.parse(raw));
  } catch {
    return null;
  }
}

function serializeTokens(tokens) {
  return tokens ? JSON.stringify(tokens) : "";
}

// chatgpt.com does not advertise CORS, so a direct browser fetch from the
// page origin is always blocked by the browser's preflight. The standard
// `prepareAdminAgentApiRequest` flow already routes its API URL through
// `space.proxy.buildUrl(...)` for proxyable external endpoints; the Codex
// hook overrides `requestUrl` and must therefore re-apply the same proxy
// routing itself. Without this, every Codex chat call pays an extra
// failed-direct-fetch roundtrip (rescued by `installFetchProxy(...)`'s
// fallback retry) and emits a red CORS error in the DevTools console on
// the first call of every page load.
function resolveCodexProxyRequestUrl(targetUrl) {
  const runtimeProxy = globalThis.space?.proxy;

  if (!runtimeProxy || typeof runtimeProxy.buildUrl !== "function") {
    return String(targetUrl || "");
  }

  try {
    return runtimeProxy.buildUrl(targetUrl);
  } catch {
    return String(targetUrl || "");
  }
}

// Token persistence lives on the store/storage side. When a refresh rotates
// the refresh token the hook must hand the new payload back to the store so
// that encoding, userCrypto, and YAML writing stay owned by `storage.js`.
async function deliverRefreshedTokensToStore(tokens) {
  const alpine = globalThis.Alpine;
  const store = typeof alpine?.store === "function" ? alpine.store("adminAgent") : null;

  if (!store || typeof store.applyRefreshedCodexTokens !== "function") {
    throw new Error("Admin agent store is not available to persist refreshed Codex tokens.");
  }

  await store.applyRefreshedCodexTokens(tokens);
}

export default async function openAiCodexAdminRequestHook(hookContext) {
  const apiRequest = hookContext?.result;

  if (!apiRequest || typeof apiRequest !== "object") {
    return;
  }

  const settings = apiRequest.settings;

  if (settings?.provider !== "openai-codex") {
    return;
  }

  const freshTokens = await ensureFreshCodexAccessToken({
    loadTokens: () => parseCodexTokensFromSettings(settings),
    saveTokens: deliverRefreshedTokensToStore
  });

  const chatBody = isObject(apiRequest.requestBody) ? apiRequest.requestBody : {};
  const model =
    typeof settings?.codexModel === "string" && settings.codexModel.trim()
      ? settings.codexModel.trim()
      : chatBody.model;
  const codexBody = chatToResponsesRequest({ ...chatBody, model });
  const proxiedRequestUrl = resolveCodexProxyRequestUrl(CODEX_RESPONSES_ENDPOINT);
  const withHeaders = applyCodexHeaders(
    {
      ...apiRequest,
      requestBody: codexBody,
      requestUrl: proxiedRequestUrl
    },
    {
      accessToken: freshTokens.accessToken,
      chatGPTAccountId: freshTokens.accountId
    }
  );

  // The proxy endpoint is itself an authenticated space-agent route that
  // needs the browser session cookie. It strips the cookie header before
  // forwarding upstream so this does not leak `space_session` to chatgpt.com.
  const requestInit = {
    ...(withHeaders.requestInit && typeof withHeaders.requestInit === "object" ? withHeaders.requestInit : {}),
    credentials: "same-origin"
  };

  hookContext.result = {
    ...withHeaders,
    apiEndpoint: proxiedRequestUrl,
    requestInit,
    settings: {
      ...settings,
      codexTokens: serializeTokens(freshTokens)
    }
  };
}
