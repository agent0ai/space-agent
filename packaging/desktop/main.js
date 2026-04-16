const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, net } = require("electron");
const {
  resolveDesktopAuthDataDir,
  resolveDesktopServerTmpDir
} = require("./server_storage_paths");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SERVER_APP_PATH = path.join(PROJECT_ROOT, "server", "app.js");
const BASE_WINDOW_TITLE = "Space Agent";
const DESKTOP_UPDATE_RENDERER_LOG_LIMIT = 48;
const DESKTOP_UPDATE_FAILURE_STATUS_LIMIT = 120;
const AUTH_DATA_DIR_ENV_NAME = "SPACE_AUTH_DATA_DIR";

let serverRuntime;
let mainWindow;
let isQuitting = false;
let updateStatusClearTimer = null;
let desktopAutoUpdater = null;
let desktopPageTitle = BASE_WINDOW_TITLE;
let desktopUpdateStatusMessage = "";
let desktopUpdateRendererLogQueue = [];
let isFlushingDesktopRendererLogs = false;
let lastDesktopUpdateFailureKey = "";
let lastDesktopUpdateFailureAt = 0;
let desktopUpdateCheckPromise = null;
let desktopUpdateDownloadPromise = null;
let desktopUpdateState = {
  state: "idle",
  message: "",
  progress: null,
  version: ""
};

function createDesktopRuntimeParamOverrides() {
  const overrides = {};

  if (app.isPackaged) {
    overrides.WORKERS = "1";
    overrides.SINGLE_USER_APP = "true";
    overrides.CUSTOMWARE_PATH = path.join(app.getPath("userData"), "customware");
  }

  return overrides;
}

function createDesktopServerOptions(runtimeParamOverrides) {
  const serverOptions = {
    host: "127.0.0.1",
    port: 0,
    projectRoot: PROJECT_ROOT,
    runtimeParamOverrides
  };

  const tmpDir = resolveDesktopServerTmpDir({
    isPackaged: app.isPackaged,
    tempPath: app.getPath("temp")
  });

  if (tmpDir) {
    serverOptions.tmpDir = tmpDir;
  }

  return serverOptions;
}

function applyPackagedDesktopStorageOverrides() {
  const authDataDir = resolveDesktopAuthDataDir({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath("userData")
  });

  if (authDataDir && !process.env[AUTH_DATA_DIR_ENV_NAME]) {
    process.env[AUTH_DATA_DIR_ENV_NAME] = authDataDir;
  }
}

function resolveDesktopLaunchPath() {
  return serverRuntime?.runtimeParams?.get?.("SINGLE_USER_APP", false) ? "/enter" : "/";
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function clearUpdateStatusSoon(delayMs = 5000) {
  if (updateStatusClearTimer) {
    clearTimeout(updateStatusClearTimer);
  }

  updateStatusClearTimer = setTimeout(() => {
    updateStatusClearTimer = null;
    setDesktopUpdateStatus("");
  }, delayMs);
}

function normalizeDesktopWindowTitle(value) {
  const normalized = String(value || "").trim();
  return normalized || BASE_WINDOW_TITLE;
}

function formatDesktopDisplayVersion(value) {
  const normalized = String(value || "").trim().replace(/^v/u, "");
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (!match) {
    return normalized;
  }

  return Number(match[3]) === 0 ? `${match[1]}.${match[2]}` : normalized;
}

function refreshDesktopWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const titleParts = [normalizeDesktopWindowTitle(desktopPageTitle)];
  if (desktopUpdateStatusMessage) {
    titleParts.push(desktopUpdateStatusMessage);
  }

  mainWindow.setTitle(titleParts.join(" - "));
}

function setDesktopUpdateStatus(message, progress = null) {
  desktopUpdateStatusMessage = String(message || "").trim();

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  refreshDesktopWindowTitle();

  if (progress === "indeterminate") {
    mainWindow.setProgressBar(2);
    return;
  }

  if (Number.isFinite(progress)) {
    mainWindow.setProgressBar(Math.max(0, Math.min(1, progress)));
    return;
  }

  mainWindow.setProgressBar(-1);
}

function setDesktopUpdateState(nextState = {}) {
  desktopUpdateState = {
    ...desktopUpdateState,
    ...nextState
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("space-desktop:update-status", desktopUpdateState);
  }
}

function prepareDesktopForQuit() {
  isQuitting = true;
}

function getDesktopRuntimeInfo() {
  const canCheckForUpdates = shouldEnableDesktopAutoUpdate() && Boolean(loadDesktopAutoUpdater());

  return {
    platform: process.platform,
    isBundledApp: app.isPackaged,
    canCheckForUpdates,
    updateStatus: desktopUpdateState
  };
}

