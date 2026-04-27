import {
  normalizeIconHexColor,
  normalizeMaterialSymbolName
} from "/mod/_core/visual/icons/material-symbols.js";
import { normalizeRoutePath } from "/mod/_core/router/route-path.js";

const PANEL_EXTENSION_FILTERS = Object.freeze(["*.yaml", "*.yml"]);
const PANEL_FILE_PATTERNS = Object.freeze(
  PANEL_EXTENSION_FILTERS.map((filter) => `mod/*/*/ext/panels/${filter}`)
);
const DEFAULT_PANEL_ICON = "web";
const DEFAULT_PANEL_COLOR = "#94bcff";

function getRuntime() {
  const runtime = globalThis.space;

  if (!runtime || typeof runtime !== "object") {
    throw new Error("Space runtime is not available.");
  }

  if (
    !runtime.api ||
    typeof runtime.api.call !== "function" ||
    typeof runtime.api.fileRead !== "function"
  ) {
    throw new Error("space.api.call(...) or space.api.fileRead(...) is not available.");
  }

  if (
    !runtime.utils ||
    typeof runtime.utils !== "object" ||
    !runtime.utils.yaml ||
    typeof runtime.utils.yaml.parse !== "function"
  ) {
    throw new Error("space.utils.yaml.parse is not available.");
  }

  return runtime;
}

function collapseWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizePanelName(value) {
  return collapseWhitespace(value);
}

function normalizePanelDescription(value) {
  return collapseWhitespace(value);
}

function normalizePanelIcon(value) {
  return normalizeMaterialSymbolName(value) || DEFAULT_PANEL_ICON;
}

function normalizePanelColor(value) {
  return normalizeIconHexColor(value) || DEFAULT_PANEL_COLOR;
}

function normalizeModuleRoutePath(requestPath) {
  const normalizedRequestPath = String(requestPath || "").trim().replace(/^\/+/u, "");
  const match = normalizedRequestPath.match(/^mod\/([^/]+)\/([^/]+)\/(.+)$/u);

  if (!match) {
    return "";
  }

  const [, authorId, repositoryId, rawModulePath] = match;
  const modulePath = String(rawModulePath || "")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");

  if (!modulePath) {
    return "";
  }

  if (modulePath === "view.html") {
    return authorId === "_core" ? repositoryId : `${authorId}/${repositoryId}`;
  }

  if (modulePath.endsWith("/view.html")) {
    const featurePath = modulePath.slice(0, -"/view.html".length);
    return authorId === "_core"
      ? `${repositoryId}/${featurePath}`
      : `${authorId}/${repositoryId}/${featurePath}`;
  }

  return authorId === "_core"
    ? `${repositoryId}/${modulePath}`
    : `${authorId}/${repositoryId}/${modulePath}`;
}

export function normalizePanelRoutePath(value) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    return "";
  }

  if (/^\/?mod\//u.test(rawValue)) {
    return normalizeRoutePath(normalizeModuleRoutePath(rawValue));
  }

  return normalizeRoutePath(rawValue);
}

function parseManifestRequestPath(requestPath) {
  const normalizedRequestPath = String(requestPath || "").trim();
  const match = normalizedRequestPath.match(/^\/mod\/([^/]+)\/([^/]+)\/ext\/panels\/(.+\.(?:ya?ml))$/iu);

  if (!match) {
    return {
      id: normalizedRequestPath,
      manifestPath: normalizedRequestPath,
      modulePath: ""
    };
  }

  return {
    id: normalizedRequestPath,
    manifestPath: normalizedRequestPath,
    modulePath: `/mod/${match[1]}/${match[2]}`
  };
}

function parseDiscoveredPanelManifestFile(filePath) {
  const normalizedFilePath = String(filePath || "").trim();
  const match = normalizedFilePath.match(/^L[0-2]\/[^/]+\/mod\/([^/]+)\/([^/]+)\/ext\/panels\/(.+\.(?:ya?ml))$/iu);

  if (!match) {
    return null;
  }

  return {
    filePath: normalizedFilePath,
    id: normalizedFilePath,
    manifestName: match[3],
    manifestPath: normalizedFilePath,
    modulePath: `/mod/${match[1]}/${match[2]}`
  };
}

