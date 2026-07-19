import { AsyncLocalStorage } from "node:async_hooks";

import { normalizePathSegment } from "../lib/utils/app_files.js";

const requestContextStorage = new AsyncLocalStorage();

function createAnonymousRequestUser(overrides = {}) {
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

function normalizePrincipalId(value) {
  const normalized = normalizePathSegment(value);

  if (!normalized || normalized.includes("/")) {
    return "";
  }

  return normalized;
}

function parseCookieHeader(cookieHeader) {
  const cookies = Object.create(null);

  String(cookieHeader || "")
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const equalsIndex = entry.indexOf("=");
      const rawName = equalsIndex >= 0 ? entry.slice(0, equalsIndex) : entry;
      const rawValue = equalsIndex >= 0 ? entry.slice(equalsIndex + 1) : "";
      const name = rawName.trim();

      if (!name) {
        return;
      }

      try {
        cookies[name] = decodeURIComponent(rawValue.trim());
      } catch {
        cookies[name] = rawValue.trim();
      }
    });

  return cookies;
}

async function resolveRequestUser(headers, auth) {
  const cookies = parseCookieHeader(headers && headers.cookie);
  const user =
    auth && typeof auth.resolveUserFromCookies === "function"
      ? await auth.resolveUserFromCookies(cookies, headers)
      : createAnonymousRequestUser();

  return {
    cookies,
    user
  };
}

async function createRequestContext({ auth, ensureUserFileIndex, req, requestUrl } = {}) {
  const { cookies, user } = await resolveRequestUser(req && req.headers, auth);

  return {
    auth,
    cookies,
    ensureUserFileIndex:
      typeof ensureUserFileIndex === "function" ? ensureUserFileIndex : async () => {},
    req,
    requestUrl,
    user
  };
}

// TODO: Replace this request auth bootstrap with the future real identity system,
// including guest users, stronger session lifecycle handling, and API/file auth policies
// derived from durable identities rather than the current local login flow.

function runWithRequestContext(requestContext, callback) {
  return requestContextStorage.run(requestContext, callback);
}

function getRequestContext() {
  return requestContextStorage.getStore() || null;
}

function getRequestUser() {
  const context = getRequestContext();

  if (context && context.user) {
    return context.user;
  }

  return createAnonymousRequestUser();
}

function ensureAuthenticatedRequestContext(requestContext) {
  const user = requestContext && requestContext.user ? requestContext.user : getRequestUser();

  if (!user || !user.isAuthenticated || !normalizePrincipalId(user.username)) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    throw error;
  }

  return user;
}

export {
  createRequestContext,
  ensureAuthenticatedRequestContext,
  getRequestContext,
  getRequestUser,
  parseCookieHeader,
  runWithRequestContext
};
