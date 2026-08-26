import fs from "node:fs/promises";
import path from "node:path";

import {
  AUTH_KEYS_FILENAME,
  PASSWORD_SEAL_KEY_ENV_NAME,
  SESSION_HMAC_KEY_ENV_NAME,
  buildAuthDataDir,
  loadAuthKeys
} from "../../../server/lib/auth/keys_manage.js";

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

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return false;
}

async function chmodIfPossible(filePath, mode) {
  try {
    await fs.chmod(filePath, mode);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function buildAuthEnv(authKeys) {
  return {
    [PASSWORD_SEAL_KEY_ENV_NAME]: encodeBase64Url(authKeys.passwordSealKey),
    [SESSION_HMAC_KEY_ENV_NAME]: encodeBase64Url(authKeys.sessionHmacKey)
  };
}

function buildLegacySupervisorAuthKeysPath(stateDir) {
  return path.join(stateDir, "auth", AUTH_KEYS_FILENAME);
}

async function migrateLegacySupervisorAuthKeys({ env, projectRoot, stateDir }) {
  if (!stateDir) {
    return "";
  }

  const dataDir = buildAuthDataDir(projectRoot, env);
  const filePath = path.join(dataDir, AUTH_KEYS_FILENAME);

  if (await pathExists(filePath)) {
    return "";
  }

  const legacyFilePath = buildLegacySupervisorAuthKeysPath(stateDir);
  let payload;

  try {
    payload = await readJsonFile(legacyFilePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  }

  parseSecretKey(payload, PASSWORD_SEAL_KEY_NAME, legacyFilePath);
  parseSecretKey(payload, SESSION_HMAC_KEY_NAME, legacyFilePath);

  await fs.mkdir(dataDir, {
    mode: 0o700,
    recursive: true
  });
  await chmodIfPossible(dataDir, 0o700);

  try {
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await chmodIfPossible(filePath, 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    return "";
  }

  return legacyFilePath;
}

async function loadSupervisorAuthEnv({ env = process.env, projectRoot, stateDir }) {
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

  const resolvedProjectRoot = String(projectRoot || "").trim();

  if (!resolvedProjectRoot) {
    throw new Error("loadSupervisorAuthEnv requires projectRoot.");
  }

  const migratedFrom = await migrateLegacySupervisorAuthKeys({
    env,
    projectRoot: resolvedProjectRoot,
    stateDir
  });
  const keys = loadAuthKeys(resolvedProjectRoot, env);

  return {
    env: buildAuthEnv(keys),
    source: migratedFrom ? `${keys.filePath} (migrated from ${migratedFrom})` : keys.filePath
  };
}

export {
  PASSWORD_SEAL_KEY_ENV_NAME,
  SESSION_HMAC_KEY_ENV_NAME,
  loadSupervisorAuthEnv
};
