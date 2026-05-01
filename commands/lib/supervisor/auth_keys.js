import { loadAuthKeys } from "../../../server/lib/auth/keys_manage.js";

const PASSWORD_SEAL_KEY_ENV_NAME = "SPACE_AUTH_PASSWORD_SEAL_KEY";
const SESSION_HMAC_KEY_ENV_NAME = "SPACE_AUTH_SESSION_HMAC_KEY";
const PASSWORD_SEAL_KEY_NAME = "password_seal_key";
const SESSION_HMAC_KEY_NAME = "session_hmac_key";
const SECRET_KEY_LENGTH = 32;

function parseSecretKey(record, fieldName, sourceName) {
  const rawValue = String(record?.[fieldName] || "").trim();

  if (!rawValue) {
    throw new Error(`Missing ${fieldName} in ${sourceName}.`);
  }

  if (Buffer.from(rawValue, "base64url").length !== SECRET_KEY_LENGTH) {
    throw new Error(`Invalid ${fieldName} length in ${sourceName}.`);
  }

  return rawValue;
}

function encodeAuthKey(value) {
  return Buffer.isBuffer(value) ? Buffer.from(value).toString("base64url") : String(value || "");
}

async function loadSupervisorAuthEnv({ env = process.env, projectRoot }) {
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

  const keys = loadAuthKeys(projectRoot, env);

  return {
    env: {
      [PASSWORD_SEAL_KEY_ENV_NAME]: encodeAuthKey(keys.passwordSealKey),
      [SESSION_HMAC_KEY_ENV_NAME]: encodeAuthKey(keys.sessionHmacKey)
    },
    source: keys.filePath || keys.source || "server/data/auth_keys.json"
  };
}

export {
  PASSWORD_SEAL_KEY_ENV_NAME,
  SESSION_HMAC_KEY_ENV_NAME,
  loadSupervisorAuthEnv
};
