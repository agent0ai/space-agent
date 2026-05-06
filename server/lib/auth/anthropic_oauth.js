// Anthropic OAuth integration for the optional "Claude subscription" LLM
// provider. The browser owns the user-facing flow; this module owns:
//
//   - PKCE challenge generation and exchange
//   - access_token / refresh_token storage, sealed at rest with the same
//     password_seal_key used by user_crypto server shares
//   - lazy refresh when the access token is near expiry or rejected
//   - the OAuth endpoint configuration that subscription requests use
//
// Tokens for a given user live at the logical app path
//   /app/L2/<username>/meta/anthropic_oauth.json
// and are encrypted with AES-256-GCM. The plaintext access_token never
// touches disk and never reaches the browser; it is injected server-side
// when the user issues a chat completion through the dedicated subscription
// endpoint.

import fs from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

import { recordAppPathMutations } from "../customware/git_history.js";
import { loadAuthKeys } from "./keys_manage.js";
import {
  buildUserAbsolutePath,
  normalizeUsername
} from "./user_files.js";

const ANTHROPIC_OAUTH_FILENAME = "anthropic_oauth.json";
const ANTHROPIC_OAUTH_SEAL_AAD_PREFIX = "space-anthropic-oauth-v1";
const ANTHROPIC_OAUTH_SEAL_IV_LENGTH = 12;
const ANTHROPIC_OAUTH_RECORD_VERSION = 1;
const ANTHROPIC_OAUTH_REFRESH_LEAD_MS = 60 * 1000;

const ANTHROPIC_OAUTH_FLOW_MODE_AUTO = "auto";
const ANTHROPIC_OAUTH_FLOW_MODE_PASTE = "paste";
const ANTHROPIC_OAUTH_FLOW_MODE_REDIRECT = "redirect";

// Local hostnames where Claude Code's public OAuth client is known to
// allow `http://<host>:<port>/...` redirect URIs. When Space Agent is
// served from one of these we can use a button-only flow that lets
// Anthropic redirect back to /api/oauth_anthropic_callback directly.
const LOCAL_HOSTNAME_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/u;

// Defaults match the published Claude Code OAuth client. They are
// configurable through runtime params so a maintainer with their own
// registered Anthropic OAuth application can override the public defaults.
const DEFAULT_ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_ANTHROPIC_OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const DEFAULT_ANTHROPIC_OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const DEFAULT_ANTHROPIC_OAUTH_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const DEFAULT_ANTHROPIC_OAUTH_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference"
];
const ANTHROPIC_OAUTH_USER_AGENT = "space-agent/anthropic-oauth";

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function getTokenSealKey(authKeys) {
  const passwordSealKey = authKeys?.passwordSealKey;

  if (!Buffer.isBuffer(passwordSealKey) || passwordSealKey.length === 0) {
    throw new Error("Password seal key is unavailable.");
  }

  return createHash("sha256").update(ANTHROPIC_OAUTH_SEAL_AAD_PREFIX).update(passwordSealKey).digest();
}

function buildSealAad(username) {
  return Buffer.from(
    JSON.stringify({
      prefix: ANTHROPIC_OAUTH_SEAL_AAD_PREFIX,
      username: String(username || ""),
      version: ANTHROPIC_OAUTH_RECORD_VERSION
    })
  );
}

function sealTokenPayload(plainText, username, authKeys) {
  const iv = randomBytes(ANTHROPIC_OAUTH_SEAL_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getTokenSealKey(authKeys), iv);
  cipher.setAAD(buildSealAad(username));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(String(plainText || ""), "utf8")),
    cipher.final()
  ]);

  return {
    ciphertext: encodeBase64Url(ciphertext),
    iv: encodeBase64Url(iv),
    tag: encodeBase64Url(cipher.getAuthTag())
  };
}

function openTokenPayload(record, username, authKeys) {
  if (!record || !record.ciphertext || !record.iv || !record.tag) {
    return "";
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", getTokenSealKey(authKeys), decodeBase64Url(record.iv));
    decipher.setAAD(buildSealAad(username));
    decipher.setAuthTag(decodeBase64Url(record.tag));
    const plain = Buffer.concat([
      decipher.update(decodeBase64Url(record.ciphertext)),
      decipher.final()
    ]);
    return plain.toString("utf8");
  } catch {
    return "";
  }
}

