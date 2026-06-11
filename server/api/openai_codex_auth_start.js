import { startDeviceAuthorization } from "../lib/openai_codex/oauth_client.js";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function post() {
  try {
    return await startDeviceAuthorization();
  } catch (error) {
    throw createHttpError(
      error.message || "Failed to start Codex device authorization.",
      Number(error.statusCode) || 502
    );
  }
}
