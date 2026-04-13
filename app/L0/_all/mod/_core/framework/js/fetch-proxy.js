import { buildProxyUrl, isProxyableExternalUrl } from "./proxy-url.js";
import {
  applyStateVersionRequestHeader,
  observeStateVersionFromResponse
} from "./state-version.js";
import { getConfiguredModuleMaxLayer } from "./moduleResolution.js";

const FETCH_PROXY_MARKER = Symbol.for("space.fetch-proxy-installed");
const proxyFallbackOrigins = new Set();

function requestCanHaveBody(method) {
  return !["GET", "HEAD"].includes(String(method || "GET").toUpperCase());
}

function getProxyFallbackOriginKey(targetUrl) {
  return new URL(targetUrl, window.location.href).origin;
}

function hasProxyFallbackOrigin(targetUrl) {
  return proxyFallbackOrigins.has(getProxyFallbackOriginKey(targetUrl));
}

function rememberProxyFallbackOrigin(targetUrl) {
  proxyFallbackOrigins.add(getProxyFallbackOriginKey(targetUrl));
}

function requestSupportsProxyFallback(request) {
  const mode = String(request.mode || "cors").toLowerCase();
  return !["no-cors", "same-origin"].includes(mode);
}

function shouldRetryViaProxy(request, error) {
  if (!requestSupportsProxyFallback(request)) {
    return false;
  }

  if (request.signal?.aborted || error?.name === "AbortError") {
    return false;
  }

  return error instanceof TypeError || error?.name === "TypeError";
}

async function buildProxiedFetchArgs(request, proxyPath) {
  const proxyUrl = buildProxyUrl(request.url, { proxyPath });
  const headers = new Headers(request.headers);
  applyStateVersionRequestHeader(headers);
  const init = {
    method: request.method,
    headers,
    redirect: "follow",
    credentials: "same-origin",
    signal: request.signal
  };

  if (requestCanHaveBody(request.method)) {
    init.body = await request.arrayBuffer();
  }

  return [proxyUrl, init];
}

async function fetchViaProxy(originalFetch, request, proxyPath) {
  const [proxyUrl, proxyInit] = await buildProxiedFetchArgs(request, proxyPath);
  const response = await originalFetch(proxyUrl, proxyInit);
  observeStateVersionFromResponse(response);
  return response;
}

function isSameOriginRequest(targetUrl) {
  return new URL(targetUrl, window.location.href).origin === window.location.origin;
}

function isModuleRequest(targetUrl) {
  return new URL(targetUrl, window.location.href).pathname.startsWith("/mod/");
}

function withStateVersionHeader(request) {
  if (!isSameOriginRequest(request.url)) {
    return request;
  }

  const headers = new Headers(request.headers);
  applyStateVersionRequestHeader(headers);

  if (isModuleRequest(request.url)) {
    const maxLayer = getConfiguredModuleMaxLayer();

    if (maxLayer !== null && !headers.has("X-Space-Max-Layer")) {
      headers.set("X-Space-Max-Layer", String(maxLayer));
    }
  }

  return new Request(request, {
    headers
  });
}

export function installFetchProxy(options = {}) {
  const proxyPath = options.proxyPath || "/api/proxy";
  const currentFetch = window.fetch;

  if (currentFetch[FETCH_PROXY_MARKER]) {
    return currentFetch;
  }

  const originalFetch = currentFetch.bind(window);

  async function proxiedFetch(input, init) {
    const request = withStateVersionHeader(new Request(input, init));

    if (!isProxyableExternalUrl(request.url)) {
      const response = await originalFetch(request);
      observeStateVersionFromResponse(response);
      return response;
    }

    if (requestSupportsProxyFallback(request) && hasProxyFallbackOrigin(request.url)) {
      return fetchViaProxy(originalFetch, request, proxyPath);
    }

    const fallbackRequest = request.clone();

    try {
      return await originalFetch(request);
    } catch (error) {
      if (!shouldRetryViaProxy(request, error)) {
        throw error;
      }

      // The browser only exposes blocked cross-origin fetches as generic TypeErrors.
      // Cache the origin only after the backend retry succeeds.
      try {
        const response = await fetchViaProxy(originalFetch, fallbackRequest, proxyPath);
        rememberProxyFallbackOrigin(fallbackRequest.url);
        return response;
      } catch (proxyError) {
        if (proxyError && typeof proxyError === "object" && proxyError.cause === undefined) {
          proxyError.cause = error;
        }

        throw proxyError;
      }
    }
  }

  proxiedFetch.originalFetch = originalFetch;
  proxiedFetch.hasProxyFallbackOrigin = hasProxyFallbackOrigin;
  proxiedFetch.rememberProxyFallbackOrigin = rememberProxyFallbackOrigin;
  proxiedFetch.clearProxyFallbackOrigins = () => proxyFallbackOrigins.clear();
  proxiedFetch[FETCH_PROXY_MARKER] = true;

  window.fetch = proxiedFetch;
  return proxiedFetch;
}