function buildUserOauthFilePath(projectRoot, username, runtimeParams = null) {
  return buildUserAbsolutePath(
    projectRoot,
    username,
    `meta/${ANTHROPIC_OAUTH_FILENAME}`,
    runtimeParams
  );
}

function buildUserOauthProjectPath(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return "";
  }
  return `/app/L2/${normalizedUsername}/meta/${ANTHROPIC_OAUTH_FILENAME}`;
}

function readUserOauthFile(projectRoot, username, runtimeParams = null) {
  try {
    const filePath = buildUserOauthFilePath(projectRoot, username, runtimeParams);
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function writeUserOauthFile(projectRoot, username, record, runtimeParams = null) {
  const filePath = buildUserOauthFilePath(projectRoot, username, runtimeParams);
  const dirPath = buildUserAbsolutePath(projectRoot, username, "meta", runtimeParams);
  fs.mkdirSync(dirPath, {
    mode: 0o700,
    recursive: true
  });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return filePath;
}

function deleteUserOauthFile(projectRoot, username, runtimeParams = null) {
  const filePath = buildUserOauthFilePath(projectRoot, username, runtimeParams);
  try {
    fs.statSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    return false;
  }
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function normalizeIsoTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function buildPersistableRecord({
  accessTokenSealed,
  refreshTokenSealed,
  expiresAt,
  scope,
  accountEmail,
  organizationId,
  organizationName,
  obtainedAt
}) {
  return {
    version: ANTHROPIC_OAUTH_RECORD_VERSION,
    access_token: accessTokenSealed,
    refresh_token: refreshTokenSealed,
    expires_at: expiresAt,
    scope: typeof scope === "string" ? scope : "",
    account_email: typeof accountEmail === "string" ? accountEmail : "",
    organization_id: typeof organizationId === "string" ? organizationId : "",
    organization_name: typeof organizationName === "string" ? organizationName : "",
    obtained_at: obtainedAt || new Date().toISOString()
  };
}

function buildOauthEndpoints(runtimeParams = null) {
  const get = (name, fallback) => {
    if (!runtimeParams || typeof runtimeParams.get !== "function") {
      return fallback;
    }
    const value = runtimeParams.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  };

  return {
    authorizeUrl: get("ANTHROPIC_OAUTH_AUTHORIZE_URL", DEFAULT_ANTHROPIC_OAUTH_AUTHORIZE_URL),
    clientId: get("ANTHROPIC_OAUTH_CLIENT_ID", DEFAULT_ANTHROPIC_OAUTH_CLIENT_ID),
    redirectUri: get("ANTHROPIC_OAUTH_REDIRECT_URI", DEFAULT_ANTHROPIC_OAUTH_REDIRECT_URI),
    tokenUrl: get("ANTHROPIC_OAUTH_TOKEN_URL", DEFAULT_ANTHROPIC_OAUTH_TOKEN_URL)
  };
}

function createPkceVerifier() {
  return encodeBase64Url(randomBytes(32));
}

function deriveCodeChallenge(verifier) {
  return encodeBase64Url(createHash("sha256").update(String(verifier || ""), "utf8").digest());
}

function buildAuthorizeUrl({
  endpoints,
  codeChallenge,
  state,
  redirectUri,
  flowMode,
  scopes = DEFAULT_ANTHROPIC_OAUTH_SCOPES
}) {
  const params = new URLSearchParams({
    client_id: endpoints.clientId,
    response_type: "code",
    redirect_uri: String(redirectUri || endpoints.redirectUri),
    scope: scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state
  });
  // Anthropic shows the authorization code on its hosted callback page only
  // when `code=true` is present; that flag is for the manual paste flow. In
  // redirect mode we want the normal OAuth redirect back to our server.
  if (flowMode !== ANTHROPIC_OAUTH_FLOW_MODE_REDIRECT) {
    params.set("code", "true");
  }
  return `${endpoints.authorizeUrl}?${params.toString()}`;
}

function isLocalHostname(host) {
  const trimmed = String(host || "").split(":")[0].trim().toLowerCase();
  return LOCAL_HOSTNAME_PATTERN.test(trimmed);
}

function resolveFlowMode(runtimeParams, _requestHost) {
  const explicit = String(runtimeParams?.get?.("ANTHROPIC_OAUTH_FLOW_MODE") || ANTHROPIC_OAUTH_FLOW_MODE_AUTO)
    .trim()
    .toLowerCase();
  if (explicit === ANTHROPIC_OAUTH_FLOW_MODE_REDIRECT) {
    return ANTHROPIC_OAUTH_FLOW_MODE_REDIRECT;
  }
  // The public Claude Code OAuth client only allowlists the Anthropic-hosted
  // code-paste page, not arbitrary localhost callbacks, so `auto` resolves to
  // `paste` everywhere. Redirect mode is opt-in for deployments that have
  // registered their own Anthropic OAuth client through ANTHROPIC_OAUTH_CLIENT_ID
  // with redirect URIs that point at this Space Agent host.
  return ANTHROPIC_OAUTH_FLOW_MODE_PASTE;
}

function buildLocalCallbackUri({ requestProtocol, requestHost }) {
  const protocol = requestProtocol === "https" ? "https" : "http";
  const host = String(requestHost || "localhost").trim() || "localhost";
  return `${protocol}://${host}/api/oauth_anthropic_callback`;
}

function friendlyOauthErrorMessage(detail, response) {
  const text = String(detail || "").toLowerCase();
  if (
    text.includes("invalid 'code'") ||
    text.includes("invalid code") ||
    text.includes("invalid_grant") ||
    text.includes("authorization code")
  ) {
    return "That authorization code didn't work. It may already have been used, expired, or been pasted incompletely. Click Connect with Claude again to start a fresh session.";
  }
  if (text.includes("invalid_client") || text.includes("client_id")) {
    return "Anthropic rejected the OAuth client. Ask the Space Agent operator to confirm ANTHROPIC_OAUTH_CLIENT_ID matches a registered Anthropic application.";
  }
  if (text.includes("invalid redirect_uri") || text.includes("redirect_uri")) {
    return "Anthropic rejected the redirect URL for this Space Agent host. Switch ANTHROPIC_OAUTH_FLOW_MODE to paste, or register this host's callback URL on Anthropic's side.";
  }
  if (text.includes("invalid scope")) {
    return "Anthropic rejected the requested OAuth scopes. The default Claude Code scopes may have changed; update Space Agent or override the scope list.";
  }
  if (Number(response?.status) >= 500) {
    return "Anthropic's OAuth service is not responding right now. Try again in a moment.";
  }
  return `Anthropic rejected the request: ${detail || `HTTP ${response?.status || "unknown"}`}`;
}

async function postOauthForm({ url, body }) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": ANTHROPIC_OAUTH_USER_AGENT
      },
      body: new URLSearchParams(body).toString()
    });
  } catch (error) {
    const friendly = new Error(`Could not reach Anthropic OAuth: ${error?.message || "network error"}.`);
    friendly.statusCode = 502;
    throw friendly;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object"
        ? payload.error_description || payload.error || JSON.stringify(payload)
        : `HTTP ${response.status}`;
    const error = new Error(friendlyOauthErrorMessage(detail, response));
    error.statusCode = response.status === 400 || response.status === 401 ? 400 : 502;
    error.cause = new Error(`Anthropic OAuth response: ${detail}`);
    throw error;
  }

  if (!payload || typeof payload !== "object") {
    const error = new Error("Anthropic returned an unexpected OAuth response. Try connecting again.");
    error.statusCode = 502;
    throw error;
  }

  return payload;
}

