// POST /api/oauth_anthropic_disconnect
//
// Removes the stored Claude subscription tokens for the authenticated user.
// The encrypted file at /app/L2/<username>/meta/anthropic_oauth.json is
// deleted, the change is published through the shared mutation flow, and
// the UI returns to the disconnected state. Existing chat history is not
// touched because tokens are independent of conversation data.

import { disconnectUser } from "../lib/auth/anthropic_oauth.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function post(context) {
  if (!context?.user?.isAuthenticated) {
    throw createHttpError("Authentication required.", 401);
  }

  const username = String(context.user.username || "").trim();
  if (!username) {
    throw createHttpError("Authentication required.", 401);
  }

  const result = await runTrackedMutation(context, async () =>
    disconnectUser({
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username
    })
  );

  return {
    status: 200,
    headers: {
      "Cache-Control": "no-store"
    },
    body: {
      changed: Boolean(result?.changed),
      connected: false
    }
  };
}
