import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CODEX_REFRESH_MARGIN_SECONDS,
  ensureFreshCodexAccessToken,
  isCodexAccessTokenExpiring,
  normalizeCodexTokens,
  resetCodexTokenManagerForTesting
} from "../app/L0/_all/mod/_core/openai_codex/token_manager.js";

function createFetchStub(handler) {
  return async function stubbedFetch(url, init) {
    const callInfo = {
      body: init && typeof init.body === "string" ? JSON.parse(init.body) : null,
      credentials: init?.credentials,
      method: init?.method,
      url
    };
    const { status = 200, body = {}, contentType = "application/json" } = await handler(callInfo);
    const bodyText = contentType.includes("application/json") ? JSON.stringify(body) : String(body);

    return {
      headers: {
        get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null)
      },
      json: async () => JSON.parse(bodyText),
      ok: status >= 200 && status < 300,
      status,
      text: async () => bodyText
    };
  };
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

test("normalizeCodexTokens returns null for missing fields", () => {
  assert.equal(normalizeCodexTokens(null), null);
  assert.equal(normalizeCodexTokens({}), null);
  assert.equal(normalizeCodexTokens({ accessToken: "a" }), null);
  assert.equal(normalizeCodexTokens({ refreshToken: "r" }), null);
});

test("normalizeCodexTokens fills numeric defaults", () => {
  const normalized = normalizeCodexTokens({
    accessToken: "a",
    refreshToken: "r"
  });

  assert.equal(normalized.accessToken, "a");
  assert.equal(normalized.refreshToken, "r");
  assert.equal(normalized.expiresAt, 0);
  assert.equal(normalized.obtainedAt, 0);
  assert.equal(normalized.accountId, "");
  assert.equal(normalized.idToken, "");
});

test("isCodexAccessTokenExpiring returns true when token has no expiry", () => {
  assert.equal(
    isCodexAccessTokenExpiring({ accessToken: "a", refreshToken: "r" }),
    true
  );
});

test("isCodexAccessTokenExpiring respects safety margin", () => {
  const farFuture = nowSeconds() + DEFAULT_CODEX_REFRESH_MARGIN_SECONDS + 600;
  const nearFuture = nowSeconds() + DEFAULT_CODEX_REFRESH_MARGIN_SECONDS - 60;

  assert.equal(
    isCodexAccessTokenExpiring({
      accessToken: "a",
      expiresAt: farFuture,
      refreshToken: "r"
    }),
    false
  );

  assert.equal(
    isCodexAccessTokenExpiring({
      accessToken: "a",
      expiresAt: nearFuture,
      refreshToken: "r"
    }),
    true
  );
});

test("ensureFreshCodexAccessToken returns existing token when not expiring", async () => {
  resetCodexTokenManagerForTesting();
  const tokens = {
    accessToken: "live",
    accountId: "",
    expiresAt: nowSeconds() + 3600,
    idToken: "",
    obtainedAt: nowSeconds(),
    refreshToken: "rt1"
  };

  let loadCalls = 0;
  let saveCalls = 0;
  const fetchImpl = createFetchStub(() => {
    throw new Error("fetch should not be called when token is still valid");
  });

  const result = await ensureFreshCodexAccessToken({
    fetchImpl,
    loadTokens: async () => {
      loadCalls += 1;
      return tokens;
    },
    saveTokens: async () => {
      saveCalls += 1;
    }
  });

  assert.equal(result.accessToken, "live");
  assert.equal(loadCalls, 1);
  assert.equal(saveCalls, 0);
});

test("ensureFreshCodexAccessToken refreshes when token is expiring", async () => {
  resetCodexTokenManagerForTesting();
  const stale = {
    accessToken: "stale",
    accountId: "",
    expiresAt: nowSeconds() + 30,
    idToken: "",
    obtainedAt: nowSeconds() - 3600,
    refreshToken: "rt-old"
  };
  const refreshedPayload = {
    accessToken: "fresh",
    accountId: "acc-1",
    expiresAt: nowSeconds() + 3600,
    idToken: "id1",
    obtainedAt: nowSeconds(),
    refreshToken: "rt-new"
  };

  let postedBody = null;
  let savedTokens = null;

  const fetchImpl = createFetchStub((callInfo) => {
    assert.equal(callInfo.url, "/api/openai_codex_token_refresh");
    postedBody = callInfo.body;
    return { body: refreshedPayload };
  });

  const result = await ensureFreshCodexAccessToken({
    fetchImpl,
    loadTokens: async () => stale,
    saveTokens: async (tokens) => {
      savedTokens = tokens;
    }
  });

  assert.deepEqual(postedBody, { refreshToken: "rt-old" });
  assert.equal(result.accessToken, "fresh");
  assert.equal(result.refreshToken, "rt-new");
  assert.equal(savedTokens?.accessToken, "fresh");
  assert.equal(savedTokens?.refreshToken, "rt-new");
});

