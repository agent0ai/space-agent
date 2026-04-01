const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function loadApiRegistry(apiDir) {
  const registry = new Map();
  const entries = fs.readdirSync(apiDir, { withFileTypes: true });

  entries.forEach((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      return;
    }

    const endpointName = entry.name.replace(/\.js$/, "");
    const endpointModule = require(path.join(apiDir, entry.name));
    const handlers = {};

    SUPPORTED_METHODS.forEach((method) => {
      if (typeof endpointModule[method] === "function") {
        handlers[method] = endpointModule[method];
      }
    });

    registry.set(endpointName, {
      endpointName,
      handlers
    });
  });

  return registry;
}

module.exports = {
  SUPPORTED_METHODS,
  loadApiRegistry
};
