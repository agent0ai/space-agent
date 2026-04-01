const { Readable } = require("node:stream");
const { readRequestBody, requestCanHaveBody } = require("./request-body");

const UPSTREAM_REQUEST_HEADERS_TO_STRIP = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

const RESPONSE_HEADERS_TO_STRIP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "set-cookie",
  "set-cookie2",
  "transfer-encoding"
]);

const PROXY_TARGET_HEADER = "x-agent-one-target-url";
const PROXY_RESPONSE_TARGET_HEADER = "x-agent-one-proxy-target-url";
const PROXY_RESPONSE_FINAL_HEADER = "x-agent-one-proxy-final-url";
const PROXY_RESPONSE_REDIRECTED_HEADER = "x-agent-one-proxy-redirected";

function getTargetUrl(requestUrl, headers) {
  return requestUrl.searchParams.get("url") || headers[PROXY_TARGET_HEADER];
}

function isSupportedProxyProtocol(protocol) {
  return protocol === "http:" || protocol === "https:";
}

function createUpstreamHeaders(headers) {
  const upstreamHeaders = new Headers();

  Object.entries(headers).forEach(([name, value]) => {
    if (!value) {
      return;
    }

    const lowerName = name.toLowerCase();
    if (lowerName === PROXY_TARGET_HEADER || UPSTREAM_REQUEST_HEADERS_TO_STRIP.has(lowerName)) {
      return;
    }

    if (Array.isArray(value)) {
      upstreamHeaders.set(name, value.join(", "));
      return;
    }

    upstreamHeaders.set(name, value);
  });

  return upstreamHeaders;
}

function createClientHeaders(upstreamHeaders, targetUrl, upstreamResponse) {
  const clientHeaders = {};

  upstreamHeaders.forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (RESPONSE_HEADERS_TO_STRIP.has(lowerName)) {
      return;
    }

    clientHeaders[name] = value;
  });

  clientHeaders[PROXY_RESPONSE_TARGET_HEADER] = targetUrl.toString();
  clientHeaders[PROXY_RESPONSE_FINAL_HEADER] = upstreamResponse.url;
  clientHeaders[PROXY_RESPONSE_REDIRECTED_HEADER] = String(upstreamResponse.redirected);

  return clientHeaders;
}

function sendProxyError(res, applyApiCorsHeaders, statusCode, message) {
  applyApiCorsHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify({ error: message }, null, 2));
}

async function pipeUpstreamBodyToResponse(res, upstreamResponse) {
  if (!upstreamResponse.body) {
    res.end();
    return;
  }

  await new Promise((resolve, reject) => {
    const upstreamStream = Readable.fromWeb(upstreamResponse.body);

    upstreamStream.once("error", reject);
    res.once("error", reject);
    res.once("finish", resolve);

    upstreamStream.pipe(res);
  });
}

async function proxyExternalRequest(req, res, requestUrl, applyApiCorsHeaders) {
  const targetUrlValue = getTargetUrl(requestUrl, req.headers);

  if (!targetUrlValue) {
    sendProxyError(res, applyApiCorsHeaders, 400, "Missing proxy target URL");
    return;
  }

  let targetUrl;

  try {
    targetUrl = new URL(targetUrlValue);
  } catch (error) {
    sendProxyError(res, applyApiCorsHeaders, 400, "Invalid proxy target URL");
    return;
  }

  if (!isSupportedProxyProtocol(targetUrl.protocol)) {
    sendProxyError(res, applyApiCorsHeaders, 400, "Proxy only supports http and https targets");
    return;
  }

  if (targetUrl.origin === requestUrl.origin && targetUrl.pathname === requestUrl.pathname) {
    sendProxyError(res, applyApiCorsHeaders, 400, "Proxy target cannot point back to the proxy endpoint");
    return;
  }

  const method = String(req.method || "GET").toUpperCase();
  const upstreamHeaders = createUpstreamHeaders(req.headers);
  const body = requestCanHaveBody(method) ? await readRequestBody(req) : undefined;
  let upstreamResponse;

  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      body,
      redirect: "follow"
    });
  } catch (error) {
    sendProxyError(res, applyApiCorsHeaders, 502, `Upstream fetch failed: ${error.message}`);
    return;
  }

  const responseHeaders = createClientHeaders(upstreamResponse.headers, targetUrl, upstreamResponse);
  applyApiCorsHeaders(res);
  res.writeHead(upstreamResponse.status, responseHeaders);
  await pipeUpstreamBodyToResponse(res, upstreamResponse);
}

module.exports = {
  PROXY_TARGET_HEADER,
  PROXY_RESPONSE_FINAL_HEADER,
  PROXY_RESPONSE_REDIRECTED_HEADER,
  PROXY_RESPONSE_TARGET_HEADER,
  proxyExternalRequest
};
