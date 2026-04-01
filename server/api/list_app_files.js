const { listAppFiles } = require("../lib/app-files.cjs");

function readRequestedPaths(context) {
  const payload =
    context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
      ? context.body
      : {};

  if (!Array.isArray(payload.paths)) {
    return [];
  }

  return payload.paths
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

module.exports = {
  post(context) {
    const paths = readRequestedPaths(context);
    const matches = listAppFiles(context.appDir, paths);

    return {
      ok: true,
      matches
    };
  }
};
