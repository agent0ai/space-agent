import { buildProxyUrl, isProxyableExternalUrl } from "./proxy-url.js";
import {
  applyStateVersionRequestHeader,
  observeStateVersionFromResponse
} from "./state-version.js";
import { getConfiguredModuleMaxLayer } from "./moduleResolution.js";

const FETCH_PROXY_MARKER = Symbol.for("space.fetch-proxy-installed");
const RETRYABLE_STATE_SYNC_ERROR = "Server state is still synchronizing. Retry the request.";
const STATE_SYNC_RETRY_DELAY_MS = 100;
const STATE_SYNC_RETRY_MAX_ATTEMPTS = 3;
// Persist the proxy-fallback origin set in localStorage so a known-CORS-blocked
// origin (e.g. `https://chatgpt.com` for the OpenAI Codex provider, the
// inference-API host of a polling status widget) routes directly through
// `/api/proxy` from the *first* fetch of every page load instead of paying
// one failed-direct-fetch + DevTools-console error per session start.
// Stale entries are dropped after 7 days to let recovered upstreams (a service
// that finally adds `Access-Control-Allow-Origin`) leave the cache naturally.
const FETCH_PROXY_FALLBACK_ORIGINS_STORAGE_KEY = "space.framework.proxy-fallback-origins";
const FETCH_PROXY_FALLBACK_ORIGIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const proxyFallbackOrigins = new Map();

function requestCanHaveBody(method) {
  return !["GET", "HEAD"].includes(String(method || "GET").toUpperCase());
}

function waitForRetryDelay(delayMs, signal) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener?.("abort", handleAbort);
      resolve();
    }, delayMs);

    function handleAbort() {
      clearTimeout(timeoutId);
      reject(signal.reason || new DOMException("The operation was aborted.", "AbortError"));
    }

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener?.("abort", handleAbort, { once: true });
  });
}

function getProxyFallbackOriginKey(targetUrl) {
  return new URL(targetUrl, window.location.href).origin;
}

function getProxyFallbackOriginStorage() {
  try {
    return window.localStorage;
  } catch {
    // Some sandboxed contexts throw on `window.localStorage` access. Falling
    // back to in-memory only is acceptable here — origin caching is an
    // optimisation, not a correctness requirement.
    return null;
  }
}

function loadPersistedProxyFallbackOrigins() {
  const storage = getProxyFallbackOriginStorage();

  if (!storage) {
    return;
  }

  let raw;
  try {
    raw = storage.getItem(FETCH_PROXY_FALLBACK_ORIGINS_STORAGE_KEY);
  } catch {
    return;
  }

  if (!raw) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt entry: clear it so we don't repeatedly try to parse the same
    // garbage on every page load.
    try {
      storage.removeItem(FETCH_PROXY_FALLBACK_ORIGINS_STORAGE_KEY);
    } catch {}
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }

  const now = Date.now();
  Object.entries(parsed).forEach(([origin, lastSeenAt]) => {
    if (typeof origin !== "string" || !origin) {
      return;
    }

    const timestamp = Number.isFinite(Number(lastSeenAt)) ? Number(lastSeenAt) : 0;

    if (timestamp <= 0 || now - timestamp > FETCH_PROXY_FALLBACK_ORIGIN_TTL_MS) {
      return;
    }

    proxyFallbackOrigins.set(origin, timestamp);
  });
}

function persistProxyFallbackOrigins() {
  const storage = getProxyFallbackOriginStorage();

  if (!storage) {
    return;
  }

  if (proxyFallbackOrigins.size === 0) {
    try {
      storage.removeItem(FETCH_PROXY_FALLBACK_ORIGINS_STORAGE_KEY);
    } catch {}
    return;
  }

  const payload = Object.fromEntries(proxyFallbackOrigins.entries());

  try {
    storage.setItem(FETCH_PROXY_FALLBACK_ORIGINS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / disabled-storage failures are non-fatal: the in-memory Map
    // still serves the rest of the page lifetime.
  }
}

function hasProxyFallbackOrigin(targetUrl) {
  const origin = getProxyFallbackOriginKey(targetUrl);
  const lastSeenAt = proxyFallbackOrigins.get(origin);

  if (!Number.isFinite(lastSeenAt)) {
    return false;
  }

  if (Date.now() - lastSeenAt > FETCH_PROXY_FALLBACK_ORIGIN_TTL_MS) {
    // TTL expired since the last touch on this origin. Drop it and force the
    // next fetch to re-test the upstream directly so a recovered server
    // (one that finally added `Access-Control-Allow-Origin`) can leave the
    // cache naturally.
    proxyFallbackOrigins.delete(origin);
    persistProxyFallbackOrigins();
    return false;
  }

  return true;
}

function rememberProxyFallbackOrigin(targetUrl) {
  proxyFallbackOrigins.set(getProxyFallbackOriginKey(targetUrl), Date.now());
  persistProxyFallbackOrigins();
}

loadPersistedProxyFallbackOrigins();

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

async function isRetryableStateSyncResponse(request, response) {
  if (!isSameOriginRequest(request.url) || response.status !== 503) {
    return false;
  }

  if (String(response.headers.get("Retry-After") || "").trim() !== "0") {
    return false;
  }

  const detail = await response.clone().text().catch(() => "");
  return detail.includes(RETRYABLE_STATE_SYNC_ERROR);
}

async function fetchSameOriginWithStateSyncRetry(originalFetch, request) {
  const retrySource = request.clone();
  let response = null;

  for (let attempt = 0; attempt < STATE_SYNC_RETRY_MAX_ATTEMPTS; attempt += 1) {
    const attemptRequest = attempt === 0 ? request : retrySource.clone();
    response = await originalFetch(attemptRequest);
    observeStateVersionFromResponse(response);

    if (!(await isRetryableStateSyncResponse(attemptRequest, response))) {
      return response;
    }

    if (attempt >= STATE_SYNC_RETRY_MAX_ATTEMPTS - 1) {
      return response;
    }

    await waitForRetryDelay(STATE_SYNC_RETRY_DELAY_MS * (attempt + 1), attemptRequest.signal);
  }

  return response;
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
      return fetchSameOriginWithStateSyncRetry(originalFetch, request);
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
  proxiedFetch.clearProxyFallbackOrigins = () => {
    proxyFallbackOrigins.clear();
    persistProxyFallbackOrigins();
  };
  proxiedFetch[FETCH_PROXY_MARKER] = true;

  window.fetch = proxiedFetch;
  return proxiedFetch;
}
