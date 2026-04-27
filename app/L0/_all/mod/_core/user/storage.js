export const PASSWORD_CHANGE_ENDPOINT = "password_change";
export const USER_CONFIG_PATH = "~/user.yaml";
export const USER_PASSWORD_PATH = "~/meta/password.json";

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (
    !runtime.api ||
    typeof runtime.api.call !== "function" ||
    typeof runtime.api.fileRead !== "function" ||
    typeof runtime.api.fileWrite !== "function" ||
    typeof runtime.api.userSelfInfo !== "function"
  ) {
    throw new Error("space.api helpers are not available.");
  }

  if (
    !runtime.utils ||
    !runtime.utils.userCrypto ||
    typeof runtime.utils.userCrypto.buildPasswordRewrap !== "function" ||
    !runtime.utils.yaml ||
    typeof runtime.utils.yaml.parse !== "function" ||
    typeof runtime.utils.yaml.stringify !== "function"
  ) {
    throw new Error("space.utils userCrypto or yaml helpers are not available.");
  }

  return runtime;
}

function normalizeList(values) {
  return Array.isArray(values) ? values.map((value) => String(value || "")).filter(Boolean) : [];
}

function normalizeIdentity(identity = {}) {
  const username = String(identity?.username || "").trim();
  const fullName = String(identity?.fullName || "").trim() || username;

  return {
    fullName,
    groups: normalizeList(identity?.groups),
    managedGroups: normalizeList(identity?.managedGroups),
    username
  };
}

function normalizeFullName(fullName, username) {
  const normalizedFullName = String(fullName ?? "").trim();
  return normalizedFullName || String(username || "").trim();
}

async function readUserConfig(runtime) {
  // Idempotent read: a fresh user has no `~/user.yaml` yet. Use ifExists so
  // the missing file returns content: null instead of throwing 404.
  try {
    const result = await runtime.api.fileRead(USER_CONFIG_PATH, "utf8", { ifExists: true });
    const parsed = runtime.utils.yaml.parse(String(result?.content || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`Unable to load ${USER_CONFIG_PATH}: ${error.message}`);
  }
}

function resolveFullName(identity, config = {}) {
  return normalizeFullName(config?.full_name || identity?.fullName, identity?.username);
}

export function isSingleUserRuntime() {
  const runtime = globalThis.space;
  return Boolean(runtime?.config?.get?.("SINGLE_USER_APP", false));
}

export async function loadUserSettings() {
  const runtime = getRuntime();
  const [identityResult, config] = await Promise.all([runtime.api.userSelfInfo(), readUserConfig(runtime)]);
  const identity = normalizeIdentity(identityResult);

  return {
    config,
    fullName: resolveFullName(identity, config),
    identity
  };
}

export async function saveUserFullName(fullName, options = {}) {
  const runtime = getRuntime();
  const username = String(options.username || "").trim();
  const currentConfig = await readUserConfig(runtime);
  const nextFullName = normalizeFullName(fullName, username);
  const nextConfig = {
    ...currentConfig,
    full_name: nextFullName
  };

  try {
    await runtime.api.fileWrite(USER_CONFIG_PATH, runtime.utils.yaml.stringify(nextConfig), "utf8");
  } catch (error) {
    throw new Error(`Unable to save ${USER_CONFIG_PATH}: ${error.message}`);
  }

  return {
    config: nextConfig,
    fullName: nextFullName
  };
}

export async function changeUserPassword(currentPassword, newPassword) {
  const runtime = getRuntime();
  const userCryptoRecord = await runtime.utils.userCrypto.buildPasswordRewrap(newPassword);

  try {
    const result = await runtime.api.call(PASSWORD_CHANGE_ENDPOINT, {
      body: {
        currentPassword,
        newPassword,
        userCryptoRecord
      },
      method: "POST"
    });
    runtime.utils.userCrypto.clearSession?.();
    return result;
  } catch (error) {
    throw new Error(`Unable to change password: ${error.message}`);
  }
}
