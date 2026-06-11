import {
  pollCodexDeviceAuthorization,
  startCodexDeviceAuthorization,
  normalizeCodexTokens
} from "/mod/_core/openai_codex/token_manager.js";

export const CODEX_AUTH_FLOW_STATUS = Object.freeze({
  COMPLETE: "complete",
  FAILED: "failed",
  IDLE: "idle",
  PENDING: "pending",
  STARTING: "starting"
});

const DEFAULT_POLL_INTERVAL_SECONDS = 3;
const MIN_POLL_INTERVAL_SECONDS = 3;
const DEFAULT_FLOW_TIMEOUT_SECONDS = 15 * 60;

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Device authorization cancelled.", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Device authorization cancelled.", "AbortError"));
    };

    function cleanup() {
      signal?.removeEventListener?.("abort", onAbort);
    }

    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

export async function runCodexDeviceAuthorizationFlow({
  fetchImpl,
  onStatusChange,
  signal
} = {}) {
  const emit = typeof onStatusChange === "function" ? onStatusChange : () => {};

  emit({ status: CODEX_AUTH_FLOW_STATUS.STARTING });

  let deviceAuth;
  try {
    deviceAuth = await startCodexDeviceAuthorization({ fetchImpl });
  } catch (error) {
    emit({
      error: error instanceof Error ? error.message : String(error),
      status: CODEX_AUTH_FLOW_STATUS.FAILED
    });
    throw error;
  }

  const deviceAuthId = String(deviceAuth?.deviceAuthId || "").trim();
  const userCode = String(deviceAuth?.userCode || "").trim();
  const verificationUrl = String(deviceAuth?.verificationUrl || "").trim();
  const serverInterval = Number.isFinite(deviceAuth?.interval) ? Number(deviceAuth.interval) : DEFAULT_POLL_INTERVAL_SECONDS;
  const pollIntervalSeconds = Math.max(MIN_POLL_INTERVAL_SECONDS, serverInterval);
  const timeoutSeconds = Number.isFinite(deviceAuth?.expiresIn) ? Number(deviceAuth.expiresIn) : DEFAULT_FLOW_TIMEOUT_SECONDS;

  if (!deviceAuthId || !userCode || !verificationUrl) {
    const error = new Error("ChatGPT returned an invalid device authorization payload.");
    emit({
      error: error.message,
      status: CODEX_AUTH_FLOW_STATUS.FAILED
    });
    throw error;
  }

  emit({
    deviceAuthId,
    pollIntervalSeconds,
    status: CODEX_AUTH_FLOW_STATUS.PENDING,
    userCode,
    verificationUrl
  });

  const startedAt = Date.now();
  let firstIteration = true;

  while (true) {
    if (signal?.aborted) {
      const error = new DOMException("Device authorization cancelled.", "AbortError");
      emit({ error: error.message, status: CODEX_AUTH_FLOW_STATUS.FAILED });
      throw error;
    }

    if ((Date.now() - startedAt) / 1000 > timeoutSeconds) {
      const error = new Error("Timed out waiting for ChatGPT authorization.");
      emit({ error: error.message, status: CODEX_AUTH_FLOW_STATUS.FAILED });
      throw error;
    }

    // Poll immediately on the first iteration so a user who enters the code
    // before the browser renders the pending panel still sees the login
    // complete near-instantly. Subsequent iterations wait for the server-
    // advertised poll interval to avoid hammering the endpoint.
    if (!firstIteration) {
      await wait(pollIntervalSeconds * 1000, signal);
    }

    firstIteration = false;

    let pollResult;
    try {
      pollResult = await pollCodexDeviceAuthorization({
        deviceAuthId,
        fetchImpl,
        userCode
      });
    } catch (error) {
      emit({
        error: error instanceof Error ? error.message : String(error),
        status: CODEX_AUTH_FLOW_STATUS.FAILED
      });
      throw error;
    }

    if (pollResult?.state === "complete" && pollResult.tokens) {
      const tokens = normalizeCodexTokens(pollResult.tokens);

      if (!tokens) {
        const error = new Error("ChatGPT returned an invalid token payload.");
        emit({ error: error.message, status: CODEX_AUTH_FLOW_STATUS.FAILED });
        throw error;
      }

      emit({ status: CODEX_AUTH_FLOW_STATUS.COMPLETE, tokens });
      return tokens;
    }

    emit({
      deviceAuthId,
      pollIntervalSeconds,
      status: CODEX_AUTH_FLOW_STATUS.PENDING,
      userCode,
      verificationUrl
    });
  }
}
