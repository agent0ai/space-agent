export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_DEVICE_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
export const CODEX_OAUTH_DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
export const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
export const CODEX_OAUTH_VERIFICATION_URL = "https://auth.openai.com/codex/device";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function extractChatGPTAccountId(accessToken) {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";

  if (!token) {
    return "";
  }

  try {
    const parts = token.split(".");

    if (parts.length < 2) {
      return "";
    }

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;

    return typeof accountId === "string" ? accountId : "";
  } catch {
    return "";
  }
}

async function readJsonBody(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function startDeviceAuthorization() {
  const response = await fetch(CODEX_OAUTH_DEVICE_CODE_URL, {
    body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  const payload = await readJsonBody(response);

  if (!response.ok) {
    throw createHttpError(
      payload.error_description || payload.error || `Device authorization failed with HTTP ${response.status}.`,
      response.status === 429 ? 429 : 502
    );
  }

  // The OpenAI device-code endpoint returns `interval` as a string (e.g. "5"),
  // and encodes expiry as `expires_at` (ISO-8601 string) rather than `expires_in`.
  // Parse both defensively so the frontend always receives numbers.
  const parsedInterval = Number.parseInt(payload.interval, 10);
  const expiresAtMs = Date.parse(String(payload.expires_at || ""));
  const expiresInFromAt = Number.isFinite(expiresAtMs) ? Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000)) : 0;
  const parsedExpiresIn = Number.isFinite(payload.expires_in) ? Number(payload.expires_in) : expiresInFromAt;

  return {
    deviceAuthId: String(payload.device_auth_id || "").trim(),
    expiresIn: parsedExpiresIn > 0 ? parsedExpiresIn : 900,
    interval: Number.isFinite(parsedInterval) && parsedInterval >= 3 ? parsedInterval : 5,
    userCode: String(payload.user_code || "").trim(),
    verificationUrl: CODEX_OAUTH_VERIFICATION_URL
  };
}

function buildTokenPayload(accessToken, refreshToken, expiresIn, idToken) {
  const normalizedExpiresIn = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
  const obtainedAt = Math.floor(Date.now() / 1000);
  const accessTokenValue = typeof accessToken === "string" ? accessToken : "";
  const refreshTokenValue = typeof refreshToken === "string" ? refreshToken : "";

  return {
    accessToken: accessTokenValue,
    accountId: extractChatGPTAccountId(accessTokenValue),
    expiresAt: obtainedAt + normalizedExpiresIn,
    idToken: typeof idToken === "string" ? idToken : "",
    obtainedAt,
    refreshToken: refreshTokenValue
  };
}

export async function pollDeviceAuthorization({ deviceAuthId, userCode }) {
  const normalizedDeviceAuthId = String(deviceAuthId || "").trim();
  const normalizedUserCode = String(userCode || "").trim();

  if (!normalizedDeviceAuthId || !normalizedUserCode) {
    throw createHttpError("deviceAuthId and userCode are required.", 400);
  }

  const pollResponse = await fetch(CODEX_OAUTH_DEVICE_TOKEN_URL, {
    body: JSON.stringify({
      device_auth_id: normalizedDeviceAuthId,
      user_code: normalizedUserCode
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  if (pollResponse.status === 403 || pollResponse.status === 404) {
    return { state: "pending" };
  }

  const pollPayload = await readJsonBody(pollResponse);

  if (!pollResponse.ok) {
    throw createHttpError(
      pollPayload.error_description || pollPayload.error || `Device poll failed with HTTP ${pollResponse.status}.`,
      pollResponse.status === 429 ? 429 : 502
    );
  }

  const authorizationCode = String(pollPayload.authorization_code || "").trim();
  const codeVerifier = String(pollPayload.code_verifier || "").trim();

  if (!authorizationCode || !codeVerifier) {
    return { state: "pending" };
  }

  const formBody = new URLSearchParams({
    client_id: CODEX_OAUTH_CLIENT_ID,
    code: authorizationCode,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: CODEX_OAUTH_REDIRECT_URI
  });

  const tokenResponse = await fetch(CODEX_OAUTH_TOKEN_URL, {
    body: formBody.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  });

  const tokenPayload = await readJsonBody(tokenResponse);

  if (!tokenResponse.ok) {
    throw createHttpError(
      tokenPayload.error_description || tokenPayload.error || `Token exchange failed with HTTP ${tokenResponse.status}.`,
      502
    );
  }

  return {
    state: "complete",
    tokens: buildTokenPayload(
      tokenPayload.access_token,
      tokenPayload.refresh_token,
      tokenPayload.expires_in,
      tokenPayload.id_token
    )
  };
}

export async function refreshAccessToken({ refreshToken }) {
  const normalizedRefreshToken = String(refreshToken || "").trim();

  if (!normalizedRefreshToken) {
    throw createHttpError("refreshToken is required.", 400);
  }

  const formBody = new URLSearchParams({
    client_id: CODEX_OAUTH_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: normalizedRefreshToken
  });

  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    body: formBody.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  });

  const payload = await readJsonBody(response);

  if (!response.ok) {
    const errorCode = String(payload.error || "").trim();
    // Bubble up `invalid_grant` as 401 so the frontend knows the refresh token
    // has already been consumed (e.g. by another Codex client) and a full
    // re-login is required.
    if (errorCode === "invalid_grant") {
      throw createHttpError("Refresh token is no longer valid. Please log in again.", 401);
    }

    throw createHttpError(
      payload.error_description || errorCode || `Token refresh failed with HTTP ${response.status}.`,
      502
    );
  }

  return buildTokenPayload(payload.access_token, payload.refresh_token, payload.expires_in, payload.id_token);
}
