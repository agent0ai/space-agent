/**
 * @typedef {string | number | boolean | null | undefined | Array<string | number | boolean>} ApiQueryValue
 */

/**
 * @typedef {{
 *   method?: string,
 *   query?: Record<string, ApiQueryValue>,
 *   body?: unknown,
 *   headers?: Record<string, string>,
 *   signal?: AbortSignal
 * }} ApiCallOptions
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   endpoint: string,
 *   path: string,
 *   content: string,
 *   note: string
 * }} AssetApiResult
 */

function appendQueryValue(searchParams, key, value) {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => appendQueryValue(searchParams, key, item));
    return;
  }

  searchParams.append(key, String(value));
}

function buildApiUrl(basePath, endpointName, query) {
  const url = new URL(`${basePath.replace(/\/$/, "")}/${endpointName}`, window.location.origin);

  Object.entries(query || {}).forEach(([key, value]) => {
    appendQueryValue(url.searchParams, key, value);
  });

  return url;
}

async function parseApiResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  if (contentType.startsWith("text/") || contentType.includes("xml")) {
    return response.text();
  }

  return response.blob();
}

async function createApiError(endpointName, response) {
  let detail = response.statusText || "Request failed";

  try {
    const payload = await parseApiResponse(response);

    if (payload && typeof payload === "object" && "error" in payload) {
      detail =
        typeof payload.error === "string"
          ? payload.error
          : JSON.stringify(payload.error, null, 2);
    } else if (typeof payload === "string" && payload.trim()) {
      detail = payload;
    }
  } catch (error) {
    detail = response.statusText || "Request failed";
  }

  return new Error(`API ${endpointName} failed with status ${response.status}: ${detail}`);
}

export function createApiClient(options = {}) {
  const basePath = options.basePath || "/api";

  /**
   * Universal server API caller for `/api/<endpoint>` modules.
   *
   * @template T
   * @param {string} endpointName
   * @param {ApiCallOptions} [callOptions]
   * @returns {Promise<T>}
   */
  async function call(endpointName, callOptions = {}) {
    const method = String(callOptions.method || "GET").toUpperCase();
    const url = buildApiUrl(basePath, endpointName, callOptions.query);
    const headers = new Headers(callOptions.headers || {});
    const init = {
      method,
      headers,
      signal: callOptions.signal
    };

    if (!["GET", "HEAD"].includes(method) && callOptions.body !== undefined) {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const contentType = headers.get("Content-Type") || "";
      init.body =
        contentType.includes("application/json") && typeof callOptions.body !== "string"
          ? JSON.stringify(callOptions.body)
          : callOptions.body;
    }

    let response;

    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new Error(`API ${endpointName} request failed: ${error.message}`);
    }

    if (!response.ok) {
      throw await createApiError(endpointName, response);
    }

    return /** @type {Promise<T>} */ (parseApiResponse(response));
  }

  /**
   * @returns {Promise<{ ok: boolean, name: string, browserAppUrl: string, responsibilities: string[] }>}
   */
  async function health() {
    return call("health");
  }

  /**
   * @param {string} path
   * @returns {Promise<AssetApiResult>}
   */
  async function assetGet(path) {
    return call("asset_get", {
      method: "GET",
      query: { path }
    });
  }

  /**
   * @param {string} path
   * @param {string} content
   * @returns {Promise<AssetApiResult>}
   */
  async function assetSet(path, content) {
    return call("asset_set", {
      method: "POST",
      body: {
        path,
        content
      }
    });
  }

  return {
    assetGet,
    assetSet,
    call,
    health
  };
}
