import { URL } from "node:url";

import {
  createRequestContext,
  ensureAuthenticatedRequestContext,
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
    const statusCode = Number(error && error.statusCode) || 500;
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
    return true;
  }

  const requestedVersion = normalizeStateVersionHeaderValue(
    req?.headers?.[String(STATE_VERSION_HEADER).toLowerCase()]
  );

  if (requestedVersion <= 0) {
    return true;
  }

  const waitResult = await stateSync.waitForVersion(requestedVersion, {
    timeoutMs: STATE_VERSION_WAIT_TIMEOUT_MS
  });

  if (waitResult?.satisfied) {
    return true;
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

  return false;
}

function createRequestHandler(options) {
  const {
    apiDir,
    apiRegistry,
    appDir,
    assetDir,
    auth,
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

    if (!(await waitForRequestedStateVersion(req, res, stateSync))) {
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    const requestContext = createRequestContext({
      auth,
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
          requestContext,
          user: requestContext.user
        });
        return;
      }

      if (requestUrl.pathname.startsWith("/mod/")) {
        if (!ensureAuthenticatedOrRespond(res, requestContext, auth)) {
          return;
        }
        handleModuleRequest(res, requestUrl.pathname, {
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
        handleAppFetchRequest(res, requestUrl.pathname, {
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
