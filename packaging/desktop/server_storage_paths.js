const os = require("node:os");
const path = require("node:path");

function resolveDesktopServerTmpDir(options = {}) {
  if (!options.isPackaged) {
    return "";
  }

  const tempPath = String(options.tempPath || os.tmpdir());
  return path.join(tempPath, "space-agent", "server-tmp");
}

function resolveDesktopAuthDataDir(options = {}) {
  if (!options.isPackaged) {
    return "";
  }

  const userDataPath = String(options.userDataPath || "").trim();

  if (!userDataPath) {
    return "";
  }

  return path.join(userDataPath, "server", "data");
}

module.exports = {
  resolveDesktopAuthDataDir,
  resolveDesktopServerTmpDir
};