function truncateDesktopUpdateStatus(value, maxLength = DESKTOP_UPDATE_FAILURE_STATUS_LIMIT) {
  const normalized = String(value || "").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function collectDesktopUpdateErrorDetails(error) {
  const details = [];

  if (!error || typeof error !== "object") {
    return details;
  }

  if (error.name) {
    details.push(`name: ${error.name}`);
  }

  if (error.code) {
    details.push(`code: ${error.code}`);
  }

  if (Number.isFinite(Number(error.statusCode))) {
    details.push(`statusCode: ${Number(error.statusCode)}`);
  }

  if (error.method) {
    details.push(`method: ${error.method}`);
  }

  if (error.url) {
    details.push(`url: ${error.url}`);
  }

  if (error.stack) {
    details.push(String(error.stack));
  }

  return details;
}

function formatDesktopUpdateError(error) {
  if (!error) {
    return {
      summary: "Unknown updater error.",
      details: []
    };
  }

  if (typeof error === "string") {
    const summary = String(error).trim();
    return {
      summary: summary || "Unknown updater error.",
      details: summary ? [summary] : []
    };
  }

  const summary = String(error.message || error.stack || error).trim();
  const details = collectDesktopUpdateErrorDetails(error);

  if (!details.length && summary) {
    details.push(summary);
  }

  return {
    summary: summary || "Unknown updater error.",
    details
  };
}

function queueDesktopRendererLog(level, lines) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    lines: Array.isArray(lines) ? lines.filter(Boolean) : []
  };

  desktopUpdateRendererLogQueue.push(entry);
  if (desktopUpdateRendererLogQueue.length > DESKTOP_UPDATE_RENDERER_LOG_LIMIT) {
    desktopUpdateRendererLogQueue = desktopUpdateRendererLogQueue.slice(-DESKTOP_UPDATE_RENDERER_LOG_LIMIT);
  }
}

function flushDesktopRendererLogs() {
  if (!mainWindow || mainWindow.isDestroyed() || !desktopUpdateRendererLogQueue.length || isFlushingDesktopRendererLogs) {
    return;
  }

  const pendingEntries = desktopUpdateRendererLogQueue.slice();
  const script = `(() => {
    const entries = ${JSON.stringify(pendingEntries)};
    for (const entry of entries) {
      const method = entry.level === "error" ? "error" : entry.level === "warn" ? "warn" : "log";
      const prefix = "[space-desktop/updater]";
      const body = Array.isArray(entry.lines) ? entry.lines.join("\\n") : "";
      console[method](prefix + " " + entry.timestamp + "\\n" + body);
    }
  })();`;

  isFlushingDesktopRendererLogs = true;
  mainWindow.webContents
    .executeJavaScript(script, true)
    .then(() => {
      desktopUpdateRendererLogQueue = desktopUpdateRendererLogQueue.slice(pendingEntries.length);
      isFlushingDesktopRendererLogs = false;
      if (desktopUpdateRendererLogQueue.length) {
        flushDesktopRendererLogs();
      }
    })
    .catch(() => {
      isFlushingDesktopRendererLogs = false;
      // Keep the buffered logs so the next page load can print them.
    });
}

function logDesktopUpdateEvent(message, { level = "log", error = null } = {}) {
  const formattedError = error ? formatDesktopUpdateError(error) : null;
  const lines = [`[desktop-updater] ${message}`];

  if (formattedError?.summary) {
    lines.push(`summary: ${formattedError.summary}`);
  }

  if (formattedError?.details?.length) {
    lines.push(...formattedError.details);
  }

  lines.forEach((line) => {
    console[level](line);
  });

  queueDesktopRendererLog(level, lines);
  flushDesktopRendererLogs();

  return formattedError;
}

function buildDesktopUpdateFailureStatus(error) {
  const { summary } = formatDesktopUpdateError(error);
  return truncateDesktopUpdateStatus(`Update check failed: ${summary}`);
}

function reportDesktopUpdateFailure(message, error) {
  const formattedError = formatDesktopUpdateError(error);
  const failureKey = `${message}::${formattedError.summary}`;
  const now = Date.now();

  if (failureKey === lastDesktopUpdateFailureKey && now - lastDesktopUpdateFailureAt < 2000) {
    return formattedError;
  }

  lastDesktopUpdateFailureKey = failureKey;
  lastDesktopUpdateFailureAt = now;

  logDesktopUpdateEvent(message, { level: "error", error });
  setDesktopUpdateStatus(buildDesktopUpdateFailureStatus(error));
  setDesktopUpdateState({
    state: "error",
    message: formattedError.summary,
    progress: null,
    version: ""
  });
  clearUpdateStatusSoon(15000);

  return formattedError;
}

