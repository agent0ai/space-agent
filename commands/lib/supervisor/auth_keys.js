import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const AUTH_KEYS_FILENAME = "auth_keys.json";
const PASSWORD_SEAL_KEY_ENV_NAME = "SPACE_AUTH_PASSWORD_SEAL_KEY";
const SESSION_HMAC_KEY_ENV_NAME = "SPACE_AUTH_SESSION_HMAC_KEY";
const PASSWORD_SEAL_KEY_NAME = "password_seal_key";
const SESSION_HMAC_KEY_NAME = "session_hmac_key";
const SECRET_KEY_LENGTH = 32;

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function parseSecretKey(record, fieldName, sourceName) {
  const rawValue = String(record?.[fieldName] || "").trim();

  if (!rawValue) {
    throw new Error(`Missing ${fieldName} in ${sourceName}.`);
  }

  const decoded = decodeBase64Url(rawValue);
  if (decoded.length !== SECRET_KEY_LENGTH) {
    throw new Error(`Invalid ${fieldName} length in ${sourceName}.`);
  }

  return rawValue;
}

function createAuthKeysPayload() {
  return {
    created_at: new Date().toISOString(),
    [PASSWORD_SEAL_KEY_NAME]: encodeBase64Url(randomBytes(SECRET_KEY_LENGTH)),
    [SESSION_HMAC_KEY_NAME]: encodeBase64Url(randomBytes(SECRET_KEY_LENGTH))
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readOrCreateSupervisorAuthKeys(stateDir) {
  const dataDir = path.join(stateDir, "auth");
  const filePath = path.join(dataDir, AUTH_KEYS_FILENAME);

  await fs.mkdir(dataDir, {
    mode: 0o700,
    recursive: true
  });
  await fs.chmod(dataDir, 0o700).catch(() => {});

  try {
    const payload = await readJsonFile(filePath);

    return {
      filePath,
      passwordSealKey: parseSecretKey(payload, PASSWORD_SEAL_KEY_NAME, filePath),
      sessionHmacKey: parseSecretKey(payload, SESSION_HMAC_KEY_NAME, filePath),
      source: filePath
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const payload = createAuthKeysPayload();
  const sourceText = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    await fs.writeFile(filePath, sourceText, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }

  const storedPayload = await readJsonFile(filePath);

  return {
    filePath,
    passwordSealKey: parseSecretKey(storedPayload, PASSWORD_SEAL_KEY_NAME, filePath),
    sessionHmacKey: parseSecretKey(storedPayload, SESSION_HMAC_KEY_NAME, filePath),
    source: filePath
  };
}

async function loadSupervisorAuthEnv({ env = process.env, stateDir }) {
  const passwordSealKey = String(env[PASSWORD_SEAL_KEY_ENV_NAME] || "").trim();
  const sessionHmacKey = String(env[SESSION_HMAC_KEY_ENV_NAME] || "").trim();

  if (passwordSealKey || sessionHmacKey) {
    if (!passwordSealKey || !sessionHmacKey) {
      throw new Error(
        `Both ${PASSWORD_SEAL_KEY_ENV_NAME} and ${SESSION_HMAC_KEY_ENV_NAME} must be set together.`
      );
    }

    parseSecretKey({ [PASSWORD_SEAL_KEY_NAME]: passwordSealKey }, PASSWORD_SEAL_KEY_NAME, "process.env");
    parseSecretKey({ [SESSION_HMAC_KEY_NAME]: sessionHmacKey }, SESSION_HMAC_KEY_NAME, "process.env");

    return {
      env: {
        [PASSWORD_SEAL_KEY_ENV_NAME]: passwordSealKey,
        [SESSION_HMAC_KEY_ENV_NAME]: sessionHmacKey
      },
      source: "process.env"
    };
  }

  const keys = await readOrCreateSupervisorAuthKeys(stateDir);

  return {
    env: {
      [PASSWORD_SEAL_KEY_ENV_NAME]: keys.passwordSealKey,
      [SESSION_HMAC_KEY_ENV_NAME]: keys.sessionHmacKey
    },
    source: keys.source
  };
}

export {
  PASSWORD_SEAL_KEY_ENV_NAME,
  SESSION_HMAC_KEY_ENV_NAME,
  loadSupervisorAuthEnv
};
