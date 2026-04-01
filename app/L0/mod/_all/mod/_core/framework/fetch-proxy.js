import { buildProxyUrl, isProxyableExternalUrl } from "./proxy-url.js";

const FETCH_PROXY_MARKER = Symbol.for("agent-one.fetch-proxy-installed");

function requestCanHaveBody(method) {
  return !["GET", "HEAD"].includes(String(method || "GET").toUpperCase());
}

async function buildProxiedFetchArgs(request, proxyPath) {
  const proxyUrl = buildProxyUrl(request.url, { proxyPath });
  const headers = new Headers(request.headers);
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

export function installFetchProxy(options = {}) {
  const proxyPath = options.proxyPath || "/api/proxy";
  const currentFetch = window.fetch;

  if (currentFetch[FETCH_PROXY_MARKER]) {
    return currentFetch;
  }

  const originalFetch = currentFetch.bind(window);

  async function proxiedFetch(input, init) {
    const request = new Request(input, init);

    if (!isProxyableExternalUrl(request.url)) {
      return originalFetch(request);
    }

    const [proxyUrl, proxyInit] = await buildProxiedFetchArgs(request, proxyPath);
    return originalFetch(proxyUrl, proxyInit);
  }

  proxiedFetch.originalFetch = originalFetch;
  proxiedFetch[FETCH_PROXY_MARKER] = true;

  window.fetch = proxiedFetch;
  return proxiedFetch;
}
