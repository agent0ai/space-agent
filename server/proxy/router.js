const path = require("node:path");
const { URL } = require("node:url");
const { toProjectPath } = require("../lib/file-watch/store.cjs");
const { sendApiResult, sendFile, sendJson } = require("./handlers");
const { applyApiCorsHeaders, handleApiPreflight } = require("./cors");
const { readParsedRequestBody } = require("./request-body");
const { proxyExternalRequest } = require("./service");

function resolvePathWithinRoot(rootDir, requestPath) {
  const filePath = path.resolve(rootDir, `.${requestPath}`);
  const relativePath = path.relative(rootDir, filePath);

  if (
    relativePath === "" ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return filePath;
}

function resolveStaticRequestFilePath(appDir, requestPath) {
  const normalizedPath = path.posix.normalize(requestPath === "/" ? "/index.html" : requestPath);

  if (normalizedPath.startsWith("/mod/")) {
    return resolvePathWithinRoot(path.join(appDir, "mod", "_all"), normalizedPath);
  }

  const baseName = path.posix.basename(normalizedPath);
  const isRootHtmlRequest =
    normalizedPath === `/${baseName}` && path.posix.extname(baseName).toLowerCase() === ".html";

  if (!isRootHtmlRequest) {
    return null;
  }

  return resolvePathWithinRoot(appDir, normalizedPath);
}

function createParamsObject(searchParams) {
  const params = {};

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
  const method = String(req.method || "GET").toLowerCase();
  const handler = apiModule.handlers[method];

  applyApiCorsHeaders(res);

  if (!handler) {
    res.writeHead(405, {
      Allow: getAllowedMethods(apiModule).join(", "),
      "Content-Type": "application/json; charset=utf-8"
    });
    res.end(
      JSON.stringify(
        {
          error: `Method ${String(req.method || "GET").toUpperCase()} is not supported for ${
            apiModule.endpointName
          }`
        },
        null,
        2
      )
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
  const result = await handler({
    ...contextOptions,
    body: parsedRequest.body,
    endpointName: apiModule.endpointName,
    headers: req.headers,
    method: method.toUpperCase(),
    params,
    query: params,
    rawBody: parsedRequest.rawBody,
    req,
    requestUrl,
    res
  });

  await sendApiResult(res, result);
}

function createRequestHandler(options) {
  const { apiDir, apiRegistry, appDir, assetDir, fileIndex, host, port, projectRoot } = options;

  return async function requestHandler(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

    if (requestUrl.pathname.startsWith("/api/") && handleApiPreflight(req, res)) {
      return;
    }

    if (requestUrl.pathname === "/api/proxy") {
      await proxyExternalRequest(req, res, requestUrl, applyApiCorsHeaders);
      return;
    }

    const apiModule = resolveApiModule(apiRegistry, requestUrl.pathname);
    if (apiModule) {
      await handleApiModuleRequest(req, res, requestUrl, apiModule, {
        apiDir,
        appDir,
        assetDir,
        fileIndex,
        host,
        port
      });
      return;
    }

    const filePath = resolveStaticRequestFilePath(appDir, requestUrl.pathname);

    if (!filePath) {
      sendJson(res, 404, {
        error: "File not found"
      });
      return;
    }

    const projectPath = projectRoot ? toProjectPath(projectRoot, filePath) : "";
    const knownMissing = Boolean(
      fileIndex && projectPath && fileIndex.covers(projectPath) && !fileIndex.has(projectPath)
    );

    sendFile(res, filePath, {
      knownMissing
    });
  };
}

module.exports = {
  createRequestHandler
};
