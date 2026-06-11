export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_RESPONSES_ENDPOINT = `${CODEX_BASE_URL}/responses`;
// `client_version` is a required query parameter on the Codex models endpoint;
// omitting it yields HTTP 400 `invalid_request_error` with
// `loc: ('query', 'client_version'), msg: 'Field required'`. The value is not
// account-scoped and only needs to identify the caller surface.
export const CODEX_MODELS_ENDPOINT = `${CODEX_BASE_URL}/models?client_version=0.0.0`;
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/codex/device";
export const CODEX_OAUTH_DEVICE_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
export const CODEX_OAUTH_DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
export const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";

const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_USER_AGENT = `${CODEX_ORIGINATOR}/0.0.0 (space-agent)`;

export function extractChatGPTAccountId(accessToken = "") {
  const token = String(accessToken || "").trim();

  if (!token) {
    return "";
  }

  try {
    const parts = token.split(".");

    if (parts.length < 2) {
      return "";
    }

    const payloadSegment = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const paddedSegment = payloadSegment + "=".repeat((4 - (payloadSegment.length % 4)) % 4);
    const payload = JSON.parse(atob(paddedSegment));
    const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;

    return typeof accountId === "string" ? accountId : "";
  } catch {
    return "";
  }
}

export function applyCodexHeaders(apiRequest = {}, options = {}) {
  const headers =
    apiRequest?.headers && typeof apiRequest.headers === "object"
      ? { ...apiRequest.headers }
      : {};
  const accessToken = String(options?.accessToken || "").trim();
  const explicitAccountId = String(options?.chatGPTAccountId || "").trim();

  // Cloudflare in front of the Codex endpoint blocks non-residential traffic unless the request
  // advertises a first-party originator. Without these two headers the server returns HTTP 403
  // with `cf-mitigated: challenge` regardless of token validity.
  headers["User-Agent"] = CODEX_USER_AGENT;
  headers.originator = CODEX_ORIGINATOR;
  headers.Accept = "text/event-stream";

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const chatGPTAccountId = explicitAccountId || extractChatGPTAccountId(accessToken);

  if (chatGPTAccountId) {
    headers["ChatGPT-Account-ID"] = chatGPTAccountId;
  }

  return {
    ...apiRequest,
    headers
  };
}
