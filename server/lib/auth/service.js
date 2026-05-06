import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { recordAppPathMutations } from "../customware/git_history.js";
import { normalizeEntityId } from "../customware/layout.js";
import {
  SINGLE_USER_APP_USERNAME,
  isSingleUserApp
} from "../utils/runtime_params.js";
import { createEmptyUserIndex } from "./user_index.js";
import { loadAuthKeys } from "./keys_manage.js";
import {
  createPasswordVerifier,
  decodeBase64Url,
  encodeBase64Url,
  inspectPasswordRecord,
  migratePasswordVerifierRecord,
  openPasswordVerifierRecord,
  verifyLoginProof,
  verifyPassword
} from "./passwords.js";
import { setUserPassword } from "./user_manage.js";
import {
  readUserLogins,
  readUserPasswordVerifier,
  writeUserLogins,
  writeUserPasswordVerifier
} from "./user_files.js";
import {
  buildClientUserCryptoRecord,
  createUserCryptoServerShare,
  getUserCryptoState,
  provisionUserCrypto,
  readUserCryptoServerShare,
  USER_CRYPTO_STATUS_READY
} from "./user_crypto.js";
import { ANTHROPIC_OAUTH_STATE_AREA, LOGIN_CHALLENGE_AREA } from "../../runtime/state_areas.js";

const SESSION_COOKIE_NAME = "space_session";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ANTHROPIC_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,200}$/u;
const REMOTE_ADDRESS_MAX_LENGTH = 256;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,200}$/u;
const USER_CRYPTO_SESSION_KEY_PREFIX = "space-user-crypto-session-key-v1";
const SESSION_SIGNATURE_PREFIX = "space-session-record-v1";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,200}$/u;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_VERIFIER_PREFIX = "space-session-token-v1";
const USER_AGENT_MAX_LENGTH = 512;

function createStatusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createAnonymousUser(overrides = {}) {
  return {
    isAuthenticated: false,
    session: null,
    sessionToken: "",
    shouldClearSessionCookie: false,
    source: "anonymous",
    username: "",
    ...overrides
  };
}

function createSingleUser(overrides = {}) {
  return {
    isAuthenticated: true,
    session: null,
    sessionToken: "",
    shouldClearSessionCookie: false,
    source: "single-user-app",
    username: SINGLE_USER_APP_USERNAME,
    ...overrides
  };
}

function serializeCookie(name, value, attributes = {}) {
  const segments = [`${name}=${encodeURIComponent(String(value || ""))}`];

  Object.entries(attributes).forEach(([key, rawValue]) => {
    if (rawValue === false || rawValue === undefined || rawValue === null) {
      return;
    }

    if (rawValue === true) {
      segments.push(key);
      return;
    }

    segments.push(`${key}=${rawValue}`);
  });

  return segments.join("; ");
}

function createSessionCookieHeader(sessionToken, username = "") {
  const cookieValue = createSessionCookieValue(username, sessionToken) || String(sessionToken || "");

  return serializeCookie(SESSION_COOKIE_NAME, cookieValue, {
    HttpOnly: true,
    "Max-Age": Math.floor(SESSION_TTL_MS / 1000),
    Path: "/",
    SameSite: "Strict"
  });
}

function createSessionCookieValue(username, sessionToken) {
  const normalizedUsername = normalizeEntityId(username);
  const normalizedSessionToken = normalizeSessionToken(sessionToken);

  if (!normalizedUsername || !normalizedSessionToken) {
    return "";
  }

  return `${Buffer.from(normalizedUsername, "utf8").toString("base64url")}.${normalizedSessionToken}`;
}

function parseSessionCookieValue(value) {
  const rawValue = String(value || "").trim();
  const separatorIndex = rawValue.indexOf(".");

  if (separatorIndex <= 0) {
    return {
      sessionToken: normalizeSessionToken(rawValue),
      username: ""
    };
  }

  const encodedUsername = rawValue.slice(0, separatorIndex);
  const sessionToken = normalizeSessionToken(rawValue.slice(separatorIndex + 1));
  let username = "";

  try {
    username = normalizeEntityId(Buffer.from(encodedUsername, "base64url").toString("utf8"));
  } catch {
    username = "";
  }

  return {
    sessionToken,
    username
  };
}

function createClearedSessionCookieHeader() {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    HttpOnly: true,
    "Max-Age": 0,
    Path: "/",
    SameSite: "Strict"
  });
}

