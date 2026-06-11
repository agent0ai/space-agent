const DASHBOARD_CONFIG_PATH = "~/conf/dashboard.yaml";
const DASHBOARD_WELCOME_HIDDEN_CHANGE_EVENT = "dashboard_welcome:hidden_change";

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (
    !runtime.api ||
    typeof runtime.api.fileRead !== "function" ||
    typeof runtime.api.fileWrite !== "function"
  ) {
    throw new Error("space.api file helpers are not available.");
  }

  if (
    !runtime.utils ||
    typeof runtime.utils !== "object" ||
    !runtime.utils.yaml ||
    typeof runtime.utils.yaml.parse !== "function" ||
    typeof runtime.utils.yaml.stringify !== "function"
  ) {
    throw new Error("space.utils.yaml is not available.");
  }

  return runtime;
}

function parseStoredBoolean(value) {
  if (value === true || value === false) {
    return value;
  }

  const normalizedValue = String(value ?? "").trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return false;
}

function normalizeDashboardPrefs(parsedConfig) {
  const storedConfig = parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};

  return {
    welcomeHidden: parseStoredBoolean(storedConfig.welcome_hidden ?? storedConfig.welcomeHidden)
  };
}

function buildDashboardPrefsPayload(prefs = {}) {
  return {
    welcome_hidden: prefs.welcomeHidden === true
  };
}

function notifyDashboardWelcomeHiddenChange(hidden) {
  window.dispatchEvent(
    new CustomEvent(DASHBOARD_WELCOME_HIDDEN_CHANGE_EVENT, {
      detail: {
        hidden: hidden === true
      }
    })
  );
}

export function subscribeDashboardWelcomeHiddenChange(callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  const handleChange = (event) => {
    callback(event?.detail?.hidden === true);
  };

  window.addEventListener(DASHBOARD_WELCOME_HIDDEN_CHANGE_EVENT, handleChange);
  return () => window.removeEventListener(DASHBOARD_WELCOME_HIDDEN_CHANGE_EVENT, handleChange);
}

export async function loadDashboardPrefs() {
  const runtime = getRuntime();

  // Idempotent read: a fresh user has no `~/conf/dashboard.yaml` yet. Use
  // ifExists so the missing file returns content: null instead of throwing
  // 404 (and triggering DevTools console noise on every space switch).
  try {
    const result = await runtime.api.fileRead(DASHBOARD_CONFIG_PATH, "utf8", { ifExists: true });
    return normalizeDashboardPrefs(runtime.utils.yaml.parse(String(result?.content || "")));
  } catch (error) {
    throw new Error(`Unable to load dashboard settings: ${error.message}`);
  }
}

async function saveDashboardPrefs(nextPrefs) {
  const runtime = getRuntime();
  const expectedPrefs = buildDashboardPrefsPayload(nextPrefs);
  const content = runtime.utils.yaml.stringify(expectedPrefs);

  try {
    await runtime.api.fileWrite(DASHBOARD_CONFIG_PATH, `${content}\n`);
    const result = await runtime.api.fileRead(DASHBOARD_CONFIG_PATH);
    const savedPrefs = normalizeDashboardPrefs(runtime.utils.yaml.parse(String(result?.content || "")));

    if (savedPrefs.welcomeHidden !== (expectedPrefs.welcome_hidden === true)) {
      throw new Error("Saved dashboard settings did not match the requested value.");
    }

    return savedPrefs;
  } catch (error) {
    throw new Error(`Unable to save dashboard settings: ${error.message}`);
  }
}

export async function setDashboardWelcomeHidden(hidden) {
  const savedPrefs = await saveDashboardPrefs({
    welcomeHidden: hidden === true
  });

  notifyDashboardWelcomeHiddenChange(savedPrefs.welcomeHidden);
  return savedPrefs;
}