function tokenPayloadToRecord({
  payload,
  previousScope,
  previousAccountEmail,
  previousOrganizationId,
  previousOrganizationName,
  username,
  authKeys,
  retainRefreshToken = ""
}) {
  const accessToken = String(payload.access_token || "").trim();
  const refreshToken = String(payload.refresh_token || retainRefreshToken || "").trim();
  const expiresInSeconds = Number(payload.expires_in);
  const expiresAtMs = Number.isFinite(expiresInSeconds) ? Date.now() + expiresInSeconds * 1000 : Date.now() + 60 * 60 * 1000;

  if (!accessToken || !refreshToken) {
    const error = new Error("Anthropic OAuth response is missing tokens.");
    error.statusCode = 502;
    throw error;
  }

  const account =
    payload.account && typeof payload.account === "object" && !Array.isArray(payload.account)
      ? payload.account
      : null;
  const organization =
    payload.organization && typeof payload.organization === "object" && !Array.isArray(payload.organization)
      ? payload.organization
      : null;

  return buildPersistableRecord({
    accessTokenSealed: sealTokenPayload(accessToken, username, authKeys),
    refreshTokenSealed: sealTokenPayload(refreshToken, username, authKeys),
    expiresAt: new Date(expiresAtMs).toISOString(),
    scope: typeof payload.scope === "string" ? payload.scope : previousScope || "",
    accountEmail:
      typeof account?.email_address === "string"
        ? account.email_address
        : typeof account?.email === "string"
          ? account.email
          : previousAccountEmail || "",
    organizationId:
      typeof organization?.uuid === "string"
        ? organization.uuid
        : typeof organization?.id === "string"
          ? organization.id
          : previousOrganizationId || "",
    organizationName:
      typeof organization?.name === "string" ? organization.name : previousOrganizationName || "",
    obtainedAt: new Date().toISOString()
  });
}