function shouldEnableDesktopAutoUpdate() {
  return app.isPackaged;
}

function loadDesktopAutoUpdater() {
  if (desktopAutoUpdater) {
    return desktopAutoUpdater;
  }

  try {
    ({ autoUpdater: desktopAutoUpdater } = require("electron-updater"));
  } catch (error) {
    logDesktopUpdateEvent("Desktop auto-update is unavailable.", { level: "warn", error });
    desktopAutoUpdater = null;
  }

  return desktopAutoUpdater;
}

function isDesktopNetworkOnline() {
  try {
    return !net || typeof net.isOnline !== "function" || net.isOnline();
  } catch (error) {
    reportDesktopUpdateFailure("Could not determine desktop network status.", error);
    return true;
  }
}

async function checkForDesktopUpdates({ userInitiated = false } = {}) {
  if (!shouldEnableDesktopAutoUpdate()) {
    return { ok: false, reason: "unavailable" };
  }

  const autoUpdater = loadDesktopAutoUpdater();
  if (!autoUpdater) {
    return { ok: false, reason: "unavailable" };
  }

  if (desktopUpdateCheckPromise) {
    return desktopUpdateCheckPromise;
  }

  if (!isDesktopNetworkOnline()) {
    const message = "Update check skipped while offline.";
    logDesktopUpdateEvent(`Desktop ${message.toLowerCase()}`);
    setDesktopUpdateStatus(message);
    setDesktopUpdateState({
      state: "offline",
      message,
      progress: null,
      version: ""
    });
    clearUpdateStatusSoon();
    return { ok: false, reason: "offline", message };
  }

  desktopUpdateCheckPromise = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = formatDesktopDisplayVersion(result?.updateInfo?.version);

      return {
        ok: true,
        status: desktopUpdateState.state || "checked",
        version
      };
    } catch (error) {
      const formattedError = reportDesktopUpdateFailure(
        userInitiated ? "Desktop update check failed." : "Desktop auto-update check failed.",
        error
      );

      return {
        ok: false,
        reason: "error",
        message: formattedError.summary
      };
    } finally {
      desktopUpdateCheckPromise = null;
    }
  })();

  return desktopUpdateCheckPromise;
}

async function downloadDesktopUpdate() {
  if (!shouldEnableDesktopAutoUpdate()) {
    return { ok: false, reason: "unavailable" };
  }

  const autoUpdater = loadDesktopAutoUpdater();
  if (!autoUpdater) {
    return { ok: false, reason: "unavailable" };
  }

  if (desktopUpdateState.state === "downloaded") {
    return { ok: true, status: "downloaded", version: desktopUpdateState.version || "" };
  }

  if (desktopUpdateDownloadPromise) {
    return desktopUpdateDownloadPromise;
  }

  if (desktopUpdateState.state !== "update-available") {
    return { ok: false, reason: "not-ready", message: "No downloaded desktop update is ready yet." };
  }

  desktopUpdateDownloadPromise = (async () => {
    try {
      await autoUpdater.downloadUpdate();
      return {
        ok: true,
        status: "downloading",
        version: desktopUpdateState.version || ""
      };
    } catch (error) {
      const formattedError = reportDesktopUpdateFailure("Desktop update download failed.", error);
      return {
        ok: false,
        reason: "error",
        message: formattedError.summary
      };
    } finally {
      desktopUpdateDownloadPromise = null;
    }
  })();

  return desktopUpdateDownloadPromise;
}

function installDesktopUpdate() {
  if (!shouldEnableDesktopAutoUpdate()) {
    return { ok: false, reason: "unavailable" };
  }

  const autoUpdater = loadDesktopAutoUpdater();
  if (!autoUpdater) {
    return { ok: false, reason: "unavailable" };
  }

  if (desktopUpdateState.state !== "downloaded") {
    return { ok: false, reason: "not-ready", message: "No downloaded update is ready to install yet." };
  }

  logDesktopUpdateEvent("Installing downloaded desktop update.");
  setDesktopUpdateStatus("Restarting to install update...");
  setDesktopUpdateState({
    state: "installing",
    message: "",
    progress: null
  });
  // Electron emits before-quit after updater-triggered window close events on macOS,
  // so the host must mark updater restarts as real quits before calling quitAndInstall().
  prepareDesktopForQuit();
  setImmediate(() => {
    autoUpdater.quitAndInstall();
  });

  return { ok: true, status: "installing", version: desktopUpdateState.version || "" };
}

