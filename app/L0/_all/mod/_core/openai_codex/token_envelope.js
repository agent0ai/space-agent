const USER_CRYPTO_PREFIX = "userCrypto:";

function getUserCryptoRuntime(runtime) {
  return runtime?.utils?.userCrypto ?? null;
}

function isSingleUserAppRuntime(runtime) {
  return Boolean(runtime?.config?.get?.("SINGLE_USER_APP", false));
}

// Serialize an in-memory Codex tokens object into the JSON string used as the
// plaintext envelope payload and as the shape stored in Alpine store state.
// Returns "" for falsy or non-object inputs so callers can pass the return
// value directly into `settings.codexTokens` without branching.
export function serializeCodexTokens(tokens) {
  if (!tokens || typeof tokens !== "object") {
    return "";
  }

  try {
    return JSON.stringify(tokens);
  } catch {
    return "";
  }
}

// Parse a persisted plaintext token payload (the output of
// `serializeCodexTokens` after decryption, or the JSON string the Alpine
// store keeps at `settings.codexTokens`). Returns `null` for malformed or
// non-object payloads so callers can use a truthy guard on the result.
export function parseCodexTokens(plain) {
  if (plain && typeof plain === "object" && !Array.isArray(plain)) {
    return plain;
  }

  const normalized = typeof plain === "string" ? plain.trim() : "";

  if (!normalized) {
    return null;
  }

  try {
    const value = JSON.parse(normalized);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Decodes whatever is sitting in the persisted `codex_tokens` config field and
// returns a tri-state result shaped like the existing `api_key` handling:
//
//   { locked: boolean, storedValue: string, value: string }
//
// - `value` is the plaintext JSON string of the tokens when decryption succeeded
// - `storedValue` is the raw persisted ciphertext (or legacy plaintext); it is
//   kept verbatim so save can preserve the existing ciphertext untouched while
//   the session is locked
// - `locked` is true when a `userCrypto:`-prefixed payload could not be
//   decrypted in the current session (SINGLE_USER_APP mode or missing master
//   key); callers must preserve the ciphertext instead of clearing it
export async function decodeStoredCodexTokens(runtime, storedValue) {
  const rawStoredValue = String(storedValue || "").trim();

  if (!rawStoredValue) {
    return {
      locked: false,
      storedValue: "",
      value: ""
    };
  }

  if (isSingleUserAppRuntime(runtime) && rawStoredValue.startsWith(USER_CRYPTO_PREFIX)) {
    // Legacy non-single-user ciphertext must not be treated as plaintext in
    // single-user mode because single-user bypasses userCrypto entirely.
    return {
      locked: true,
      storedValue: rawStoredValue,
      value: ""
    };
  }

  const userCrypto = getUserCryptoRuntime(runtime);

  if (!userCrypto) {
    return {
      locked: rawStoredValue.startsWith(USER_CRYPTO_PREFIX),
      storedValue: rawStoredValue,
      value: ""
    };
  }

  const plain = await userCrypto.decryptText(rawStoredValue);

  return {
    locked: rawStoredValue.startsWith(USER_CRYPTO_PREFIX) && !plain,
    storedValue: rawStoredValue,
    value: String(plain || "").trim()
  };
}

// Encodes the in-memory Codex tokens for persistence. Mirrors the api_key
// contract: when the active session is locked (cannot currently decrypt the
// previously stored ciphertext) and the caller did not explicitly replace the
// tokens, the existing ciphertext must be preserved verbatim so signing in on
// another session still works.
//
// `settings.codexTokens` is the plaintext JSON string (what the frontend
// holds in memory). `settings.storedCodexTokensLocked` and
// `settings.storedCodexTokensValue` carry the locked-state bookkeeping that
// `decodeStoredCodexTokens` returned during the last load.
export async function encodeStoredCodexTokens(runtime, settings = {}) {
  const nextValue = typeof settings.codexTokens === "string" ? settings.codexTokens.trim() : "";
  const storedValue = typeof settings.storedCodexTokensValue === "string" ? settings.storedCodexTokensValue.trim() : "";

  if (
    settings.storedCodexTokensLocked === true &&
    !nextValue &&
    storedValue.startsWith(USER_CRYPTO_PREFIX)
  ) {
    return storedValue;
  }

  if (!nextValue) {
    return "";
  }

  if (isSingleUserAppRuntime(runtime)) {
    // In single-user mode userCrypto is a plaintext bypass, so storing the
    // plaintext JSON string matches what decryptText would return anyway.
    return nextValue;
  }

  const userCrypto = getUserCryptoRuntime(runtime);

  if (!userCrypto) {
    throw new Error("Unable to encrypt Codex tokens because userCrypto is unavailable.");
  }

  const encryptedValue = await userCrypto.encryptText(nextValue);

  if (!encryptedValue) {
    throw new Error("Unable to encrypt Codex tokens because userCrypto is unavailable.");
  }

  return encryptedValue;
}

