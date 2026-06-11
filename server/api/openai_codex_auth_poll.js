import { pollDeviceAuthorization } from "../lib/openai_codex/oauth_client.js";

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

  try {
    return await pollDeviceAuthorization({
      deviceAuthId: payload.deviceAuthId,
      userCode: payload.userCode
    });
  } catch (error) {
    throw createHttpError(
      error.message || "Failed to poll Codex device authorization.",
      Number(error.statusCode) || 502
    );
  }
}
