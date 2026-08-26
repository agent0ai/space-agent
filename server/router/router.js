import { URL } from "node:url";

import {
  createRequestContext,
  ensureAuthenticatedRequestContext,
  parseCookieHeader,
  runWithRequestContext
} from "./request_context.js";
import { handlePageRequest } from "./pages_handler.js";
import { proxyExternalRequest } from "./proxy.js";
import { sendApiResult, sendJson } from "./responses.js";
import { applyApiCorsHeaders, handleApiPreflight } from "./cors.js";
import { handleModuleRequest } from "./mod_handler.js";
import { handleAppFetchRequest } from "./app_fetch_handler.js";
import { readParsedRequestBody } from "./request_body.js";
import { resolveProjectVersion } from "../lib/utils/project_version.js";
import {
  STATE_VERSION_HEADER,
  normalizeStateVersionHeaderValue
} from "../runtime/state_system.js";

const STATE_WORKER_HEADER = "Space-Worker";
const STATE_VERSION_COOKIE_NAME = "space_state_version";
const STATE_VERSION_WAIT_TIMEOUT_MS = 1_000;

function createParamsObject(searchParams) {
  const params = Object.create(null);

  for (const [key, value] of searchParams.entries()) {
    if (params[key] === undefined) {
      params[key] = value;
      continue;
    }

    if (Array.isArray(params[key])) {
      params[key].push(value);
      continue;
    }

    params[key] = [params[key], value];
  }

  return params;
}

function resolveApiModule(apiRegistry, pathname) {
  const match = pathname.match(/^\/api\/([a-z0-9_-]+)$/i);
  if (!match) {
    return null;
  }

  return apiRegistry.get(match[1]) || null;
}

function getAllowedMethods(apiModule) {
  return Object.keys(apiModule.handlers)
    .map((method) => method.toUpperCase())
    .sort();
}

function normalizeApiErrorStatusCode(error) {
  const statusCode = Number(error && error.statusCode);

  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }

  return 500;
}

function shouldLogApiError(statusCode) {
  return statusCode >= 500;
}

async function handleApiModuleRequest(req, res, requestUrl, apiModule, contextOptions) {
  const methodName = String(req.method || "GET").toUpperCase();
  const handler = apiModule.handlers[methodName.toLowerCase()];

  applyApiCorsHeaders(res);

  if (!handler) {
    sendJson(
      res,
      405,
      {
        error: `Method ${methodName} is not supported for ${apiModule.endpointName}`
      },
      {
        Allow: getAllowedMethods(apiModule).join(", "),
      }
    );
    return;
  }

  let parsedRequest;

  try {
    parsedRequest = await readParsedRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: `Invalid request body: ${error.message}`
    });
    return;
  }

  const params = createParamsObject(requestUrl.searchParams);
  let result;

  try {
    result = await handler({
      ...contextOptions,
      body: parsedRequest.body,
      endpointName: apiModule.endpointName,
      headers: req.headers,
      method: methodName,
      params,
      query: params,
      rawBody: parsedRequest.rawBody,
      req,
      requestContext: contextOptions.requestContext,
      requestUrl,
      res
    });
  } catch (error) {
    const statusCode = normalizeApiErrorStatusCode(error);

    if (shouldLogApiError(statusCode)) {
      console.error(`[api] ${methodName} /api/${apiModule.endpointName} failed (${statusCode}).`);
      console.error(error?.cause || error);
    }

    sendJson(res, statusCode, {
      error: statusCode >= 500 ? "Internal server error" : error.message
    });
    return;
  }

  await sendApiResult(res, result);
}

function sendUnauthorized(res, requestContext, auth) {
  sendJson(
    res,
    401,
    {
      error: "Authentication required"
    },
    requestContext?.user?.shouldClearSessionCookie &&
      auth &&
      typeof auth.createClearedSessionCookieHeader === "function"
      ? {
          "Set-Cookie": auth.createClearedSessionCookieHeader()
        }
      : {}
  );
}

function ensureAuthenticatedOrRespond(res, requestContext, auth) {
  try {
    ensureAuthenticatedRequestContext(requestContext);
    return true;
  } catch {
    sendUnauthorized(res, requestContext, auth);
    return false;
  }
}

function installStateResponseHeaders(res, stateSync, workerNumber) {
  const normalizedWorkerNumber = Math.floor(Number(workerNumber));

  if (!stateSync || typeof stateSync.getVersion !== "function") {
    if (!res.headersSent && Number.isFinite(normalizedWorkerNumber) && normalizedWorkerNumber >= 0) {
      res.setHeader(STATE_WORKER_HEADER, String(normalizedWorkerNumber));
    }

    return;
  }

  const originalWriteHead = res.writeHead.bind(res);

  res.writeHead = function patchedWriteHead(...args) {
    if (!res.headersSent) {
      res.setHeader(STATE_VERSION_HEADER, String(Number(stateSync.getVersion()) || 0));

      if (Number.isFinite(normalizedWorkerNumber) && normalizedWorkerNumber >= 0) {
        res.setHeader(STATE_WORKER_HEADER, String(normalizedWorkerNumber));
      }
    }

    return originalWriteHead(...args);
  };
}

