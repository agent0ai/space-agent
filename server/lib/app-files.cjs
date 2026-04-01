const fs = require("node:fs");
const path = require("node:path");

function normalizePathSegment(input) {
  const rawValue = String(input || "").trim().replaceAll("\\", "/");
  const normalized = path.posix.normalize(`/${rawValue}`).slice(1);

  if (!normalized || normalized === ".") {
    return "";
  }

  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Path escapes app directory: ${input}`);
  }

  return normalized;
}

function hasGlob(pattern) {
  return /[*?[\]{}]/.test(pattern);
}

function escapeRegExpChar(char) {
  return /[\\^$.*+?()[\]{}|/]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern) {
  let out = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const nextChar = pattern[index + 1];
    const afterNextChar = pattern[index + 2];

    if (char === "*") {
      if (nextChar === "*" && afterNextChar === "/") {
        out += "(?:.*/)?";
        index += 2;
      } else if (nextChar === "*") {
        out += ".*";
        index += 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      out += "[^/]";
      continue;
    }

    if (char === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end === -1) {
        out += "\\[";
        continue;
      }

      let content = pattern.slice(index + 1, end);
      if (content.startsWith("!")) {
        content = `^${content.slice(1)}`;
      }

      out += `[${content}]`;
      index = end;
      continue;
    }

    if (char === "{") {
      const end = pattern.indexOf("}", index + 1);
      if (end === -1) {
        out += "\\{";
        continue;
      }

      const alternatives = pattern
        .slice(index + 1, end)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split("").map(escapeRegExpChar).join(""));

      out += alternatives.length > 0 ? `(${alternatives.join("|")})` : "";
      index = end;
      continue;
    }

    out += escapeRegExpChar(char);
  }

  out += "$";
  return new RegExp(out);
}

function walkAppFiles(rootDir, currentDir = rootDir, prefix = "") {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  entries
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        files.push(...walkAppFiles(rootDir, fullPath, relativePath));
        return;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    });

  return files;
}

function listAppFiles(appDir, requestedPaths) {
  const allFiles = walkAppFiles(appDir);
  const allFilesSet = new Set(allFiles);

  return requestedPaths.map((requestedPath) => {
    const normalizedPath = normalizePathSegment(requestedPath);

    if (!normalizedPath) {
      return {
        path: String(requestedPath || ""),
        files: []
      };
    }

    if (!hasGlob(normalizedPath)) {
      return {
        path: String(requestedPath),
        files: allFilesSet.has(normalizedPath) ? [`/${normalizedPath}`] : []
      };
    }

    const matcher = globToRegExp(normalizedPath);
    const files = allFiles.filter((filePath) => matcher.test(filePath)).map((filePath) => `/${filePath}`);

    return {
      path: String(requestedPath),
      files
    };
  });
}

module.exports = {
  globToRegExp,
  hasGlob,
  listAppFiles,
  normalizePathSegment
};
