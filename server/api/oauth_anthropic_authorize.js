// POST /api/oauth_anthropic_authorize
//
// Starts a Claude subscription OAuth flow for the authenticated user.
// Generates a PKCE verifier plus opaque state token, caches them in the
// shared state system under the per-user OAuth state area, and returns
// the authorize URL plus the state token plus the resolved flow mode.
//
// Flow modes:
//   - "redirect": the popup is sent back to /api/oauth_anthropic_callback
//     directly with ?code=...&state=...; the server completes the
//     exchange and posts a message back to the opener window. No
//     copy-paste required. Used by default on localhost.
//   - "paste": the popup ends on Anthropic's hosted code page; the user
//     copies the displayed code into the Space Agent dialog. Used as a
//     fallback when the deployment's host is not localhost so Anthropic
//     does not need to allowlist arbitrary URLs.

import { buildAuthorizeContext } from "../lib/auth/anthropic_oauth.js";

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

function resolveRequestProtocol(req) {
  if (req?.socket?.encrypted) {
    return "https";
  }
  const forwarded = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwarded === "https" ? "https" : "http";
}

function resolveRequestHost(req) {
  const forwarded = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  if (forwarded) {
    return forwarded;
  }
  return String(req?.headers?.host || "").trim() || "localhost";
}

export async function post(context) {
  if (!context?.user?.isAuthenticated) {
    throw createHttpError("Authentication required.", 401);
  }
  if (!isAnthropicOauthAllowed(context.runtimeParams)) {
    throw createHttpError("Claude subscription OAuth is disabled in this system.", 403);
  }

  const username = String(context.user.username || "").trim();
  if (!username) {
    throw createHttpError("Authentication required.", 401);
  }

  const requestHost = resolveRequestHost(context.req);
  const requestProtocol = resolveRequestProtocol(context.req);

  const { authorizeUrl, codeVerifier, state, endpoints, flowMode, redirectUri } = buildAuthorizeContext(
    context.runtimeParams,
    {
      requestHost,
      requestProtocol
    }
  );

  await context.auth.storeAnthropicOauthState(state, {
    codeVerifier,
    flowMode,
    redirectUri,
    username
  });

  return {
    status: 200,
    headers: {
      "Cache-Control": "no-store"
    },
    body: {
      authorizeUrl,
      flowMode,
      redirectUri,
      state
    }
  };
}