async function waitForRequestedStateVersion(req, res, stateSync) {
  if (!stateSync || typeof stateSync.waitForVersion !== "function") {
    return {
      satisfied: true,
      usedStateVersionCookie: false
    };
  }

  const requestedVersionFromHeader = normalizeStateVersionHeaderValue(
    req?.headers?.[String(STATE_VERSION_HEADER).toLowerCase()]
  );
  const requestedVersionFromCookie = normalizeStateVersionHeaderValue(
    parseCookieHeader(req?.headers?.cookie)?.[STATE_VERSION_COOKIE_NAME]
  );
  const usedStateVersionCookie = requestedVersionFromHeader <= 0 && requestedVersionFromCookie > 0;
  const requestedVersion =
    requestedVersionFromHeader > 0 ? requestedVersionFromHeader : requestedVersionFromCookie;

  if (requestedVersion <= 0) {
    return {
      satisfied: true,
      usedStateVersionCookie: false
    };
  }

  const waitResult = await stateSync.waitForVersion(requestedVersion, {
    timeoutMs: STATE_VERSION_WAIT_TIMEOUT_MS
  });

  if (waitResult?.satisfied) {
    return {
      satisfied: true,
      usedStateVersionCookie
    };
  }

  sendJson(
    res,
    503,
    {
      error: "Server state is still synchronizing. Retry the request."
    },
    {
      "Retry-After": "0"
    }
  );

  return {
    satisfied: false,
    usedStateVersionCookie
  };
}

function appendSetCookieHeader(res, value) {
  if (!value) {
    return;
  }

  const existingValue = res.getHeader("Set-Cookie");

  if (existingValue === undefined) {
    res.setHeader("Set-Cookie", value);
    return;
  }

  if (Array.isArray(existingValue)) {
    res.setHeader("Set-Cookie", [...existingValue, value]);
    return;
  }

  res.setHeader("Set-Cookie", [existingValue, value]);
}

function isSecureRequest(req) {
  if (req?.socket?.encrypted) {
    return true;
  }

  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto === "https";
}

function createClearedStateVersionCookieHeader(req) {
  const parts = [
    `${encodeURIComponent(STATE_VERSION_COOKIE_NAME)}=`,
    "Max-Age=0",
    "Path=/",
    "SameSite=Lax"
  ];

  if (isSecureRequest(req)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createRequestHandler(options) {
  const {
    apiDir,
    apiRegistry,
    appDir,
    assetDir,
    auth,
    ensureUserFileIndex,
    host,
    mutationSync,
    pagesDir,
    port,
    projectVersion: providedProjectVersion,
    projectRoot,
    runtimeParams,
    stateSystem,
    stateSync,
    workerNumber,
    watchdog
  } = options;
  const projectVersion =
    providedProjectVersion === undefined
      ? resolveProjectVersion(projectRoot)
      : String(providedProjectVersion || "");

  return async function requestHandler(req, res) {
    installStateResponseHeaders(res, stateSync, workerNumber);
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

    const stateVersionWait = await waitForRequestedStateVersion(req, res, stateSync);

    if (!stateVersionWait.satisfied) {
      return;
    }

    if (stateVersionWait.usedStateVersionCookie) {
      appendSetCookieHeader(res, createClearedStateVersionCookieHeader(req));
    }

    const requestContext = await createRequestContext({
      auth,
      ensureUserFileIndex,
      req,
      requestUrl
    });

    return runWithRequestContext(requestContext, async () => {
      if (requestUrl.pathname.startsWith("/api/") && handleApiPreflight(req, res)) {
        return;
      }

      if (requestUrl.pathname === "/api/proxy") {
        if (!ensureAuthenticatedOrRespond(res, requestContext, auth)) {
          return;
        }

        await proxyExternalRequest(req, res, requestUrl);
        return;
      }

      const apiModule = resolveApiModule(apiRegistry, requestUrl.pathname);
      if (apiModule) {
        if (!apiModule.allowAnonymous && !ensureAuthenticatedOrRespond(res, requestContext, auth)) {
          return;
        }

        await handleApiModuleRequest(req, res, requestUrl, apiModule, {
          apiDir,
          appDir,
          auth,
          assetDir,
          watchdog,
          host,
          mutationSync,
          port,
          projectRoot,
          runtimeParams,
          stateSystem,
          ensureUserFileIndex,
          requestContext,
          user: requestContext.user
        });
        return;
      }

      if (requestUrl.pathname.startsWith("/mod/")) {
        if (!ensureAuthenticatedOrRespond(res, requestContext, auth)) {
          return;
        }
        await handleModuleRequest(res, requestUrl.pathname, {
          ensureUserFileIndex,
          headers: req.headers,
          projectRoot,
          requestUrl,
          runtimeParams,
          stateSystem,
          username: requestContext.user.username,
        });
        return;
      }

      if (requestUrl.pathname.startsWith("/~/") || /^\/(L0|L1|L2)\//.test(requestUrl.pathname)) {
        if (!ensureAuthenticatedOrRespond(res, requestContext, auth)) {
          return;
        }
        await handleAppFetchRequest(res, requestUrl.pathname, {
          ensureUserFileIndex,
          projectRoot,
          runtimeParams,
          username: requestContext.user.username,
          watchdog
        });
        return;
      }

      await handlePageRequest(res, requestUrl, {
        auth,
        mutationSync,
        pagesDir,
        projectVersion,
        runtimeParams,
        requestContext
      });
    });
  };
}

export { createRequestHandler };
