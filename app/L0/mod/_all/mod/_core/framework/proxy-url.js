const DEFAULT_PROXY_PATH = "/api/proxy";

function normalizeUrl(value) {
  return value instanceof URL ? value : new URL(value, window.location.href);
}

export function isProxyableExternalUrl(value) {
  const url = normalizeUrl(value);

  if (!["http:", "https:"].includes(url.protocol)) {
    return false;
  }

  return url.origin !== window.location.origin;
}

export function buildProxyUrl(targetUrl, options = {}) {
  const url = normalizeUrl(targetUrl);

  if (!isProxyableExternalUrl(url)) {
    return url.toString();
  }

  const proxyPath = options.proxyPath || DEFAULT_PROXY_PATH;
  const proxyUrl = new URL(proxyPath, window.location.origin);

  proxyUrl.searchParams.set("url", url.toString());

  if (options.cacheBust) {
    proxyUrl.searchParams.set("_", String(options.cacheBust));
  }

  return proxyUrl.toString();
}
