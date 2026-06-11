import assert from "node:assert/strict";
import test from "node:test";

import {
  PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS,
  PROXY_REQUEST_TIMEOUT_PARAM_NAME,
  resolveProxyRequestTimeoutMs
} from "../server/router/proxy.js";

function createStaticRuntimeParams(values = {}) {
  return {
    get(name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    }
  };
}

test("resolveProxyRequestTimeoutMs falls back to the default when no runtime params are provided", () => {
  const expectedMs = PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS * 1000;

  assert.equal(resolveProxyRequestTimeoutMs(undefined), expectedMs);
  assert.equal(resolveProxyRequestTimeoutMs(null), expectedMs);
  assert.equal(resolveProxyRequestTimeoutMs({}), expectedMs);
});

test("resolveProxyRequestTimeoutMs falls back to the default when the param is unset, empty, or non-numeric", () => {
  const expectedMs = PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS * 1000;

  assert.equal(resolveProxyRequestTimeoutMs(createStaticRuntimeParams()), expectedMs);
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: "" })),
    expectedMs
  );
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: "abc" })),
    expectedMs
  );
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: -10 })),
    expectedMs
  );
});

test("resolveProxyRequestTimeoutMs honors a positive override value in seconds", () => {
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: 1200 })),
    1_200_000
  );
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: "60" })),
    60_000
  );
});

test("resolveProxyRequestTimeoutMs maps 0 to a disabled timeout so operators can turn the guard off", () => {
  // A configured `PROXY_REQUEST_TIMEOUT_SECONDS=0` means the proxy should
  // make no timeout decision of its own and rely on lower layers (kernel,
  // upstream server, manual cancel). The caller checks for `timeoutMs > 0`
  // before constructing an `AbortSignal.timeout(...)`.
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: 0 })),
    0
  );
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: "0" })),
    0
  );
});

test("resolveProxyRequestTimeoutMs truncates fractional seconds down to whole milliseconds", () => {
  assert.equal(
    resolveProxyRequestTimeoutMs(createStaticRuntimeParams({ [PROXY_REQUEST_TIMEOUT_PARAM_NAME]: 1.5 })),
    1500
  );
});

test("PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS is at least one minute past the undici headers-timeout default", () => {
  // undici's built-in `headersTimeout` default is 300 seconds. The proxy
  // override must stay comfortably above that, otherwise long upstream
  // prompt-prefill phases still get cut by the inner client default before
  // our explicit timeout takes effect.
  assert.ok(PROXY_REQUEST_TIMEOUT_DEFAULT_SECONDS >= 360);
});
