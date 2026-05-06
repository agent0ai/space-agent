// GET /api/oauth_anthropic_status
//
// Returns the current Claude subscription OAuth status for the
// authenticated user. The response never includes tokens; only the
// metadata the UI needs to render the connect dialog: whether a
// connection exists, the account email, expiry timestamp, scope, and
// organization metadata.

import { getStatusForUser } from "../lib/auth/anthropic_oauth.js";

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

export async function get(context) {
  if (!context?.user?.isAuthenticated) {
    throw createHttpError("Authentication required.", 401);
  }

  const username = String(context.user.username || "").trim();
  const allowed = isAnthropicOauthAllowed(context.runtimeParams);

  if (!username || !allowed) {
    return {
      status: 200,
      headers: {
        "Cache-Control": "no-store"
      },
      body: {
        allowed,
        connected: false
      }
    };
  }

  const status = await getStatusForUser({
    projectRoot: context.projectRoot,
    runtimeParams: context.runtimeParams,
    username
  });

  return {
    status: 200,
    headers: {
      "Cache-Control": "no-store"
    },
    body: {
      allowed: true,
      ...status
    }
  };
}
