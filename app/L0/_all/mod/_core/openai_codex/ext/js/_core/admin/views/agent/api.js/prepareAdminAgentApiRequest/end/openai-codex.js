import {
  CODEX_RESPONSES_ENDPOINT,
  applyCodexHeaders
} from "/mod/_core/openai_codex/request.js";
import { chatToResponsesRequest } from "/mod/_core/openai_codex/request_shape.js";
import { ensureFreshCodexAccessToken } from "/mod/_core/openai_codex/token_manager.js";

const ADMIN_CHAT_CONFIG_PATH = "~/conf/admin-chat.yaml";

function parseCodexTokensFromSettings(settings) {
  const raw = settings?.codexTokens;

  if (!raw) {
    return null;
  }

  if (typeof raw === "object") {
    return raw;
  }

  if (typeof raw !== "string") {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serializeTokens(tokens) {
  return tokens ? JSON.stringify(tokens) : "";
}

async function loadTokensFromAdminConfig(initialSettings) {
  const fileApi = globalThis.space?.api;

  if (!fileApi || typeof fileApi.fileRead !== "function") {
    return parseCodexTokensFromSettings(initialSettings);
  }

  try {
    const raw = await fileApi.fileRead(ADMIN_CHAT_CONFIG_PATH);
    const yamlParse = globalThis.space?.utils?.yaml?.parse;

    if (typeof yamlParse !== "function") {
      return parseCodexTokensFromSettings(initialSettings);
    }

    const parsedConfig = yamlParse(raw);
    const cipher = parsedConfig?.codex_tokens;

    if (typeof cipher !== "string" || !cipher) {
      return null;
    }

    const decryptText = globalThis.space?.utils?.userCrypto?.decryptText;

    if (typeof decryptText !== "function") {
      return null;
    }

    const plain = await decryptText(cipher);

    if (!plain) {
      return null;
    }

    try {
      return JSON.parse(plain);
    } catch {
      return null;
    }
  } catch {
    return parseCodexTokensFromSettings(initialSettings);
  }
}

async function saveTokensToAdminConfig(tokens) {
  const fileApi = globalThis.space?.api;
  const userCrypto = globalThis.space?.utils?.userCrypto;
  const yamlUtils = globalThis.space?.utils?.yaml;

  if (!fileApi?.fileRead || !fileApi?.fileWrite || !userCrypto?.encryptText || !yamlUtils?.parse || !yamlUtils?.stringify) {
    throw new Error("User crypto or file API is not available.");
  }

  const raw = await fileApi.fileRead(ADMIN_CHAT_CONFIG_PATH);
  const parsed = yamlUtils.parse(raw) || {};
  const plain = JSON.stringify(tokens);
  const cipher = await userCrypto.encryptText(plain);

  parsed.codex_tokens = cipher;

  const nextRaw = yamlUtils.stringify(parsed);
  await fileApi.fileWrite(ADMIN_CHAT_CONFIG_PATH, nextRaw);
}

export default async function openAiCodexAdminRequestHook(hookContext) {
  const apiRequest = hookContext?.result;

  if (!apiRequest || typeof apiRequest !== "object") {
    return;
  }

  const settings = apiRequest.settings;
  const provider =
    settings?.provider === "openai-codex" ? "openai-codex" : null;

  if (!provider) {
    return;
  }

  const freshTokens = await ensureFreshCodexAccessToken({
    loadTokens: () => loadTokensFromAdminConfig(settings),
    saveTokens: saveTokensToAdminConfig
  });

  const chatBody = apiRequest.requestBody && typeof apiRequest.requestBody === "object" ? apiRequest.requestBody : {};
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
