const { listAppFiles, normalizePathSegment } = require("../lib/app-files.cjs");

function readPayload(context) {
  if (!context.body || typeof context.body !== "object" || Buffer.isBuffer(context.body)) {
    return {};
  }

  return context.body;
}

module.exports = {
  post(context) {
    const payload = readPayload(context);
    const extensionPoint = normalizePathSegment(payload.extension_point || "");
    const filters = Array.isArray(payload.filters)
      ? payload.filters.filter((value) => typeof value === "string" && value.trim())
      : [];

    if (!extensionPoint) {
      return {
        extensions: []
      };
    }

    const requestedPaths = (filters.length > 0 ? filters : ["*"]).map(
      (filter) => `extensions/${extensionPoint}/${filter}`
    );
    const matches = listAppFiles(context.appDir, requestedPaths);
    const extensions = [...new Set(matches.flatMap((item) => item.files))].sort((left, right) =>
      left.localeCompare(right)
    );

    return {
      extensions
    };
  }
};