function configureDesktopAutoUpdate() {
  if (!shouldEnableDesktopAutoUpdate()) {
    return;
  }

  const autoUpdater = loadDesktopAutoUpdater();
  if (!autoUpdater) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = console;

  autoUpdater.on("checking-for-update", () => {
    logDesktopUpdateEvent("Checking GitHub Releases for a desktop update...");
    setDesktopUpdateStatus("Checking for updates...", "indeterminate");
    setDesktopUpdateState({
      state: "checking",
      message: "Checking for updates...",
      progress: null,
      version: ""
    });
  });

  autoUpdater.on("update-available", (info) => {
    const version = formatDesktopDisplayVersion(info?.version);
    logDesktopUpdateEvent(version ? `Desktop update available: ${version}` : "Desktop update available.");
    setDesktopUpdateStatus(version ? `Update ${version} available` : "Update available");
    setDesktopUpdateState({
      state: "update-available",
      message: version ? `Update ${version} is available.` : "A desktop update is available.",
      progress: null,
      version
    });
  });

  autoUpdater.on("update-not-available", () => {
    logDesktopUpdateEvent("Desktop app is already up to date.");
    setDesktopUpdateStatus("");
    setDesktopUpdateState({
      state: "up-to-date",
      message: "",
      progress: null,
      version: ""
    });
  });

  autoUpdater.on("error", (error) => {
    reportDesktopUpdateFailure("Desktop auto-update failed.", error);
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number(progress && progress.percent);
    if (!Number.isFinite(percent)) {
      setDesktopUpdateStatus("Downloading update...", "indeterminate");
      setDesktopUpdateState({
        state: "downloading",
        message: "Downloading update...",
        progress: null
      });
      return;
    }

    const message = `Downloading update ${Math.round(percent)}%`;
    setDesktopUpdateStatus(message, percent / 100);
    setDesktopUpdateState({
      state: "downloading",
      message,
      progress: percent / 100
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const version = formatDesktopDisplayVersion(info?.version);
    logDesktopUpdateEvent(version ? `Desktop update downloaded: ${version}` : "Desktop update downloaded.");
    setDesktopUpdateStatus("Update ready to install");
    setDesktopUpdateState({
      state: "downloaded",
      message: version ? `Update ${version} is ready to install.` : "Update ready to install.",
      progress: null,
      version
    });
  });
}

async function loadCreateAgentServer() {
  const serverModule = await import(pathToFileURL(SERVER_APP_PATH).href);
  return serverModule.createAgentServer;
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f2efe8",
    title: BASE_WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  desktopPageTitle = BASE_WINDOW_TITLE;
  refreshDesktopWindowTitle();

  mainWindow.on("close", (event) => {
    // On macOS, Cmd+W should hide the app and preserve renderer state.
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    desktopPageTitle = BASE_WINDOW_TITLE;
  });

  mainWindow.webContents.on("page-title-updated", (event, title) => {
    event.preventDefault();
    desktopPageTitle = normalizeDesktopWindowTitle(title);
    refreshDesktopWindowTitle();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    desktopPageTitle = normalizeDesktopWindowTitle(mainWindow?.webContents?.getTitle?.() || desktopPageTitle);
    refreshDesktopWindowTitle();
    flushDesktopRendererLogs();
    mainWindow.webContents.send("space-desktop:update-status", desktopUpdateState);
  });

  mainWindow.loadURL(`${serverRuntime.browserUrl}${resolveDesktopLaunchPath()}`);
  return mainWindow;
}

function stopServerRuntime() {
  if (!serverRuntime) {
    return;
  }

  const runtime = serverRuntime;
  serverRuntime = null;

  if (runtime.watchdog && typeof runtime.watchdog.stop === "function") {
    runtime.watchdog.stop();
  }

  if (runtime.tmpWatch && typeof runtime.tmpWatch.stop === "function") {
    runtime.tmpWatch.stop();
  }

  if (runtime.server && runtime.server.listening) {
    runtime.server.close();
  }
}

async function startDesktop() {
  await app.whenReady();
  applyPackagedDesktopStorageOverrides();
  const runtimeParamOverrides = createDesktopRuntimeParamOverrides();
  const createAgentServer = await loadCreateAgentServer();
  serverRuntime = await createAgentServer(createDesktopServerOptions(runtimeParamOverrides));
  await serverRuntime.listen();
  createWindow();
  configureDesktopAutoUpdate();

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("space-desktop:get-runtime-info", () => getDesktopRuntimeInfo());
ipcMain.handle("space-desktop:check-for-updates", () => checkForDesktopUpdates({ userInitiated: true }));
ipcMain.handle("space-desktop:download-update", () => downloadDesktopUpdate());
ipcMain.handle("space-desktop:install-update", () => installDesktopUpdate());

app.on("before-quit", () => {
  prepareDesktopForQuit();
  stopServerRuntime();
});

startDesktop().catch((error) => {
  console.error("Failed to start desktop harness.");
  console.error(error);
  app.quit();
});