test("ensureFreshCodexAccessToken re-reads tokens on every call (no in-memory cache)", async () => {
  resetCodexTokenManagerForTesting();
  let loadCalls = 0;
  const fetchImpl = createFetchStub(() => {
    throw new Error("fetch should not be called when token is still valid");
  });

  const stillValid = {
    accessToken: "a",
    accountId: "",
    expiresAt: nowSeconds() + 3600,
    idToken: "",
    obtainedAt: nowSeconds(),
    refreshToken: "r"
  };

  const loadTokens = async () => {
    loadCalls += 1;
    return stillValid;
  };

  await ensureFreshCodexAccessToken({ fetchImpl, loadTokens });
  await ensureFreshCodexAccessToken({ fetchImpl, loadTokens });
  await ensureFreshCodexAccessToken({ fetchImpl, loadTokens });

  assert.equal(loadCalls, 3);
});

test("ensureFreshCodexAccessToken coalesces concurrent refresh calls for the same refresh token", async () => {
  resetCodexTokenManagerForTesting();
  const stale = {
    accessToken: "stale",
    accountId: "",
    expiresAt: nowSeconds() - 60,
    idToken: "",
    obtainedAt: nowSeconds() - 3600,
    refreshToken: "rt-shared"
  };

  let refreshCallCount = 0;
  let resolveRefresh;
  const refreshPayload = {
    accessToken: "fresh",
    accountId: "",
    expiresAt: nowSeconds() + 3600,
    idToken: "",
    obtainedAt: nowSeconds(),
    refreshToken: "rt-new"
  };

  const fetchImpl = createFetchStub(async () => {
    refreshCallCount += 1;
    await new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    return { body: refreshPayload };
  });

  const loadTokens = async () => stale;
  const promiseA = ensureFreshCodexAccessToken({ fetchImpl, loadTokens });
  const promiseB = ensureFreshCodexAccessToken({ fetchImpl, loadTokens });
  const promiseC = ensureFreshCodexAccessToken({ fetchImpl, loadTokens });

  // Let microtasks run so all three calls reach the single-flight coalesce path.
  await Promise.resolve();
  await Promise.resolve();

  resolveRefresh({ body: refreshPayload });

  const [a, b, c] = await Promise.all([promiseA, promiseB, promiseC]);

  assert.equal(refreshCallCount, 1);
  assert.equal(a.accessToken, "fresh");
  assert.equal(b.accessToken, "fresh");
  assert.equal(c.accessToken, "fresh");
});

test("ensureFreshCodexAccessToken throws when no tokens are stored", async () => {
  resetCodexTokenManagerForTesting();
  await assert.rejects(
    () =>
      ensureFreshCodexAccessToken({
        fetchImpl: createFetchStub(() => {
          throw new Error("should not be called");
        }),
        loadTokens: async () => null
      }),
    /Codex tokens are missing/u
  );
});

test("ensureFreshCodexAccessToken propagates invalid_grant from refresh endpoint", async () => {
  resetCodexTokenManagerForTesting();
  const stale = {
    accessToken: "stale",
    expiresAt: nowSeconds() - 60,
    obtainedAt: nowSeconds() - 3600,
    refreshToken: "rt-revoked"
  };

  const fetchImpl = createFetchStub(() => ({
    body: { error: "Refresh token is no longer valid. Please log in again." },
    status: 401
  }));

  await assert.rejects(
    () =>
      ensureFreshCodexAccessToken({
        fetchImpl,
        loadTokens: async () => stale
      }),
    (error) => error.statusCode === 401 && /Refresh token is no longer valid/u.test(error.message)
  );
});

test("ensureFreshCodexAccessToken returns refreshed tokens even when save fails", async () => {
  resetCodexTokenManagerForTesting();
  const stale = {
    accessToken: "stale",
    expiresAt: nowSeconds() - 60,
    obtainedAt: nowSeconds() - 3600,
    refreshToken: "rt1"
  };
  const refreshed = {
    accessToken: "fresh",
    expiresAt: nowSeconds() + 3600,
    obtainedAt: nowSeconds(),
    refreshToken: "rt2"
  };

  const fetchImpl = createFetchStub(() => ({ body: refreshed }));

  // Silence expected console.warn during this test so it does not pollute
  // the overall test output.
  const originalWarn = globalThis.console.warn;
  globalThis.console.warn = () => {};

  try {
    const result = await ensureFreshCodexAccessToken({
      fetchImpl,
      loadTokens: async () => stale,
      saveTokens: async () => {
        throw new Error("disk error");
      }
    });

    assert.equal(result.accessToken, "fresh");
  } finally {
    globalThis.console.warn = originalWarn;
  }
});
