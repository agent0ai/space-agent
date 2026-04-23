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
  const withHeaders = applyCodexHeaders(
    {
      ...apiRequest,
      requestBody: codexBody,
      requestUrl: CODEX_RESPONSES_ENDPOINT
    },
    {
      accessToken: freshTokens.accessToken,
      chatGPTAccountId: freshTokens.accountId
    }
  );

  hookContext.result = {
    ...withHeaders,
    apiEndpoint: CODEX_RESPONSES_ENDPOINT,
    settings: {
      ...settings,
      codexTokens: serializeTokens(freshTokens)
    }
  };
}
