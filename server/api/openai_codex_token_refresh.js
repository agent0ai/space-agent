import { refreshAccessToken } from "../lib/openai_codex/oauth_client.js";
import { runSingleWriterRefresh } from "../lib/openai_codex/refresh_lock.js";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function post(context) {
  const payload =
    context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
      ? context.body
      : {};
  const refreshToken = String(payload.refreshToken || "").trim();

  if (!refreshToken) {
    throw createHttpError("refreshToken is required.", 400);
  }

  try {
    return await runSingleWriterRefresh(refreshToken, () => refreshAccessToken({ refreshToken }));
  } catch (error) {
    throw createHttpError(
      error.message || "Failed to refresh Codex access token.",
      Number(error.statusCode) || 502
    );
  }
}