async function exchangeAuthorizationCode({
  code,
  codeVerifier,
  state,
  endpoints,
  redirectUri,
  username,
  authKeys
}) {
  const payload = await postOauthForm({
    url: endpoints.tokenUrl,
    body: {
      grant_type: "authorization_code",
      code: String(code || "").trim(),
      redirect_uri: String(redirectUri || endpoints.redirectUri),
      client_id: endpoints.clientId,
      code_verifier: String(codeVerifier || "").trim(),
      state: String(state || "").trim()
    }
  });

  return tokenPayloadToRecord({
    payload,
    username,
    authKeys
  });
}

async function refreshAccessToken({
  refreshToken,
  endpoints,
  username,
  authKeys,
  previousRecord
}) {
  const payload = await postOauthForm({
    url: endpoints.tokenUrl,
    body: {
      grant_type: "refresh_token",
      refresh_token: String(refreshToken || "").trim(),
      client_id: endpoints.clientId
    }
  });

  return tokenPayloadToRecord({
    payload,
    previousScope: previousRecord?.scope,
    previousAccountEmail: previousRecord?.account_email,
    previousOrganizationId: previousRecord?.organization_id,
    previousOrganizationName: previousRecord?.organization_name,
    username,
    authKeys,
    retainRefreshToken: openTokenPayload(previousRecord?.refresh_token, username, authKeys)
  });
}

function shouldRefreshRecord(record) {
  if (!record) {
    return false;
  }
  const expiresAtMs = Date.parse(record.expires_at || "");
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }
  return Date.now() + ANTHROPIC_OAUTH_REFRESH_LEAD_MS >= expiresAtMs;
}

async function persistRecord({ projectRoot, username, runtimeParams, record }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Anthropic OAuth requires a username.");
  }
  writeUserOauthFile(projectRoot, normalizedUsername, record, runtimeParams);
  recordAppPathMutations(
    {
      projectRoot,
      runtimeParams
    },
    [buildUserOauthProjectPath(normalizedUsername)]
  );
}

async function getActiveAccessToken({ projectRoot, username, runtimeParams, force = false }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { accessToken: "", record: null };
  }

  const authKeys = loadAuthKeys(projectRoot);
  const record = readUserOauthFile(projectRoot, normalizedUsername, runtimeParams);
  if (!record) {
    return { accessToken: "", record: null };
  }

  const endpoints = buildOauthEndpoints(runtimeParams);

  if (force || shouldRefreshRecord(record)) {
    const refreshTokenPlain = openTokenPayload(record.refresh_token, normalizedUsername, authKeys);
    if (!refreshTokenPlain) {
      return { accessToken: "", record };
    }
    const refreshed = await refreshAccessToken({
      refreshToken: refreshTokenPlain,
      endpoints,
      username: normalizedUsername,
      authKeys,
      previousRecord: record
    });
    await persistRecord({
      projectRoot,
      username: normalizedUsername,
      runtimeParams,
      record: refreshed
    });
    return {
      accessToken: openTokenPayload(refreshed.access_token, normalizedUsername, authKeys),
      record: refreshed
    };
  }

  return {
    accessToken: openTokenPayload(record.access_token, normalizedUsername, authKeys),
    record
  };
}

