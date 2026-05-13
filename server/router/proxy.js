import { Readable } from "node:stream";

import { applyApiCorsHeaders } from "./cors.js";
import { readRequestBody, requestCanHaveBody } from "./request_body.js";
import { sendJson } from "./responses.js";

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

const PROXY_TARGET_HEADER = "x-space-target-url";
const PROXY_RESPONSE_TARGET_HEADER = "x-space-proxy-target-url";
const PROXY_RESPONSE_FINAL_HEADER = "x-space-proxy-final-url";
const PROXY_RESPONSE_REDIRECTED_HEADER = "x-space-proxy-redirected";

// Default upstream-fetch timeout for `/api/proxy` calls, in seconds. The
// runtime fetch implementation (undici) imposes its own `headersTimeout` of
// 300 seconds by default, which is too tight for upstream services that
// stall before producing response headers — most importantly long
// prompt-prefill phases on local LLM servers (llama.cpp, qwen serve, vLLM)
// where the upstream stays silent for minutes during PP on long-context
// conversations. Raise the default to 15 minutes so cold-cache replies are
// not cut off by the proxy itself; operators can shorten it with
// `PROXY_REQUEST_TIMEOUT_SECONDS=N` or disable the timeout entirely with
// `PROXY_REQUEST_TIMEOUT_SECONDS=0`.
const PROXY_REQUEST_TIMEOUT_PARAM_NAME = "PROXY_REQUEST_TIMEOUT_SECONDS";
const PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS = 900;

function resolveProxyRequestTimeoutMs(runtimeParams) {
  if (!runtimeParams || typeof runtimeParams.get !== "function") {
    return PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS * 1000;
  }

  const rawValue = runtimeParams.get(PROXY_REQUEST_TIMEOUT_PARAM_NAME);

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS * 1000;
  }

  const numericValue = Number(rawValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS * 1000;
  }

  return Math.floor(numericValue * 1000);
}

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
  const clientHeaders = Object.create(null);

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

function sendProxyError(res, statusCode, message) {
  applyApiCorsHeaders(res);
  sendJson(res, statusCode, { error: message });
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

async function proxyExternalRequest(req, res, requestUrl, options = {}) {
  const targetUrlValue = getTargetUrl(requestUrl, req.headers);

  if (!targetUrlValue) {
    sendProxyError(res, 400, "Missing proxy target URL");
    return;
  }

  let targetUrl;

  try {
    targetUrl = new URL(targetUrlValue);
  } catch (error) {
    sendProxyError(res, 400, "Invalid proxy target URL");
    return;
  }

  if (!isSupportedProxyProtocol(targetUrl.protocol)) {
    sendProxyError(res, 400, "Proxy only supports http and https targets");
    return;
  }

  if (targetUrl.origin === requestUrl.origin && targetUrl.pathname === requestUrl.pathname) {
    sendProxyError(res, 400, "Proxy target cannot point back to the proxy endpoint");
    return;
  }

  const method = String(req.method || "GET").toUpperCase();
  const upstreamHeaders = createUpstreamHeaders(req.headers);
  const body = requestCanHaveBody(method) ? await readRequestBody(req) : undefined;

  // Resolve the request-scoped abort signal. The optional caller-supplied
  // timeout overrides undici's tight `headersTimeout` default so upstream
  // services that stall before producing response headers (typically LLM
  // servers during long prompt-prefill on warm-cache-miss requests) do not
  // get cut off mid-PP. A configured timeout of 0 disables the timeout
  // entirely; any other positive value applies as a wall-clock abort.
  const timeoutMs = resolveProxyRequestTimeoutMs(options.runtimeParams);
  const fetchSignal = timeoutMs > 0 && typeof AbortSignal?.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

  let upstreamResponse;

  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      body,
      redirect: "follow",
      signal: fetchSignal
    });
  } catch (error) {
    const isTimeoutError = error?.name === "TimeoutError" || error?.code === "UND_ERR_HEADERS_TIMEOUT";

    if (isTimeoutError) {
      sendProxyError(
        res,
        504,
        `Upstream did not respond within the configured proxy timeout of ${Math.round(timeoutMs / 1000)}s. ` +
          `Increase ${PROXY_REQUEST_TIMEOUT_PARAM_NAME} (or set it to 0 to disable) for slower upstreams.`
      );
      return;
    }

    sendProxyError(res, 502, `Upstream fetch failed: ${error.message}`);
    return;
  }

  const responseHeaders = createClientHeaders(upstreamResponse.headers, targetUrl, upstreamResponse);
  applyApiCorsHeaders(res);
  res.writeHead(upstreamResponse.status, responseHeaders);
  await pipeUpstreamBodyToResponse(res, upstreamResponse);
}

export {
  PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS,
  PROXY_REQUEST_TIMEOUT_PARAM_NAME,
  proxyExternalRequest,
  resolveProxyRequestTimeoutMs
};
