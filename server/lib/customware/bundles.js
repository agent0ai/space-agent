import { promises as fsPromises } from "node:fs";
import path from "node:path";

import { parseSimpleYaml } from "../../../app/L0/_all/mod/_core/framework/js/yaml-lite.js";

const BUNDLE_MANIFEST_FILENAME = "space.bundle.yaml";
const BUNDLE_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,127}$/u;

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => enabled !== false && enabled !== null)
      .map(([key]) => normalizeString(key))
      .filter(Boolean);
  }

  const normalized = normalizeString(value);
  return normalized ? [normalized] : [];
}

function normalizeAction(action, bundleId) {
  const source = normalizeObject(action);
  const id = normalizeString(source.id);
  const title = normalizeString(source.title || source.name || id);

  if (!id || !title) {
    return null;
  }

  return {
    bundleId,
    capability: normalizeString(source.capability),
    description: normalizeString(source.description),
    id,
    inputSchema: normalizeObject(source.input_schema || source.inputSchema),
    outputSchema: normalizeObject(source.output_schema || source.outputSchema),
    title
  };
}

function normalizeActions(actions, bundleId) {
  return Array.isArray(actions)
    ? actions.map((action) => normalizeAction(action, bundleId)).filter(Boolean)
    : [];
}

function createInvalidManifest(error, moduleEntry = {}) {
  return {
    actions: [],
    capabilities: [],
    compatibility: {},
    configDefaults: {},
    description: "",
    errors: [error.message || "Bundle manifest could not be parsed."],
    extensionPoints: [],
    id: `${moduleEntry.authorId || "unknown"}/${moduleEntry.repositoryId || "unknown"}`,
    manifestPath: BUNDLE_MANIFEST_FILENAME,
    name: "",
    source: createBundleSource(moduleEntry),
    valid: false,
    version: ""
  };
}

function createBundleSource(moduleEntry = {}) {
  return {
    authorId: normalizeString(moduleEntry.authorId),
    layer: normalizeString(moduleEntry.layer),
    ownerId: normalizeString(moduleEntry.ownerId),
    ownerType: normalizeString(moduleEntry.ownerType),
    path: normalizeString(moduleEntry.path),
    repositoryId: normalizeString(moduleEntry.repositoryId),
    requestPath: normalizeString(moduleEntry.requestPath)
  };
}

function normalizeManifest(rawManifest, moduleEntry = {}) {
  const source = normalizeObject(rawManifest);
  const id = normalizeString(source.id || `${moduleEntry.authorId}/${moduleEntry.repositoryId}`);
  const errors = [];

  if (!BUNDLE_ID_PATTERN.test(id)) {
    errors.push(
      "Bundle id must start with a lowercase letter or number and may contain lowercase letters, numbers, '.', '_', '-', or '/'."
    );
  }

  const actions = normalizeActions(source.actions, id);
  const manifest = {
    actions,
    capabilities: normalizeStringList(source.capabilities),
    compatibility: normalizeObject(source.compatibility),
    configDefaults: normalizeObject(source.config_defaults || source.configDefaults),
    description: normalizeString(source.description),
    errors,
    extensionPoints: normalizeStringList(source.extension_points || source.extensionPoints),
    id,
    manifestPath: BUNDLE_MANIFEST_FILENAME,
    name: normalizeString(source.name || id),
    source: createBundleSource(moduleEntry),
    valid: errors.length === 0,
    version: normalizeString(source.version)
  };

  return manifest;
}

async function readBundleManifestAtModulePath(absolutePath, moduleEntry = {}) {
  const modulePath = normalizeString(absolutePath);

  if (!modulePath) {
    return null;
  }

  try {
    const manifestText = await fsPromises.readFile(
      path.join(modulePath, BUNDLE_MANIFEST_FILENAME),
      "utf8"
    );
    return normalizeManifest(parseSimpleYaml(manifestText), moduleEntry);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return null;
    }

    return createInvalidManifest(error, moduleEntry);
  }
}

export {
  BUNDLE_MANIFEST_FILENAME,
  normalizeManifest,
  readBundleManifestAtModulePath
};
