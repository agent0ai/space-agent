export const DEFAULT_CODEX_REFRESH_MARGIN_SECONDS = 300;
export const CODEX_AUTH_START_ENDPOINT = "/api/openai_codex_auth_start";
export const CODEX_AUTH_POLL_ENDPOINT = "/api/openai_codex_auth_poll";
export const CODEX_TOKEN_REFRESH_ENDPOINT = "/api/openai_codex_token_refresh";

const inFlightRefreshes = new Map();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeCodexTokens(value) {
  if (!isObject(value)) {
    return null;
  }

  const accessToken = String(value.accessToken || "").trim();
  const refreshToken = String(value.refreshToken || "").trim();

  if (!accessToken || !refreshToken) {
    return null;
  }

  const expiresAt = Number.isFinite(value.expiresAt) ? Number(value.expiresAt) : 0;
  const obtainedAt = Number.isFinite(value.obtainedAt) ? Number(value.obtainedAt) : 0;
  const idToken = String(value.idToken || "").trim();
  const accountId = String(value.accountId || "").trim();

  return {
    accessToken,
    accountId,
    expiresAt,
    idToken,
    obtainedAt,
    refreshToken
  };
}

export function isCodexAccessTokenExpiring(tokens, marginSeconds = DEFAULT_CODEX_REFRESH_MARGIN_SECONDS) {
  const normalized = normalizeCodexTokens(tokens);

  if (!normalized) {
    return true;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const margin = Number.isFinite(marginSeconds) && marginSeconds >= 0 ? marginSeconds : DEFAULT_CODEX_REFRESH_MARGIN_SECONDS;

  return normalized.expiresAt <= nowSeconds + margin;
}

async function postJson(url, body, fetchImpl) {
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;

  if (typeof fetchFn !== "function") {
    throw new Error("No fetch implementation available.");
  }

  const response = await fetchFn(url, {
    body: JSON.stringify(body || {}),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  let payload = null;
  const contentType = response.headers?.get?.("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      payload = await response.text();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = isObject(payload) && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function startCodexDeviceAuthorization({ fetchImpl } = {}) {
  return postJson(CODEX_AUTH_START_ENDPOINT, {}, fetchImpl);
}

export async function pollCodexDeviceAuthorization({ deviceAuthId, userCode, fetchImpl } = {}) {
  return postJson(
    CODEX_AUTH_POLL_ENDPOINT,
    {
      deviceAuthId: String(deviceAuthId || "").trim(),
      userCode: String(userCode || "").trim()
    },
    fetchImpl
  );
}

async function refreshOnce(refreshToken, fetchImpl) {
  const response = await postJson(CODEX_TOKEN_REFRESH_ENDPOINT, { refreshToken }, fetchImpl);
  const normalized = normalizeCodexTokens(response);

  if (!normalized) {
    throw new Error("Codex refresh response did not include valid tokens.");
  }

  return normalized;
}

async function runSingleFlightRefresh(refreshToken, fetchImpl) {
  const existing = inFlightRefreshes.get(refreshToken);

  if (existing) {
    return existing;
  }

  const pending = (async () => {
    try {
      return await refreshOnce(refreshToken, fetchImpl);
    } finally {
      inFlightRefreshes.delete(refreshToken);
    }
  })();

  inFlightRefreshes.set(refreshToken, pending);
  return pending;
}

export async function ensureFreshCodexAccessToken({
  fetchImpl,
  loadTokens,
  marginSeconds = DEFAULT_CODEX_REFRESH_MARGIN_SECONDS,
  saveTokens
} = {}) {
  if (typeof loadTokens !== "function") {
    throw new Error("loadTokens is required.");
  }

  // Always re-read persisted tokens instead of trusting an in-memory copy.
  // Other tabs or processes may have rotated the refresh token, and the
  // single-use rotation rule means a stale in-memory refresh_token will
  // fail with invalid_grant and force a full re-login.
  const loadedTokens = normalizeCodexTokens(await loadTokens());

  if (!loadedTokens) {
    const error = new Error("Codex tokens are missing. Please log in with ChatGPT.");
    error.statusCode = 401;
    throw error;
  }

  if (!isCodexAccessTokenExpiring(loadedTokens, marginSeconds)) {
    return loadedTokens;
  }

  const refreshed = await runSingleFlightRefresh(loadedTokens.refreshToken, fetchImpl);

  if (typeof saveTokens === "function") {
    try {
      await saveTokens(refreshed);
    } catch (error) {
      // Saving the refreshed tokens back into user config is best-effort from
      // this module's perspective; the caller should log the failure. The
      // refreshed tokens are still returned so the active request can proceed.
      if (typeof globalThis.console?.warn === "function") {
        globalThis.console.warn("Failed to persist refreshed Codex tokens:", error);
      }
    }
  }

  return refreshed;
}

export function resetCodexTokenManagerForTesting() {
  inFlightRefreshes.clear();
}
