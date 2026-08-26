import assert from "node:assert/strict";
import test from "node:test";

import { createRequestHandler } from "../server/router/router.js";

function createMockRequest(pathname, options = {}) {
  return {
    headers: {
      host: "localhost:3000",
      ...(options.headers || {})
    },
    method: options.method || "GET",
    url: pathname
  };
}

function createMockResponse() {
  let resolveResult = null;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });
  const storedHeaders = {};

  const response = {
    headersSent: false,
    statusCode: null,
    writableEnded: false,
    getHeader(name) {
      return storedHeaders[name];
    },
    setHeader(name, value) {
      storedHeaders[name] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.headersSent = true;
      this.statusCode = statusCode;
      Object.assign(storedHeaders, headers);
    },
    end(body = "") {
      this.writableEnded = true;
      resolveResult({
        body: Buffer.isBuffer(body) ? body.toString("utf8") : String(body || ""),
        headers: { ...storedHeaders },
        statusCode: this.statusCode
      });
    }
  };

  return { response, result };
}

function createApiRegistry(endpointName, handler) {
  return new Map([
    [
      endpointName,
      {
        allowAnonymous: true,
        endpointName,
        handlers: {
          get: handler
        }
      }
    ]
  ]);
}

function createTestRequestHandler(handler) {
  return createRequestHandler({
    apiRegistry: createApiRegistry("example", handler),
    host: "localhost",
    port: 3000,
    projectRoot: process.cwd(),
    projectVersion: "test"
  });
}

async function captureConsoleError(callback) {
  const originalConsoleError = console.error;
  const calls = [];

  console.error = (...args) => {
    calls.push(args);
  };

  try {
    await callback(calls);
  } finally {
    console.error = originalConsoleError;
  }
}

test("API 404 errors are returned without backend error log noise", async () => {
  await captureConsoleError(async (consoleErrorCalls) => {
    const requestHandler = createTestRequestHandler(() => {
      const error = new Error("Missing example.");
      error.statusCode = 404;
      throw error;
    });
    const { response, result } = createMockResponse();

    await requestHandler(createMockRequest("/api/example"), response);

    const payload = await result;
    assert.equal(payload.statusCode, 404);
    assert.deepEqual(JSON.parse(payload.body), {
      error: "Missing example."
    });
    assert.deepEqual(consoleErrorCalls, []);
  });
});

test("API 5xx errors still emit backend diagnostics", async () => {
  await captureConsoleError(async (consoleErrorCalls) => {
    const requestHandler = createTestRequestHandler(() => {
      throw new Error("Database unavailable.");
    });
    const { response, result } = createMockResponse();

    await requestHandler(createMockRequest("/api/example"), response);

    const payload = await result;
    assert.equal(payload.statusCode, 500);
    assert.deepEqual(JSON.parse(payload.body), {
      error: "Internal server error"
    });
    assert.equal(consoleErrorCalls.length, 2);
    assert.match(String(consoleErrorCalls[0][0]), /\[api\] GET \/api\/example failed \(500\)\./u);
    assert.equal(consoleErrorCalls[1][0] instanceof Error, true);
    assert.equal(consoleErrorCalls[1][0].message, "Database unavailable.");
  });
});