async function getStatusForUser({ projectRoot, username, runtimeParams }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { connected: false };
  }

  const record = readUserOauthFile(projectRoot, normalizedUsername, runtimeParams);
  if (!record) {
    return { connected: false };
  }

  return {
    connected: true,
    expiresAt: normalizeIsoTimestamp(record.expires_at),
    obtainedAt: normalizeIsoTimestamp(record.obtained_at),
    scope: typeof record.scope === "string" ? record.scope : "",
    accountEmail: typeof record.account_email === "string" ? record.account_email : "",
    organizationId: typeof record.organization_id === "string" ? record.organization_id : "",
    organizationName: typeof record.organization_name === "string" ? record.organization_name : ""
  };
}

async function disconnectUser({ projectRoot, username, runtimeParams }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { changed: false };
  }
  const removed = deleteUserOauthFile(projectRoot, normalizedUsername, runtimeParams);
  if (removed) {
    recordAppPathMutations(
      {
        projectRoot,
        runtimeParams
      },
      [buildUserOauthProjectPath(normalizedUsername)]
    );
  }
  return { changed: removed };
}

async function connectWithAuthorizationCode({
  code,
  state,
  codeVerifier,
  redirectUri,
  projectRoot,
  username,
  runtimeParams
}) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Anthropic OAuth requires an authenticated user.");
  }
  const authKeys = loadAuthKeys(projectRoot);
  const endpoints = buildOauthEndpoints(runtimeParams);
  const record = await exchangeAuthorizationCode({
    code,
    codeVerifier,
    state,
    redirectUri,
    endpoints,
    username: normalizedUsername,
    authKeys
  });
  await persistRecord({
    projectRoot,
    username: normalizedUsername,
    runtimeParams,
    record
  });
  return {
    accountEmail: record.account_email,
    expiresAt: record.expires_at,
    organizationId: record.organization_id,
    organizationName: record.organization_name,
    scope: record.scope
  };
}

function buildAuthorizeContext(runtimeParams = null, requestContext = {}) {
  const endpoints = buildOauthEndpoints(runtimeParams);
  const flowMode = resolveFlowMode(runtimeParams, requestContext.requestHost);
  const codeVerifier = createPkceVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = encodeBase64Url(randomBytes(24));
  const redirectUri =
    flowMode === ANTHROPIC_OAUTH_FLOW_MODE_REDIRECT
      ? buildLocalCallbackUri({
          requestProtocol: requestContext.requestProtocol,
          requestHost: requestContext.requestHost
        })
      : endpoints.redirectUri;
  return {
    authorizeUrl: buildAuthorizeUrl({ endpoints, codeChallenge, state, redirectUri, flowMode }),
    codeVerifier,
    endpoints: { ...endpoints, redirectUri },
    flowMode,
    redirectUri,
    state
  };
}

export {
  ANTHROPIC_OAUTH_FILENAME,
  ANTHROPIC_OAUTH_FLOW_MODE_AUTO,
  ANTHROPIC_OAUTH_FLOW_MODE_PASTE,
  ANTHROPIC_OAUTH_FLOW_MODE_REDIRECT,
  ANTHROPIC_OAUTH_USER_AGENT,
  DEFAULT_ANTHROPIC_OAUTH_AUTHORIZE_URL,
  DEFAULT_ANTHROPIC_OAUTH_CLIENT_ID,
  DEFAULT_ANTHROPIC_OAUTH_REDIRECT_URI,
  DEFAULT_ANTHROPIC_OAUTH_SCOPES,
  DEFAULT_ANTHROPIC_OAUTH_TOKEN_URL,
  buildAuthorizeContext,
  buildOauthEndpoints,
  connectWithAuthorizationCode,
  disconnectUser,
  getActiveAccessToken,
  getStatusForUser,
  isLocalHostname,
  resolveFlowMode,
  shouldRefreshRecord
};
