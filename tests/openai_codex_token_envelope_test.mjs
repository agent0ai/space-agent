import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeStoredCodexTokens,
  encodeStoredCodexTokens,
  parseCodexTokens,
  serializeCodexTokens
} from "../app/L0/_all/mod/_core/openai_codex/token_envelope.js";

function createConfigStub(values = {}) {
  return {
    get: (key, fallback) => (key in values ? values[key] : fallback),
    values
  };
}

function createUserCryptoStub({ decrypt, encrypt } = {}) {
  return {
    decryptText: async (value) => (typeof decrypt === "function" ? decrypt(value) : ""),
    encryptText: async (value) => (typeof encrypt === "function" ? encrypt(value) : "")
  };
}

function createRuntime({ singleUserApp = false, userCrypto = null, useParamsForLegacyBugRepro = false } = {}) {
  const runtime = {
    config: createConfigStub({ SINGLE_USER_APP: singleUserApp }),
    utils: userCrypto ? { userCrypto } : {}
  };

  if (useParamsForLegacyBugRepro) {
    runtime.params = { SINGLE_USER_APP: singleUserApp };
  }

  return runtime;
}

test("serializeCodexTokens returns JSON string for object input", () => {
  assert.equal(serializeCodexTokens({ access_token: "abc" }), '{"access_token":"abc"}');
});

test("serializeCodexTokens returns '' for falsy or non-object input", () => {
  assert.equal(serializeCodexTokens(null), "");
  assert.equal(serializeCodexTokens(undefined), "");
  assert.equal(serializeCodexTokens("string"), "");
  assert.equal(serializeCodexTokens(42), "");
});

test("parseCodexTokens accepts an object directly", () => {
  const value = { access_token: "abc" };
  assert.deepEqual(parseCodexTokens(value), value);
});

test("parseCodexTokens parses a JSON string into an object", () => {
  assert.deepEqual(parseCodexTokens('{"access_token":"abc"}'), { access_token: "abc" });
});

test("parseCodexTokens returns null for empty, malformed or non-object payloads", () => {
  assert.equal(parseCodexTokens(""), null);
  assert.equal(parseCodexTokens("   "), null);
  assert.equal(parseCodexTokens("not-json"), null);
  assert.equal(parseCodexTokens("[1,2,3]"), null);
  assert.equal(parseCodexTokens(null), null);
});

test("decodeStoredCodexTokens returns a blank result for empty stored value", async () => {
  const runtime = createRuntime();
  const result = await decodeStoredCodexTokens(runtime, "");
  assert.deepEqual(result, { locked: false, storedValue: "", value: "" });
});

test("decodeStoredCodexTokens returns a locked result in SINGLE_USER_APP for legacy ciphertext", async () => {
  const runtime = createRuntime({ singleUserApp: true });
  const ciphertext = "userCrypto:legacy-payload";

  const result = await decodeStoredCodexTokens(runtime, ciphertext);

  assert.deepEqual(result, {
    locked: true,
    storedValue: ciphertext,
    value: ""
  });
});

test("decodeStoredCodexTokens ignores runtime.params.SINGLE_USER_APP — the read path is runtime.config.get", async () => {
  // Regression guard: previously the single-user check read from
  // `runtime.params.SINGLE_USER_APP`, which is not how frontend runtime
  // config is exposed. With the legacy path set but the correct config
  // path absent, the helper must NOT take the single-user branch.
  const runtime = {
    params: { SINGLE_USER_APP: true },
    config: createConfigStub({}),
    utils: { userCrypto: createUserCryptoStub({ decrypt: () => "" }) }
  };
  const ciphertext = "userCrypto:legacy-payload";

  const result = await decodeStoredCodexTokens(runtime, ciphertext);

  assert.equal(result.locked, true);
  assert.equal(result.value, "");
  assert.equal(result.storedValue, ciphertext);
});

test("decodeStoredCodexTokens decrypts in multi-user runtime when userCrypto is available", async () => {
  const runtime = createRuntime({
    userCrypto: createUserCryptoStub({ decrypt: () => '{"access_token":"abc"}' })
  });

  const result = await decodeStoredCodexTokens(runtime, "userCrypto:wrapped");

  assert.equal(result.locked, false);
  assert.equal(result.value, '{"access_token":"abc"}');
});

test("decodeStoredCodexTokens reports locked when userCrypto is missing and value is wrapped", async () => {
  const runtime = createRuntime();
  const result = await decodeStoredCodexTokens(runtime, "userCrypto:wrapped");

  assert.equal(result.locked, true);
  assert.equal(result.value, "");
});

test("encodeStoredCodexTokens preserves locked stored ciphertext when caller did not replace tokens", async () => {
  const runtime = createRuntime();
  const result = await encodeStoredCodexTokens(runtime, {
    codexTokens: "",
    storedCodexTokensLocked: true,
    storedCodexTokensValue: "userCrypto:previous"
  });

  assert.equal(result, "userCrypto:previous");
});

test("encodeStoredCodexTokens returns plaintext in SINGLE_USER_APP", async () => {
  const runtime = createRuntime({ singleUserApp: true });

  const result = await encodeStoredCodexTokens(runtime, {
    codexTokens: '{"access_token":"abc"}'
  });

  assert.equal(result, '{"access_token":"abc"}');
});

test("encodeStoredCodexTokens encrypts in multi-user runtime when userCrypto is available", async () => {
  const runtime = createRuntime({
    userCrypto: createUserCryptoStub({ encrypt: (value) => `userCrypto:${value}` })
  });

  const result = await encodeStoredCodexTokens(runtime, {
    codexTokens: '{"access_token":"abc"}'
  });

  assert.equal(result, 'userCrypto:{"access_token":"abc"}');
});

test("encodeStoredCodexTokens throws when userCrypto is unavailable in multi-user runtime", async () => {
  const runtime = createRuntime();

  await assert.rejects(
    () => encodeStoredCodexTokens(runtime, { codexTokens: '{"access_token":"abc"}' }),
    /userCrypto is unavailable/u
  );
});

test("encodeStoredCodexTokens returns '' when caller cleared tokens and no locked ciphertext is held", async () => {
  const runtime = createRuntime({ singleUserApp: true });

  const result = await encodeStoredCodexTokens(runtime, {
    codexTokens: "",
    storedCodexTokensLocked: false,
    storedCodexTokensValue: ""
  });

  assert.equal(result, "");
});
