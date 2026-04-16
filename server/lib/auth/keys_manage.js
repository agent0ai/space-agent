import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AUTH_DATA_DIRNAME = "data";
const AUTH_KEYS_FILENAME = "auth_keys.json";
const AUTH_DATA_DIR_ENV_NAME = "SPACE_AUTH_DATA_DIR";
const PASSWORD_SEAL_KEY_ENV_NAME = "SPACE_AUTH_PASSWORD_SEAL_KEY";
const PASSWORD_SEAL_KEY_NAME = "password_seal_key";
const SECRET_KEY_LENGTH = 32;
const SESSION_HMAC_KEY_ENV_NAME = "SPACE_AUTH_SESSION_HMAC_KEY";
const SESSION_HMAC_KEY_NAME = "session_hmac_key";

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function setPermissionsIfPossible(targetPath, mode) {
  try {
    fs.chmodSync(targetPath, mode);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function resolveAuthDataDirOverride(env = process.env) {
  const override = String(env?.[AUTH_DATA_DIR_ENV_NAME] || "").trim();
  return override ? path.resolve(override) : "";
}

function buildAuthDataDir(projectRoot, env = process.env) {
  return resolveAuthDataDirOverride(env) || path.join(String(projectRoot || ""), "server", AUTH_DATA_DIRNAME);
}

function ensureAuthDataDir(projectRoot, env = process.env) {
  const dataDir = buildAuthDataDir(projectRoot, env);
  fs.mkdirSync(dataDir, {
    mode: 0o700,
    recursive: true
  });
  setPermissionsIfPossible(dataDir, 0o700);
  return dataDir;
}

function parseSecretKey(record, fieldName, filePath) {
  const rawValue = String(record?.[fieldName] || "").trim();

  if (!rawValue) {
    throw new Error(`Missing ${fieldName} in ${filePath}.`);
  }

  const decoded = decodeBase64Url(rawValue);

  if (decoded.length !== SECRET_KEY_LENGTH) {
    throw new Error(`Invalid ${fieldName} length in ${filePath}.`);
  }

  return decoded;
}

function readInjectedAuthKeys(env = process.env) {
  const passwordSealKey = String(env?.[PASSWORD_SEAL_KEY_ENV_NAME] || "").trim();
  const sessionHmacKey = String(env?.[SESSION_HMAC_KEY_ENV_NAME] || "").trim();

  if (!passwordSealKey && !sessionHmacKey) {
    return null;
  }

  if (!passwordSealKey || !sessionHmacKey) {
    throw new Error(
      `Both ${PASSWORD_SEAL_KEY_ENV_NAME} and ${SESSION_HMAC_KEY_ENV_NAME} must be set together.`
    );
  }

  return {
    created: false,
    dataDir: "",
    filePath: "process.env",
    passwordSealKey: parseSecretKey(
      {
        [PASSWORD_SEAL_KEY_NAME]: passwordSealKey
      },
      PASSWORD_SEAL_KEY_NAME,
      "process.env"
    ),
    sessionHmacKey: parseSecretKey(
      {
        [SESSION_HMAC_KEY_NAME]: sessionHmacKey
      },
      SESSION_HMAC_KEY_NAME,
      "process.env"
    )
  };
}

function parseAuthKeys(sourceText, filePath) {
  let parsed;

  try {
    parsed = JSON.parse(sourceText);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid auth key payload in ${filePath}.`);
  }

  return {
    dataDir: path.dirname(filePath),
    filePath,
    passwordSealKey: parseSecretKey(parsed, PASSWORD_SEAL_KEY_NAME, filePath),
    sessionHmacKey: parseSecretKey(parsed, SESSION_HMAC_KEY_NAME, filePath)
  };
}

function createAuthKeysPayload() {
  return {
    created_at: new Date().toISOString(),
    [PASSWORD_SEAL_KEY_NAME]: encodeBase64Url(randomBytes(SECRET_KEY_LENGTH)),
    [SESSION_HMAC_KEY_NAME]: encodeBase64Url(randomBytes(SECRET_KEY_LENGTH))
  };
}

function readExistingAuthKeys(filePath) {
  setPermissionsIfPossible(filePath, 0o600);
  return parseAuthKeys(fs.readFileSync(filePath, "utf8"), filePath);
}

function loadAuthKeys(projectRoot, env = process.env) {
  const injectedKeys = readInjectedAuthKeys(env);

  if (injectedKeys) {
    return injectedKeys;
  }

  const dataDir = ensureAuthDataDir(projectRoot, env);
  const filePath = path.join(dataDir, AUTH_KEYS_FILENAME);

  try {
    return {
      ...readExistingAuthKeys(filePath),
      created: false
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const payload = createAuthKeysPayload();
  const sourceText = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    fs.writeFileSync(filePath, sourceText, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    setPermissionsIfPossible(filePath, 0o600);

    return {
      ...parseAuthKeys(sourceText, filePath),
      created: true
    };
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }

  return {
    ...readExistingAuthKeys(filePath),
    created: false
  };
}

export {
  AUTH_DATA_DIR_ENV_NAME,
  AUTH_KEYS_FILENAME,
  PASSWORD_SEAL_KEY_ENV_NAME,
  SESSION_HMAC_KEY_ENV_NAME,
  buildAuthDataDir,
  ensureAuthDataDir,
  loadAuthKeys
};
