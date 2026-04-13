import fs from "node:fs";
import { randomBytes } from "node:crypto";

import { createPasswordVerifier } from "./passwords.js";
import { loadAuthKeys } from "./keys_manage.js";
import { recordAppPathMutations } from "../customware/git_history.js";
import {
  buildUserAbsolutePath,
  ensureUserStructure,
  normalizeUsername,
  readUserConfig,
  writeUserConfig,
  writeUserLogins,
  writeUserPasswordVerifier
} from "./user_files.js";

const GUEST_USERNAME_PREFIX = "guest_";
const GUEST_USERNAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const GENERATED_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const GUEST_USERNAME_SUFFIX_LENGTH = 6;
const GENERATED_PASSWORD_LENGTH = 18;
const GUEST_CREATION_MAX_ATTEMPTS = 64;

function createRandomString(length, alphabet) {
  const normalizedLength = Number(length);
  const sourceAlphabet = String(alphabet || "");

  if (!Number.isInteger(normalizedLength) || normalizedLength <= 0 || !sourceAlphabet) {
    return "";
  }

  const bytes = randomBytes(normalizedLength);
  let output = "";

  for (let index = 0; index < normalizedLength; index += 1) {
    output += sourceAlphabet[bytes[index] % sourceAlphabet.length];
  }

  return output;
}

function removeLegacyPasswordFields(config = {}) {
  const {
    password: _password,
    password_iterations: _passwordIterations,
    password_salt: _passwordSalt,
    password_scheme: _passwordScheme,
    password_server_key: _passwordServerKey,
    password_stored_key: _passwordStoredKey,
    ...rest
  } = config;

  return rest;
}

function normalizeFullName(fullName, username) {
  const normalizedFullName = String(fullName || "").trim();
  return normalizedFullName || String(username || "");
}

function createUserInternal(projectRoot, username, password, options = {}, authKeys) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  const runtimeParams = options.runtimeParams || null;
  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername, "", runtimeParams);

  if (fs.existsSync(userDir)) {
    if (!options.force) {
      throw new Error(`User already exists: ${normalizedUsername}`);
    }

    fs.rmSync(userDir, { force: true, recursive: true });
  }

  ensureUserStructure(projectRoot, normalizedUsername, runtimeParams);
  writeUserConfig(projectRoot, normalizedUsername, {
    full_name: normalizeFullName(options.fullName, normalizedUsername)
  }, runtimeParams);
  writeUserPasswordVerifier(
    projectRoot,
    normalizedUsername,
    createPasswordVerifier(password, authKeys),
    runtimeParams
  );
  writeUserLogins(projectRoot, normalizedUsername, {}, runtimeParams);
  recordAppPathMutations(
    {
      projectRoot,
      runtimeParams
    },
    [
      `/app/L2/${normalizedUsername}/`,
      `/app/L2/${normalizedUsername}/meta/`,
      `/app/L2/${normalizedUsername}/meta/logins.json`,
      `/app/L2/${normalizedUsername}/meta/password.json`,
      `/app/L2/${normalizedUsername}/mod/`,
      `/app/L2/${normalizedUsername}/user.yaml`
    ]
  );

  return {
    userDir,
    username: normalizedUsername
  };
}

function createUser(projectRoot, username, password, options = {}) {
  return createUserInternal(projectRoot, username, password, options, loadAuthKeys(projectRoot));
}

function isGuestUsername(username) {
  return normalizeUsername(username).startsWith(GUEST_USERNAME_PREFIX);
}

function setUserPassword(projectRoot, username, password, options = {}) {
  const authKeys = loadAuthKeys(projectRoot);
  const normalizedUsername = normalizeUsername(username);
  const runtimeParams = options.runtimeParams || null;

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  const currentConfig = readUserConfig(projectRoot, normalizedUsername, runtimeParams);
  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername, "", runtimeParams);

  if (!fs.existsSync(userDir)) {
    throw new Error(`User does not exist: ${normalizedUsername}`);
  }

  ensureUserStructure(projectRoot, normalizedUsername, runtimeParams);

  writeUserConfig(projectRoot, normalizedUsername, {
    ...removeLegacyPasswordFields(currentConfig),
    full_name: normalizeFullName(currentConfig.full_name, normalizedUsername)
  }, runtimeParams);
  writeUserPasswordVerifier(
    projectRoot,
    normalizedUsername,
    createPasswordVerifier(password, authKeys),
    runtimeParams
  );
  writeUserLogins(projectRoot, normalizedUsername, {}, runtimeParams);
  recordAppPathMutations(
    {
      projectRoot,
      runtimeParams
    },
    [`/app/L2/${normalizedUsername}/meta/password.json`, `/app/L2/${normalizedUsername}/meta/logins.json`]
  );

  return {
    userDir,
    username: normalizedUsername
  };
}

function createGuestUser(projectRoot, options = {}) {
  const authKeys = loadAuthKeys(projectRoot);
  const password = String(options.password || createRandomString(GENERATED_PASSWORD_LENGTH, GENERATED_PASSWORD_ALPHABET));
  const runtimeParams = options.runtimeParams || null;

  for (let attempt = 0; attempt < GUEST_CREATION_MAX_ATTEMPTS; attempt += 1) {
    const username = `${GUEST_USERNAME_PREFIX}${createRandomString(
      GUEST_USERNAME_SUFFIX_LENGTH,
      GUEST_USERNAME_ALPHABET
    )}`;

    if (fs.existsSync(buildUserAbsolutePath(projectRoot, username, "", runtimeParams))) {
      continue;
    }

    try {
      createUserInternal(projectRoot, username, password, { runtimeParams }, authKeys);
    } catch (error) {
      if (String(error?.message || "").startsWith("User already exists:")) {
        continue;
      }

      throw error;
    }

    return {
      password,
      username
    };
  }

  throw new Error("Failed to create guest account. Try again.");
}

function deleteUser(projectRoot, username, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const runtimeParams = options.runtimeParams || null;

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername, "", runtimeParams);

  if (!fs.existsSync(userDir)) {
    return false;
  }

  fs.rmSync(userDir, {
    force: true,
    recursive: true
  });
  recordAppPathMutations(
    {
      projectRoot,
      runtimeParams
    },
    [`/app/L2/${normalizedUsername}/`]
  );

  return true;
}

function deleteGuestUser(projectRoot, username, options = {}) {
  const normalizedUsername = normalizeUsername(username);

  if (!isGuestUsername(normalizedUsername)) {
    throw new Error(`Refusing to delete non-guest user through deleteGuestUser(): ${normalizedUsername}`);
  }

  return deleteUser(projectRoot, normalizedUsername, options);
}

export {
  createGuestUser,
  createUser,
  deleteGuestUser,
  deleteUser,
  isGuestUsername,
  setUserPassword
};
