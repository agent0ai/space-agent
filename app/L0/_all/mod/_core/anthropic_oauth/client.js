// Browser client for the Claude subscription OAuth flow.
//
// All token plaintext lives server-side. This client only surfaces:
//
//   - status (connected, accountEmail, expiresAt, allowed)
//   - the authorize URL plus state token returned when starting a connect
//   - completion of a connect by POSTing the user-pasted authorization code
//   - disconnect
//
// Calls go through the shared `space.api.call(...)` helper from
// `_core/framework/js/api-client.js`, which already handles cookie auth,
// JSON serialization, and error normalization.

function getApi() {
  const runtime = globalThis.space;
  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }
  if (!runtime.api || typeof runtime.api.call !== "function") {
    throw new Error("space.api.call is not available.");
  }
  return runtime.api;
}

async function fetchAnthropicOauthStatus() {
  const api = getApi();
  return api.call("oauth_anthropic_status", { method: "GET" });
}

async function startAnthropicOauthAuthorize() {
  const api = getApi();
  return api.call("oauth_anthropic_authorize", {
    method: "POST",
    body: {}
  });
}

async function completeAnthropicOauthCallback({ code, state }) {
  const api = getApi();
  return api.call("oauth_anthropic_callback", {
    method: "POST",
    body: {
      code: String(code || "").trim(),
      state: String(state || "").trim()
    }
  });
}

async function disconnectAnthropicOauth() {
  const api = getApi();
  return api.call("oauth_anthropic_disconnect", {
    method: "POST",
    body: {}
  });
}

function openAuthorizePopup(authorizeUrl) {
  if (typeof window === "undefined" || typeof window.open !== "function") {
    return null;
  }
  const features = "popup=yes,noopener=no,noreferrer=no,width=540,height=720";
  return window.open(authorizeUrl, "space-anthropic-oauth-connect", features);
}

export {
  completeAnthropicOauthCallback,
  disconnectAnthropicOauth,
  fetchAnthropicOauthStatus,
  openAuthorizePopup,
  startAnthropicOauthAuthorize
};
