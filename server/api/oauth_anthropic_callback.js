// Two-mode callback endpoint for the Claude subscription OAuth flow.
//
//   GET  /api/oauth_anthropic_callback?code=...&state=[&error=...]
//     Used by the redirect-mode popup. Anthropic redirects the popup
//     here directly. The handler exchanges the code, stores the sealed
//     tokens, and returns a tiny HTML page that posts a result message
//     to the opener window and closes itself.
//
//   POST /api/oauth_anthropic_callback {code, state}
//     Used by the paste-mode dialog. The browser POSTs the
//     user-entered code plus state from the connect block as JSON.
//
// Both code paths share the same exchange + persist logic.

import {
  ANTHROPIC_OAUTH_FLOW_MODE_REDIRECT,
  connectWithAuthorizationCode,
  getStatusForUser
} from "../lib/auth/anthropic_oauth.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isAnthropicOauthAllowed(runtimeParams) {
  return Boolean(
    runtimeParams && typeof runtimeParams.get === "function" && runtimeParams.get("ANTHROPIC_OAUTH_ALLOWED", true)
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCallbackHtml({ success, error }) {
  const safeError = escapeHtml(error || "");
  const messagePayload = JSON.stringify({
    type: "space-anthropic-oauth-complete",
    success: Boolean(success),
    error: success ? null : String(error || "Unknown error")
  });
  const closeScript = success
    ? "setTimeout(function(){ try { window.close(); } catch (e) {} }, 600);"
    : "";

  const body = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${success ? "Connected to Claude" : "Could not connect"}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        max-width: 32rem;
        margin: 0 auto;
        padding: 3rem 1.5rem;
        line-height: 1.5;
      }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { margin: 0.25rem 0; color: #555; }
      .ok { color: #15803d; }
      .err { color: #b91c1c; }
      .hint { font-size: 0.85rem; color: #666; margin-top: 1rem; }
      @media (prefers-color-scheme: dark) {
        body { color: #e5e5e5; }
        p { color: #c5c5c5; }
        .ok { color: #4ade80; }
        .err { color: #f87171; }
        .hint { color: #a3a3a3; }
      }
    </style>
  </head>
  <body>
    <h1 class="${success ? "ok" : "err"}">${success ? "Connected to Claude" : "Could not connect"}</h1>
    <p>${
      success
        ? "Your Claude subscription is now linked to Space Agent."
        : `Space Agent couldn't finish the connect: ${safeError}`
    }</p>
    <p class="hint">${
      success
        ? "This window will close automatically. If it doesn't, you can close it yourself."
        : "Close this window and click Connect with Claude again from the Space Agent settings dialog."
    }</p>
    <script>
(function(){
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(${messagePayload}, "*");
    }
  } catch (e) {}
  ${closeScript}
})();
    </script>
  </body>
</html>`;

  return {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8"
    },
    body
  };
}

async function exchangeAndPersist(context, { code, state }) {
  if (!context?.user?.isAuthenticated) {
    throw createHttpError("You must sign in to Space Agent before connecting Claude.", 401);
  }
  if (!isAnthropicOauthAllowed(context.runtimeParams)) {
    throw createHttpError("Claude subscription OAuth is disabled in this system.", 403);
  }

  const username = String(context.user.username || "").trim();
  if (!username) {
    throw createHttpError("You must sign in to Space Agent before connecting Claude.", 401);
  }

  const normalizedCode = String(code || "").trim();
  const normalizedState = String(state || "").trim();
  if (!normalizedCode || !normalizedState) {
    throw createHttpError("The Claude connect was missing its authorization code or state token. Try connecting again.", 400);
  }

  const cached = await context.auth.consumeAnthropicOauthState(normalizedState);
  if (!cached) {
    throw createHttpError(
      "This Claude connect session expired or was already used. Click Connect with Claude again to start fresh.",
      400
    );
  }
  if (cached.username && cached.username !== username) {
    throw createHttpError("This Claude connect session belongs to a different Space Agent user.", 403);
  }

  const codeVerifier = String(cached.codeVerifier || "").trim();
  if (!codeVerifier) {
    throw createHttpError("This Claude connect session was incomplete. Click Connect with Claude again.", 400);
  }

  await runTrackedMutation(context, async () =>
    connectWithAuthorizationCode({
      code: normalizedCode,
      state: normalizedState,
      codeVerifier,
      redirectUri: cached.redirectUri,
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username
    })
  );

  return getStatusForUser({
    projectRoot: context.projectRoot,
    runtimeParams: context.runtimeParams,
    username
  });
}

// Some pasted-code submissions arrive from Anthropic's hosted code page
// formatted as `<code>#<state>` (the page shows the two values joined by
// `#`). Accept that form too so users who copy the whole displayed string
// don't have to split it themselves.
function splitPastedCode(rawCode, fallbackState) {
  const text = String(rawCode || "").trim();
  if (!text) {
    return { code: "", state: fallbackState || "" };
  }
  const hashIndex = text.indexOf("#");
  if (hashIndex === -1) {
    return { code: text, state: fallbackState || "" };
  }
  return {
    code: text.slice(0, hashIndex).trim(),
    state: text.slice(hashIndex + 1).trim() || fallbackState || ""
  };
}

export async function post(context) {
  const payload =
    context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
      ? context.body
      : {};
  const { code, state } = splitPastedCode(payload.code, payload.state);

  const status = await exchangeAndPersist(context, { code, state });

  return {
    status: 200,
    headers: {
      "Cache-Control": "no-store"
    },
    body: {
      connected: true,
      status
    }
  };
}

export async function get(context) {
  const code = String(context.params?.code || "").trim();
  const state = String(context.params?.state || "").trim();
  const errorParam = String(context.params?.error || "").trim();
  const errorDescription = String(context.params?.error_description || "").trim();

  if (errorParam) {
    return renderCallbackHtml({
      success: false,
      error: errorDescription || errorParam
    });
  }

  try {
    await exchangeAndPersist(context, { code, state });
    return renderCallbackHtml({ success: true });
  } catch (error) {
    return renderCallbackHtml({
      success: false,
      error: error?.message || "Could not finish the Claude connect."
    });
  }
}