function normalizeNonce(value) {
  const nonce = String(value || "").trim();
  return NONCE_PATTERN.test(nonce) ? nonce : "";
}

function normalizeSessionToken(value) {
  const sessionToken = String(value || "").trim();
  return SESSION_TOKEN_PATTERN.test(sessionToken) ? sessionToken : "";
}

function normalizeSessionId(value) {
  const sessionId = String(value || "").trim();
  return SESSION_ID_PATTERN.test(sessionId) ? sessionId : "";
}

function createChallengeToken() {
  return randomBytes(24).toString("base64url");
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function createSessionId() {
  return randomBytes(24).toString("base64url");
}

function createStateBackedLoginChallengeStore(stateSystem) {
  return {
    async consumeLoginChallenge(challengeToken) {
      const normalizedChallengeToken = String(challengeToken || "").trim();

      if (!normalizedChallengeToken) {
        return null;
      }

      const entry = await stateSystem.takeEntry(LOGIN_CHALLENGE_AREA, normalizedChallengeToken);
      const challenge =
        entry?.value && typeof entry.value === "object" && !Array.isArray(entry.value)
          ? entry.value
          : null;

      return challenge ? { ...challenge } : null;
    },
    async storeLoginChallenge(challenge) {
      const normalizedChallengeToken = String(challenge?.challengeToken || "").trim();

      if (!normalizedChallengeToken) {
        throw new Error("Challenge token is required.");
      }

      await stateSystem.setEntry(
        LOGIN_CHALLENGE_AREA,
        normalizedChallengeToken,
        {
          ...challenge,
          challengeToken: normalizedChallengeToken
        },
        {
          expiresInMs: CHALLENGE_TTL_MS,
          replicate: false
        }
      );
    }
  };
}

function normalizeHeaderValue(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function getRemoteAddress(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const remoteAddress = forwardedFor || String(req?.socket?.remoteAddress || "");
  return normalizeHeaderValue(remoteAddress, REMOTE_ADDRESS_MAX_LENGTH);
}

function getUserAgentFromHeaders(headers) {
  return normalizeHeaderValue(headers?.["user-agent"], USER_AGENT_MAX_LENGTH);
}

function resolveRequestInfo(options = {}) {
  const requestInfo =
    options.requestInfo && typeof options.requestInfo === "object" && !Array.isArray(options.requestInfo)
      ? options.requestInfo
      : null;

  if (requestInfo) {
    return {
      remoteAddress: normalizeHeaderValue(requestInfo.remoteAddress, REMOTE_ADDRESS_MAX_LENGTH),
      userAgent: normalizeHeaderValue(requestInfo.userAgent, USER_AGENT_MAX_LENGTH)
    };
  }

  return {
    remoteAddress: getRemoteAddress(options.req),
    userAgent: getUserAgentFromHeaders(options.req?.headers)
  };
}

function getSessionHmacKey(authKeys) {
  const key = authKeys?.sessionHmacKey;

  if (!Buffer.isBuffer(key) || key.length === 0) {
    throw new Error("Session HMAC key is unavailable.");
  }

  return key;
}

function createSessionVerifier(sessionToken, authKeys) {
  return encodeBase64Url(
    createHmac("sha256", getSessionHmacKey(authKeys))
      .update(`${SESSION_VERIFIER_PREFIX}:${sessionToken}`)
      .digest()
  );
}

function createUserCryptoSessionStorageKey(sessionId, authKeys) {
  const normalizedSessionId = normalizeSessionId(sessionId);

  if (!normalizedSessionId) {
    return "";
  }

  return encodeBase64Url(
    createHmac("sha256", getSessionHmacKey(authKeys))
      .update(`${USER_CRYPTO_SESSION_KEY_PREFIX}:${normalizedSessionId}`)
      .digest()
  );
}

function buildSessionSignaturePayload(fields = {}, options = {}) {
  const payload = {
    createdAt: String(fields.createdAt || ""),
    expiresAt: String(fields.expiresAt || ""),
    prefix: SESSION_SIGNATURE_PREFIX,
    remoteAddress: String(fields.remoteAddress || ""),
    sessionVerifier: String(fields.sessionVerifier || ""),
    userAgent: String(fields.userAgent || ""),
    username: String(fields.username || "")
  };

  if (options.includeSessionId !== false) {
    payload.sessionId = String(fields.sessionId || "");
  }

  return JSON.stringify(payload);
}

function createSessionSignature(fields, authKeys, options = {}) {
  return encodeBase64Url(
    createHmac("sha256", getSessionHmacKey(authKeys))
      .update(buildSessionSignaturePayload(fields, options))
      .digest()
  );
}

function isSafeEqualBase64Url(left, right) {
  const leftBuffer = decodeBase64Url(left);
  const rightBuffer = decodeBase64Url(right);

  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeIsoDate(value) {
  const normalized = String(value || "").trim();
  const parsedAtMs = Date.parse(normalized);

  return Number.isFinite(parsedAtMs) ? new Date(parsedAtMs).toISOString() : "";
}

function normalizeStoredSessionRecord(options = {}) {
  const session =
    options.session && typeof options.session === "object" && !Array.isArray(options.session)
      ? options.session
      : null;
  const sessionVerifier = String(options.sessionVerifier || "").trim();
  const username = normalizeEntityId(options.username);

  if (!session || !sessionVerifier || !username) {
    return null;
  }

  const createdAt = normalizeIsoDate(session.createdAt);
  const expiresAt = normalizeIsoDate(session.expiresAt);
  const remoteAddress = normalizeHeaderValue(session.remoteAddress, REMOTE_ADDRESS_MAX_LENGTH);
  const sessionId = normalizeSessionId(session.sessionId);
  const signature = String(session.signature || "").trim();
  const userAgent = normalizeHeaderValue(session.userAgent, USER_AGENT_MAX_LENGTH);

  if (!createdAt || !expiresAt || !signature) {
    return null;
  }

  const expiresAtMs = Date.parse(expiresAt);

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }

  const expectedSignature = createSessionSignature(
    {
      createdAt,
      expiresAt,
      remoteAddress,
      sessionId,
      sessionVerifier,
      userAgent,
      username
    },
    options.authKeys,
    {
      includeSessionId: Boolean(sessionId)
    }
  );

  if (!isSafeEqualBase64Url(expectedSignature, signature)) {
    return null;
  }

  return {
    createdAt,
    expiresAt,
    loginsPath: String(session.loginsPath || ""),
    remoteAddress,
    sessionId,
    sessionVerifier,
    signature,
    userAgent,
    username
  };
}

function createPersistedSessionRecord({ req, requestInfo, sessionId, sessionVerifier, username }, authKeys) {
  const resolvedRequestInfo = resolveRequestInfo({
    req,
    requestInfo
  });
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const remoteAddress = resolvedRequestInfo.remoteAddress;
  const userAgent = resolvedRequestInfo.userAgent;

  return {
    createdAt,
    expiresAt,
    remoteAddress,
    signature: createSessionSignature(
      {
        createdAt,
        expiresAt,
        remoteAddress,
        sessionId,
        sessionVerifier,
        userAgent,
        username
      },
      authKeys
    ),
    sessionId,
    userAgent
  };
}

function sanitizeStoredLogins(logins, username, authKeys) {
  const sanitizedLogins = {};

  Object.entries(logins || {}).forEach(([sessionVerifier, session]) => {
    const normalizedVerifier = String(sessionVerifier || "").trim();

    if (!normalizedVerifier) {
      return;
    }

    const normalizedSession = normalizeStoredSessionRecord({
      authKeys,
      session,
      sessionVerifier: normalizedVerifier,
      skipUserAgentCheck: true,
      username
    });

    if (!normalizedSession) {
      return;
    }

    sanitizedLogins[normalizedVerifier] = {
      createdAt: normalizedSession.createdAt,
      expiresAt: normalizedSession.expiresAt,
      remoteAddress: normalizedSession.remoteAddress,
      sessionId: normalizedSession.sessionId,
      signature: normalizedSession.signature,
      userAgent: normalizedSession.userAgent
    };
  });

  return sanitizedLogins;
}

export function createAuthService(options = {}) {
  const authKeys = loadAuthKeys(options.projectRoot);
  const stateSystem =
    options.stateSystem &&
    typeof options.stateSystem === "object" &&
    !Array.isArray(options.stateSystem) &&
    typeof options.stateSystem.setEntry === "function" &&
    typeof options.stateSystem.takeEntry === "function"
      ? options.stateSystem
      : null;

  if (!stateSystem) {
    throw new Error("createAuthService() requires a shared state system.");
  }

  const projectRoot = String(options.projectRoot || "");
  const runtimeParams = options.runtimeParams || null;
  const watchdog = options.watchdog || null;
  const challengeStore = createStateBackedLoginChallengeStore(stateSystem);
  const commitProjectPathChanges =
    typeof options.commitProjectPathChanges === "function"
      ? options.commitProjectPathChanges
      : async (projectPaths = []) => {
          if (watchdog && typeof watchdog.applyProjectPathChanges === "function") {
            await watchdog.applyProjectPathChanges(projectPaths);
          }
        };
  const enableInitialization = options.enableInitialization !== false;
  const ensureUserAuthState =
    typeof options.ensureUserAuthState === "function" ? options.ensureUserAuthState : async () => {};
  const loadedAuthStateUsers = new Set();
  const normalizedAuthUsers = new Set();
  let initialized = false;

  function getUserIndex() {
    if (!watchdog || typeof watchdog.getIndex !== "function") {
      return createEmptyUserIndex();
    }

    return watchdog.getIndex("user_index") || createEmptyUserIndex();
  }

  async function normalizeUserAuthFiles(username) {
    const normalizedUsername = normalizeEntityId(username);

    if (!normalizedUsername) {
      return false;
    }

    if (normalizedAuthUsers.has(normalizedUsername)) {
      return false;
    }

    normalizedAuthUsers.add(normalizedUsername);

    try {
      let changed = false;
      const changedProjectPaths = new Set();
      const passwordRecord = readUserPasswordVerifier(projectRoot, normalizedUsername, runtimeParams);
      const currentLogins = readUserLogins(projectRoot, normalizedUsername, runtimeParams);
      const passwordRecordInfo = inspectPasswordRecord(passwordRecord);
      const migratedPasswordRecord =
        passwordRecordInfo?.format === "sealed"
          ? null
          : migratePasswordVerifierRecord(passwordRecord, authKeys);
      const sanitizedLogins = sanitizeStoredLogins(
        currentLogins,
        normalizedUsername,
        authKeys
      );

      if (
        migratedPasswordRecord &&
        JSON.stringify(passwordRecord || {}) !== JSON.stringify(migratedPasswordRecord)
      ) {
        writeUserPasswordVerifier(projectRoot, normalizedUsername, migratedPasswordRecord, runtimeParams);
        recordAppPathMutations(
          {
            projectRoot,
            runtimeParams
          },
          [`/app/L2/${normalizedUsername}/meta/password.json`]
        );
        changedProjectPaths.add(`/app/L2/${normalizedUsername}/meta/password.json`);
        changed = true;
      }

      if (JSON.stringify(currentLogins || {}) !== JSON.stringify(sanitizedLogins)) {
        writeUserLogins(projectRoot, normalizedUsername, sanitizedLogins, runtimeParams);
        recordAppPathMutations(
          {
            projectRoot,
            runtimeParams
          },
          [`/app/L2/${normalizedUsername}/meta/logins.json`]
        );
        changedProjectPaths.add(`/app/L2/${normalizedUsername}/meta/logins.json`);
        changed = true;
      }

      if (changed && changedProjectPaths.size > 0) {
        await commitProjectPathChanges([...changedProjectPaths]);
      }

      return changed;
    } catch (error) {
      normalizedAuthUsers.delete(normalizedUsername);
      throw error;
    }
  }

  async function ensureUserIndexLoaded(username, options = {}) {
    const normalizedUsername = normalizeEntityId(username);

    if (!normalizedUsername) {
      return "";
    }

    const userRecord = getUserIndex().getUser(normalizedUsername);
    const shouldLoadAuthState =
      options.force === true || (!userRecord && !loadedAuthStateUsers.has(normalizedUsername));

    if (shouldLoadAuthState) {
      await ensureUserAuthState(normalizedUsername);
      loadedAuthStateUsers.add(normalizedUsername);
    }

    if (options.normalizeAuthFiles !== false) {
      await normalizeUserAuthFiles(normalizedUsername);
    }

    return normalizedUsername;
  }

  function readCurrentPasswordVerifier(username) {
    return openPasswordVerifierRecord(
      readUserPasswordVerifier(projectRoot, username, runtimeParams),
      authKeys
    );
  }

  function readCurrentUserCryptoState(username) {
    return getUserCryptoState(projectRoot, username, runtimeParams);
  }

  function buildLoginUserCryptoPayload(username) {
    const userCryptoState = readCurrentUserCryptoState(username);

    return {
      keyId: userCryptoState.keyId,
      record: buildClientUserCryptoRecord(userCryptoState.record),
      serverShare:
        userCryptoState.status === USER_CRYPTO_STATUS_READY
          ? readUserCryptoServerShare(projectRoot, username)
          : "",
      state: userCryptoState.status
    };
  }

  function persistSessionForUser(username, options = {}) {
    const normalizedUsername = normalizeEntityId(username);

    if (!normalizedUsername) {
      throw new Error("A username is required to create a session.");
    }

    const sessionToken = createSessionToken();
    const sessionId = createSessionId();
    const sessionVerifier = createSessionVerifier(sessionToken, authKeys);
    const logins = sanitizeStoredLogins(
      readUserLogins(projectRoot, normalizedUsername, runtimeParams),
      normalizedUsername,
      authKeys
    );

    logins[sessionVerifier] = createPersistedSessionRecord(
      {
        req: options.req,
        requestInfo: options.requestInfo,
        sessionId,
        sessionVerifier,
        username: normalizedUsername
      },
      authKeys
    );

    writeUserLogins(projectRoot, normalizedUsername, logins, runtimeParams);
    recordAppPathMutations(
      {
        projectRoot,
        runtimeParams
      },
      [`/app/L2/${normalizedUsername}/meta/logins.json`]
    );

    return {
      sessionId,
      sessionToken,
      username: normalizedUsername
    };
  }

  async function resolveUserFromCookies(cookies = {}, headers = {}) {
    if (isSingleUserApp(runtimeParams)) {
      await ensureUserIndexLoaded(SINGLE_USER_APP_USERNAME);
      return createSingleUser();
    }

    const rawSessionToken = String(cookies[SESSION_COOKIE_NAME] || "").trim();

    if (!rawSessionToken) {
      return createAnonymousUser();
    }

    const parsedSessionCookie = parseSessionCookieValue(rawSessionToken);
    const sessionToken = parsedSessionCookie.sessionToken;
    const usernameHint = parsedSessionCookie.username;

    if (!sessionToken) {
      return createAnonymousUser({
        sessionToken: rawSessionToken,
        shouldClearSessionCookie: true,
        source: "invalid-session-cookie-format"
      });
    }

    if (!usernameHint) {
      return createAnonymousUser({
        sessionToken,
        shouldClearSessionCookie: true,
        source: "missing-session-username"
      });
    }

    await ensureUserIndexLoaded(usernameHint);

    const userIndex = getUserIndex();
    const sessionVerifier = createSessionVerifier(sessionToken, authKeys);
    const session = userIndex.getSession(sessionVerifier);

    if (!session) {
      return createAnonymousUser({
        sessionToken,
        shouldClearSessionCookie: true,
        source: "invalid-session-cookie"
      });
    }

    const username = normalizeEntityId(session.username);
    const userRecord = userIndex.getUser(username);

    if (!username || !userRecord) {
      return createAnonymousUser({
        sessionToken,
        shouldClearSessionCookie: true,
        source: "stale-session-cookie"
      });
    }

    const normalizedSession = normalizeStoredSessionRecord({
      authKeys,
      session,
      sessionVerifier,
      username
    });

    if (!normalizedSession) {
      return createAnonymousUser({
        sessionToken,
        shouldClearSessionCookie: true,
        source: "rejected-session-cookie"
      });
    }

    return {
      isAuthenticated: true,
      session: normalizedSession,
      sessionToken,
      shouldClearSessionCookie: false,
      source: "session-cookie",
      username
    };
  }

  async function createLoginChallenge({ req, requestInfo, username, clientNonce }) {
    if (isSingleUserApp(runtimeParams)) {
      throw new Error("Password login is disabled in single-user mode.");
    }

    const resolvedRequestInfo = resolveRequestInfo({
      req,
      requestInfo
    });

    const normalizedUsername = normalizeEntityId(username);
    const normalizedClientNonce = normalizeNonce(clientNonce);
    await ensureUserIndexLoaded(normalizedUsername, {
      force: true
    });
    const userIndex = getUserIndex();
    const userRecord = userIndex.getUser(normalizedUsername);
    const verifier =
      normalizedUsername && normalizedClientNonce && userRecord?.hasPassword
        ? readCurrentPasswordVerifier(normalizedUsername)
        : null;
    const userCryptoState = verifier ? readCurrentUserCryptoState(normalizedUsername) : null;
    const userCryptoProvisioningShare =
      userCryptoState?.status === "missing" ? createUserCryptoServerShare() : "";

    if (!normalizedUsername || !normalizedClientNonce || !verifier) {
      throw new Error("Invalid username or password.");
    }

    const serverNonce = createChallengeToken();
    const createdAtMs = Date.now();
    const challengeToken = createChallengeToken();

    await challengeStore.storeLoginChallenge({
      challengeToken,
      clientNonce: normalizedClientNonce,
      createdAtMs,
      serverNonce,
      userCryptoProvisioningShare,
      userCryptoStatus: userCryptoState?.status || "missing",
      userAgent: resolvedRequestInfo.userAgent,
      username: normalizedUsername
    });

    return {
      challengeToken,
      iterations: Number(verifier.iterations),
      passwordScheme: verifier.scheme,
      salt: verifier.salt,
      serverNonce,
      userCrypto: {
        provisioningShare: userCryptoProvisioningShare,
        record: buildClientUserCryptoRecord(userCryptoState?.record),
        state: userCryptoState?.status || "missing"
      }
    };
  }

  async function completeLogin({ challengeToken, clientProof, req, requestInfo, userCryptoProvisioning }) {
    if (isSingleUserApp(runtimeParams)) {
      throw new Error("Password login is disabled in single-user mode.");
    }

    const resolvedRequestInfo = resolveRequestInfo({
      req,
      requestInfo
    });

    const normalizedChallengeToken = String(challengeToken || "").trim();
    const challenge = await challengeStore.consumeLoginChallenge(normalizedChallengeToken);

    if (!challenge) {
      throw new Error("Login challenge expired. Try again.");
    }

    await ensureUserIndexLoaded(challenge.username);

    const verifier = getUserIndex().getUser(challenge.username)?.hasPassword
      ? readCurrentPasswordVerifier(challenge.username)
      : null;

    if (!verifier) {
      throw new Error("Invalid username or password.");
    }

    if (challenge.userAgent !== resolvedRequestInfo.userAgent) {
      throw new Error("Login challenge no longer matches this browser.");
    }

    const loginResult = verifyLoginProof({
      challengeToken: normalizedChallengeToken,
      clientNonce: challenge.clientNonce,
      clientProof,
      serverNonce: challenge.serverNonce,
      username: challenge.username,
      verifier
    });

    if (!loginResult.ok) {
      throw new Error("Invalid username or password.");
    }

    if (challenge.userCryptoStatus === "missing") {
      const provisioningRecord =
        userCryptoProvisioning &&
        typeof userCryptoProvisioning === "object" &&
        !Array.isArray(userCryptoProvisioning)
          ? userCryptoProvisioning.record || userCryptoProvisioning
          : null;

      if (!provisioningRecord || !challenge.userCryptoProvisioningShare) {
        throw new Error("Login requires user crypto provisioning. Try again.");
      }

      provisionUserCrypto(projectRoot, challenge.username, {
        record: provisioningRecord,
        runtimeParams,
        serverShare: challenge.userCryptoProvisioningShare
      });
    }

    const session = persistSessionForUser(challenge.username, {
      requestInfo: resolvedRequestInfo
    });

    return {
      serverSignature: loginResult.serverSignature,
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      userCrypto: buildLoginUserCryptoPayload(challenge.username),
      username: challenge.username
    };
  }

  async function issueSessionForUser({ username, req, requestInfo } = {}) {
    if (isSingleUserApp(runtimeParams)) {
      return {
        sessionId: "",
        sessionToken: "",
        username: SINGLE_USER_APP_USERNAME
      };
    }

    await ensureUserIndexLoaded(username);

    return persistSessionForUser(username, {
      req,
      requestInfo
    });
  }

  async function revokeSession(sessionToken, username = "") {
    if (isSingleUserApp(runtimeParams)) {
      return false;
    }

    const normalizedSessionToken = normalizeSessionToken(sessionToken);
    const normalizedUsername = normalizeEntityId(username);

    if (!normalizedSessionToken || !normalizedUsername) {
      return false;
    }

    const sessionVerifier = createSessionVerifier(normalizedSessionToken, authKeys);
    const logins = sanitizeStoredLogins(
      readUserLogins(projectRoot, normalizedUsername, runtimeParams),
      normalizedUsername,
      authKeys
    );

    if (!Object.prototype.hasOwnProperty.call(logins, sessionVerifier)) {
      return false;
    }

    delete logins[sessionVerifier];
    writeUserLogins(projectRoot, normalizedUsername, logins, runtimeParams);
    recordAppPathMutations(
      {
        projectRoot,
        runtimeParams
      },
      [`/app/L2/${normalizedUsername}/meta/logins.json`]
    );

    return true;
  }

  function getUserCryptoSessionStorageKey(requestUser) {
    if (isSingleUserApp(runtimeParams)) {
      return "";
    }

    const authenticatedUser = getAuthenticatedUser(requestUser);
    return createUserCryptoSessionStorageKey(authenticatedUser?.session?.sessionId, authKeys);
  }

  function changePassword({ currentPassword, newPassword, requestUser, userCryptoRecord }) {
    if (isSingleUserApp(runtimeParams)) {
      throw createStatusError("Password login is disabled in single-user mode.", 403);
    }

    const authenticatedUser = getAuthenticatedUser(requestUser);
    const normalizedUsername = normalizeEntityId(authenticatedUser.username);
    const verifier = normalizedUsername ? readCurrentPasswordVerifier(normalizedUsername) : null;
    const userCryptoState = normalizedUsername ? readCurrentUserCryptoState(normalizedUsername) : null;

    if (!verifier || !verifyPassword(currentPassword, verifier)) {
      throw createStatusError("Current password is incorrect.", 401);
    }

    if (userCryptoState?.status === USER_CRYPTO_STATUS_READY && !userCryptoRecord) {
      throw createStatusError("Current login must rewrap user crypto before changing the password.", 400);
    }

    setUserPassword(projectRoot, normalizedUsername, newPassword, {
      invalidateUserCrypto: false,
      runtimeParams,
      userCryptoRecord:
        userCryptoState?.status === USER_CRYPTO_STATUS_READY ? userCryptoRecord : null
    });

    return {
      username: normalizedUsername
    };
  }

  function generatePasswordVerifier(password) {
    return createPasswordVerifier(password, authKeys);
  }

  async function initialize() {
    if (initialized) {
      return;
    }

    initialized = true;

    if (!enableInitialization) {
      return;
    }

    const userIndex = getUserIndex();
    const usernames = Object.keys(userIndex.users || {});

    for (const username of usernames) {
      await normalizeUserAuthFiles(username);
    }
  }

  function getAuthenticatedUser(requestUser) {
    if (requestUser && requestUser.isAuthenticated) {
      return requestUser;
    }

    throw new Error("Authentication required.");
  }

  async function storeAnthropicOauthState(stateToken, value) {
    const normalizedStateToken = String(stateToken || "").trim();
    if (!normalizedStateToken) {
      throw new Error("Anthropic OAuth state token is required.");
    }
    const payload =
      value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
    await stateSystem.setEntry(
      ANTHROPIC_OAUTH_STATE_AREA,
      normalizedStateToken,
      {
        ...payload,
        stateToken: normalizedStateToken
      },
      {
        expiresInMs: ANTHROPIC_OAUTH_STATE_TTL_MS,
        replicate: false
      }
    );
  }

  async function consumeAnthropicOauthState(stateToken) {
    const normalizedStateToken = String(stateToken || "").trim();
    if (!normalizedStateToken) {
      return null;
    }
    const entry = await stateSystem.takeEntry(ANTHROPIC_OAUTH_STATE_AREA, normalizedStateToken);
    const value =
      entry?.value && typeof entry.value === "object" && !Array.isArray(entry.value)
        ? entry.value
        : null;
    return value ? { ...value } : null;
  }

  return {
    changePassword,
    completeLogin,
    consumeAnthropicOauthState,
    createClearedSessionCookieHeader,
    createLoginChallenge,
    createSessionCookieHeader,
    generatePasswordVerifier,
    getAuthenticatedUser,
    getUserCryptoSessionStorageKey,
    getUserIndex,
    initialize,
    issueSessionForUser,
    revokeSession,
    resolveUserFromCookies,
    storeAnthropicOauthState
  };
}

export {
  CHALLENGE_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createClearedSessionCookieHeader,
  createSessionCookieHeader
};