export function normalizePanelManifest(manifest = {}, options = {}) {
  const normalizedManifest =
    manifest && typeof manifest === "object" && !Array.isArray(manifest)
      ? manifest
      : {};
  const routePath = normalizePanelRoutePath(
    normalizedManifest.path ?? normalizedManifest.route ?? normalizedManifest.href
  );

  if (!routePath) {
    throw new Error("Panel manifest is missing a valid path.");
  }

  const name = normalizePanelName(normalizedManifest.name ?? normalizedManifest.title);

  if (!name) {
    throw new Error("Panel manifest is missing a valid name.");
  }

  return {
    color: normalizePanelColor(
      normalizedManifest.color ??
      normalizedManifest.icon_color ??
      normalizedManifest.iconColor
    ),
    description: normalizePanelDescription(
      normalizedManifest.description ?? normalizedManifest.summary
    ),
    icon: normalizePanelIcon(normalizedManifest.icon),
    id: String(options.id || options.manifestPath || routePath),
    manifestPath: String(options.manifestPath || ""),
    modulePath: String(options.modulePath || ""),
    name,
    routePath
  };
}

async function listPanelManifestFiles() {
  const runtime = getRuntime();
  const response = await runtime.api.call("file_paths", {
    body: {
      patterns: [...PANEL_FILE_PATTERNS]
    },
    method: "POST"
  });
  const matchedPaths = PANEL_FILE_PATTERNS.flatMap((pattern) =>
    Array.isArray(response?.[pattern]) ? response[pattern] : []
  );
  const effectivePanelFiles = new Map();

  matchedPaths.forEach((matchedPath) => {
    const panelFile = parseDiscoveredPanelManifestFile(matchedPath);

    if (!panelFile) {
      return;
    }

    effectivePanelFiles.set(`${panelFile.modulePath}|${panelFile.manifestName}`, panelFile);
  });

  return [...effectivePanelFiles.values()].sort((left, right) =>
    left.modulePath.localeCompare(right.modulePath) ||
    left.manifestName.localeCompare(right.manifestName) ||
    left.filePath.localeCompare(right.filePath)
  );
}

export async function loadPanelManifest(manifestPath) {
  const runtime = getRuntime();
  const normalizedManifestPath = String(manifestPath || "").trim();
  const discoveredManifestFile = parseDiscoveredPanelManifestFile(normalizedManifestPath);
  let manifestSource = "";

  if (discoveredManifestFile) {
    const response = await runtime.api.fileRead(discoveredManifestFile.filePath);
    manifestSource = String(response?.content || "");
  } else {
    const response = await fetch(normalizedManifestPath, {
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error(`Unable to read ${normalizedManifestPath}: ${response.status} ${response.statusText}`);
    }

    manifestSource = await response.text();
  }

  const parsedManifest = runtime.utils.yaml.parse(manifestSource);

  return normalizePanelManifest(
    parsedManifest,
    discoveredManifestFile || parseManifestRequestPath(normalizedManifestPath)
  );
}

function comparePanels(left, right) {
  return left.name.localeCompare(right.name) || left.routePath.localeCompare(right.routePath);
}

export async function listPanels() {
  const runtime = getRuntime();
  const manifestFiles = await listPanelManifestFiles();

  if (!manifestFiles.length) {
    return [];
  }

  // Idempotent batch read: panel manifests can be removed by module_remove
  // between the listing and this read. The panels parser keys files by
  // path through a Map, so missing entries simply do not appear in the
  // lookup — same shape we get from a 200 with `skipped`, just without
  // the 404 console noise.
  const result = await runtime.api.fileRead({
    files: manifestFiles.map((manifestFile) => manifestFile.filePath),
    ifExists: true
  });
  const files = Array.isArray(result?.files) ? result.files : [];
  const fileMap = new Map(
    files.map((file) => [String(file?.path || ""), String(file?.content || "")])
  );
  const panels = await Promise.all(
    manifestFiles.map(async (manifestFile) => {
      try {
        const manifestSource = fileMap.get(manifestFile.filePath) || "";
        const parsedManifest = runtime.utils.yaml.parse(manifestSource);
        return normalizePanelManifest(parsedManifest, manifestFile);
      } catch (error) {
        console.error(`[panels] loadPanelManifest failed for ${manifestFile.filePath}`, error);
        return null;
      }
    })
  );

  return panels.filter(Boolean).sort(comparePanels);
}
