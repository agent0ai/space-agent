import * as api from "./api.js";
import * as cache from "./cache.js";
import {
  applyModuleResolution,
  getConfiguredModuleMaxLayer
} from "./moduleResolution.js";

/**
 * @typedef {string} ExtensionPath
 */

/**
 * @typedef {ImportMeta | { url?: string | URL } | string | URL} ExtendModuleRef
 */

/**
 * @typedef {{
 *   args: any[],
 *   error: any,
 *   extensionPoint: string,
 *   functionName: string,
 *   original: (...args: any[]) => any,
 *   result: any,
 *   skip: boolean,
 *   skipped: boolean,
 *   thisArg: any
 * }} ExtensionHookContext
 */

const EXTENSIBLE_META = Symbol.for("space.extensible.meta");
const MODULE_PATH_PATTERN = /\/mod\/([^/]+)\/([^/]+)\/(.+)$/u;

/**
 * @typedef {Object} LoadExtensionsResponse
 * @property {ExtensionPath[]} extensions
 */

/**
 * @typedef {Object} LoadExtensionsBatchResponse
 * @property {Record<string, ExtensionPath[]>} [results]
 */

/**
 * @typedef {Object} JsExtensionImport
 * @property {string} path
 * @property {{ default: (...data: any[]) => (void|Promise<void>) }} module
 */

/**
 * @typedef {Object} QueuedExtensionLookup
 * @property {string} key
 * @property {string[]} patterns
 * @property {(paths: ExtensionPath[]) => void} resolve
 * @property {(error: any) => void} reject
 */

const JS_CACHE_AREA = "frontend_extensions_js(extensions)";
const HTML_CACHE_AREA = "frontend_extensions_html(extensions)";
const EXTENSION_BATCH_FALLBACK_MS = 32;
// Frontend-only extra wait window before an uncached HTML x-extension lookup batch flushes.
const HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS = 0;
const HTML_EXTENSION_SCOPE = "html";
const JS_EXTENSION_SCOPE = "js";
const FRAMEWORK_HEAD_EXTENSION_POINT = "_core/framework/head/end";

export const API_EXTENSION_EXCLUDED_ENDPOINTS = new Set([
  "/api/extensions_load",
]);

export function clearCache() {
  cache.clear(JS_CACHE_AREA);
  cache.clear(HTML_CACHE_AREA);
}

function readCachedValue(area, key) {
  if (!cache.has(area, key)) {
    return undefined;
  }

  return cache.get(area, key);
}

function ensureFrameworkHeadExtensionAnchor() {
  const head = document.head;
  if (!head) {
    return null;
  }

  const existing = Array.from(head.children).find(
    (child) =>
      child.tagName === "X-EXTENSION" &&
      child.getAttribute("id") === FRAMEWORK_HEAD_EXTENSION_POINT
  );
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const extension = document.createElement("x-extension");
  extension.setAttribute("id", FRAMEWORK_HEAD_EXTENSION_POINT);
  head.appendChild(extension);
  return extension;
}

function ensureSpaceRuntime() {
  const runtime =
    globalThis.space && typeof globalThis.space === "object"
      ? globalThis.space
      : (globalThis.space = {});

  if (globalThis.window && typeof globalThis.window === "object") {
    globalThis.window.space = runtime;
  }

  return runtime;
}

function normalizeExtensionSegment(value) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");
}

function joinExtensionSegments(...segments) {
  return segments
    .map((segment) => normalizeExtensionSegment(segment))
    .filter(Boolean)
    .join("/");
}

function normalizeExtensionPointForScope(extensionPoint, scope) {
  const normalizedExtensionPoint = normalizeExtensionSegment(extensionPoint);

  if (!normalizedExtensionPoint) {
    return "";
  }

  if (normalizedExtensionPoint === scope) {
    return "";
  }

  if (normalizedExtensionPoint.startsWith(`${scope}/`)) {
    return normalizedExtensionPoint.slice(scope.length + 1);
  }

  return normalizedExtensionPoint;
}

function parseModulePath(moduleRef) {
  const moduleUrl =
    typeof moduleRef === "string" || moduleRef instanceof URL
      ? moduleRef
      : moduleRef && typeof moduleRef === "object" && "url" in moduleRef
        ? moduleRef.url
        : "";

  const normalizedModuleUrl = String(moduleUrl || "").trim();
  if (!normalizedModuleUrl) {
    return "";
  }

  let pathname = normalizedModuleUrl;

  try {
    pathname = new URL(
      normalizedModuleUrl,
      globalThis.location?.origin || "http://localhost"
    ).pathname;
  } catch {
    pathname = normalizedModuleUrl;
  }

  const match = pathname.match(MODULE_PATH_PATTERN);
  if (!match) {
    return "";
  }

  return joinExtensionSegments(match[1], match[2], match[3]);
}

function inferFunctionName(extensionPoint, original) {
  const normalizedName = normalizeExtensionSegment(original?.name);
  if (normalizedName) {
    return normalizedName;
  }

  const parts = normalizeExtensionSegment(extensionPoint).split("/");
  return parts[parts.length - 1] || "anonymous";
}

function resolveExtensionPoint(moduleRef, extensionPointName, original) {
  const modulePath = parseModulePath(moduleRef);
  if (!modulePath) {
    throw new Error("space.extend() requires import.meta or another module ref with a valid url.");
  }

  const relativeName = normalizeExtensionSegment(extensionPointName || original?.name);
  if (!relativeName) {
    throw new Error(
      "space.extend() requires a named function or an explicit extension point name."
    );
  }

  return joinExtensionSegments(modulePath, relativeName);
}

function isClassConstructor(value) {
  if (typeof value !== "function") {
    return false;
  }

  return Function.prototype.toString.call(value).startsWith("class ");
}

function copyFunctionProperties(source, target) {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  delete descriptors.length;
  delete descriptors.name;
  delete descriptors.prototype;

  try {
    Object.defineProperties(target, descriptors);
  } catch {
    // Ignore non-configurable properties copied from native functions.
  }
}

function setFunctionName(target, name) {
  if (!name) {
    return;
  }

  try {
    Object.defineProperty(target, "name", {
      configurable: true,
      value: name
    });
  } catch {
    // Ignore engines that do not allow redefining function names.
  }
}

/**
 * Wrap a Promise-returning function with `/start` and `/end` JS extension hooks.
 *
 * `space.extend(import.meta, async function name() {})`
 * `space.extend(import.meta, "ObjectName/methodName", async function methodName() {})`
 *
 * @template {(...args: any[]) => any} T
 * @param {ExtendModuleRef} moduleRef
 * @param {string | T} extensionPointNameOrOriginal
 * @param {T} [maybeOriginal]
 * @returns {T}
 */
export function extend(moduleRef, extensionPointNameOrOriginal, maybeOriginal) {
  const hasExplicitName = typeof extensionPointNameOrOriginal === "string";
  const original = /** @type {T} */ (hasExplicitName ? maybeOriginal : extensionPointNameOrOriginal);

  if (typeof original !== "function" || isClassConstructor(original)) {
    throw new TypeError("space.extend() wraps standalone functions only.");
  }

  const extensionPoint = resolveExtensionPoint(
    moduleRef,
    hasExplicitName ? extensionPointNameOrOriginal : "",
    original
  );
  const existingMeta = original[EXTENSIBLE_META];

  if (existingMeta && existingMeta.extensionPoint === extensionPoint) {
    return original;
  }

  const functionName = inferFunctionName(extensionPoint, original);
  const wrapped = async function(...incomingArgs) {
    /** @type {ExtensionHookContext} */
    const hookContext = {
      args: Array.isArray(incomingArgs) ? incomingArgs : [],
      error: null,
      extensionPoint,
      functionName,
      original,
      result: undefined,
      skip: false,
      skipped: false,
      thisArg: this
    };

    await callJsExtensions(`${extensionPoint}/start`, hookContext);

    if (!Array.isArray(hookContext.args)) {
      hookContext.args = Array.isArray(incomingArgs) ? incomingArgs : [];
    }

    if (hookContext.skip === true || hookContext.error != null) {
      hookContext.skipped = true;
    } else {
      try {
        hookContext.result = await original.apply(this, hookContext.args);
      } catch (error) {
        hookContext.error = error;
      }
    }

    await callJsExtensions(`${extensionPoint}/end`, hookContext);

    if (hookContext.error != null) {
      throw hookContext.error;
    }

    return hookContext.result;
  };

  copyFunctionProperties(original, wrapped);
  setFunctionName(wrapped, original.name || functionName);
  Object.defineProperty(wrapped, "extensionPoint", {
    configurable: false,
    enumerable: false,
    value: extensionPoint,
    writable: false
  });

  Object.defineProperty(wrapped, EXTENSIBLE_META, {
    configurable: false,
    enumerable: false,
    value: {
      extensionPoint,
      original
    },
    writable: false
  });

  return /** @type {T} */ (wrapped);
}

ensureSpaceRuntime().extend = extend;

function createExtensionPatterns(extensionPoint, filters, scope) {
  const normalizedExtensionPoint = normalizeExtensionPointForScope(
    extensionPoint,
    scope
  );

  if (!normalizedExtensionPoint) {
    return [];
  }

  return filters
    .map((filter) => joinExtensionSegments(scope, normalizedExtensionPoint, filter))
    .filter(Boolean);
}

function createExtensionLookupKey(patterns) {
  const maxLayer = getConfiguredModuleMaxLayer();

  return JSON.stringify(
    {
      maxLayer,
      patterns: patterns
        .map((pattern) => normalizeExtensionSegment(pattern))
        .filter(Boolean)
    }
  );
}

function createExtensionCacheKey(extensionPoint, scope) {
  return JSON.stringify({
    extensionPoint: normalizeExtensionPointForScope(extensionPoint, scope),
    maxLayer: getConfiguredModuleMaxLayer(),
    scope
  });
}

/** @type {Map<string, Promise<ExtensionPath[]>>} */
const pendingExtensionLookups = new Map();

/** @type {Map<string, QueuedExtensionLookup>} */
const queuedExtensionLookups = new Map();

let queuedExtensionFrameHandle = null;
let queuedExtensionWaitHandle = null;
let queuedExtensionTimeoutHandle = null;

function clearExtensionLookupSchedule() {
  if (
    queuedExtensionFrameHandle != null &&
    typeof globalThis.cancelAnimationFrame === "function"
  ) {
    globalThis.cancelAnimationFrame(queuedExtensionFrameHandle);
  }

  queuedExtensionFrameHandle = null;

  if (queuedExtensionWaitHandle != null) {
    clearTimeout(queuedExtensionWaitHandle);
  }

  queuedExtensionWaitHandle = null;

  if (queuedExtensionTimeoutHandle != null) {
    clearTimeout(queuedExtensionTimeoutHandle);
  }

  queuedExtensionTimeoutHandle = null;
}

async function flushQueuedExtensionLookups() {
  const queuedRequests = [...queuedExtensionLookups.values()];
  queuedExtensionLookups.clear();

  if (queuedRequests.length === 0) {
    return;
  }

  try {
    const maxLayer = getConfiguredModuleMaxLayer();
    /** @type {LoadExtensionsBatchResponse | null} */
    const response = await api.callJsonApi(`/api/extensions_load`, {
      ...(maxLayer === null ? {} : { maxLayer }),
      requests: queuedRequests.map(({ key, patterns }) => ({
        key,
        patterns
      }))
    });

    const results =
      response && typeof response === "object" && response.results &&
      typeof response.results === "object"
        ? response.results
        : Object.create(null);

    for (const request of queuedRequests) {
      const paths = Array.isArray(results[request.key])
        ? results[request.key].filter((path) => typeof path === "string")
        : [];

      request.resolve(paths);
    }
  } catch (error) {
    for (const request of queuedRequests) {
      request.reject(error);
    }
  } finally {
    for (const request of queuedRequests) {
      pendingExtensionLookups.delete(request.key);
    }
  }
}

function normalizeExtensionLookupResponse(results, key) {
  return Array.isArray(results?.[key])
    ? results[key].filter((path) => typeof path === "string")
    : [];
}

async function requestExtensionLookupPaths(key, patterns) {
  const maxLayer = getConfiguredModuleMaxLayer();
  /** @type {LoadExtensionsBatchResponse | null} */
  const response = await api.callJsonApi(`/api/extensions_load`, {
    ...(maxLayer === null ? {} : { maxLayer }),
    requests: [
      {
        key,
        patterns
      }
    ]
  });

  const results =
    response && typeof response === "object" && response.results &&
    typeof response.results === "object"
      ? response.results
      : Object.create(null);

  return normalizeExtensionLookupResponse(results, key);
}

function runScheduledExtensionLookupFlush() {
  clearExtensionLookupSchedule();
  void flushQueuedExtensionLookups();
}

function scheduleFrameAwareExtensionLookupFlush() {
  if (queuedExtensionFrameHandle != null || queuedExtensionTimeoutHandle != null) {
    return;
  }

  if (typeof globalThis.requestAnimationFrame === "function") {
    queuedExtensionFrameHandle = globalThis.requestAnimationFrame(
      runScheduledExtensionLookupFlush
    );
  }

  if (typeof globalThis.setTimeout === "function") {
    queuedExtensionTimeoutHandle = globalThis.setTimeout(
      runScheduledExtensionLookupFlush,
      EXTENSION_BATCH_FALLBACK_MS
    );
    return;
  }

  queueMicrotask(runScheduledExtensionLookupFlush);
}

function scheduleExtensionLookupFlush() {
  if (
    queuedExtensionFrameHandle != null ||
    queuedExtensionWaitHandle != null ||
    queuedExtensionTimeoutHandle != null
  ) {
    return;
  }

  const batchWaitMs =
    Number.isFinite(HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS) &&
    HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS > 0
      ? HTML_EXTENSIONS_LOAD_BATCH_WAIT_MS
      : 0;
  if (batchWaitMs > 0 && typeof globalThis.setTimeout === "function") {
    queuedExtensionWaitHandle = globalThis.setTimeout(() => {
      queuedExtensionWaitHandle = null;

      if (typeof globalThis.requestAnimationFrame === "function") {
        scheduleFrameAwareExtensionLookupFlush();
        return;
      }

      runScheduledExtensionLookupFlush();
    }, batchWaitMs);
    return;
  }

  scheduleFrameAwareExtensionLookupFlush();
}

function loadExtensionPaths(extensionPoint, filters, scope) {
  const patterns = createExtensionPatterns(extensionPoint, filters, scope);
  const lookupKey = createExtensionLookupKey(patterns);

  if (!lookupKey || patterns.length === 0) {
    return Promise.resolve([]);
  }

  const pendingLookup = pendingExtensionLookups.get(lookupKey);
  if (pendingLookup) {
    return pendingLookup;
  }

  if (scope !== HTML_EXTENSION_SCOPE) {
    const lookupPromise = requestExtensionLookupPaths(lookupKey, patterns)
      .finally(() => {
        pendingExtensionLookups.delete(lookupKey);
      });
    pendingExtensionLookups.set(lookupKey, lookupPromise);
    return lookupPromise;
  }

  const lookupPromise = new Promise((resolve, reject) => {
    queuedExtensionLookups.set(lookupKey, {
      key: lookupKey,
      patterns,
      reject,
      resolve
    });
    scheduleExtensionLookupFlush();
  });

  pendingExtensionLookups.set(lookupKey, lookupPromise);
  return lookupPromise;
}

/**
 * Call all JS extensions for a given extension point.
 *
 * @param {string} extensionPoint
 * @param {...any} data
 * @returns {Promise<void>}
 */
export async function callJsExtensions(extensionPoint, ...data){
  const cacheKey = createExtensionCacheKey(extensionPoint, JS_EXTENSION_SCOPE);
  const cachedExtensions = readCachedValue(JS_CACHE_AREA, cacheKey);
  const extensions =
    cachedExtensions !== undefined
      ? cachedExtensions
      : await loadJsExtensions(extensionPoint);
  for(const extension of extensions){
    try{
      await extension.module.default(...data);
    }catch(error){
      console.error(`Error calling extension: ${extension.path}`, error);
    }
  }
}

/**
 * Load JS extension modules for an extension point.
 *
 * @param {string} extensionPoint
 * @returns {Promise<JsExtensionImport[]>}
 */
export async function loadJsExtensions(extensionPoint) {
  try {
    const cacheKey = createExtensionCacheKey(extensionPoint, JS_EXTENSION_SCOPE);
    const cached = readCachedValue(JS_CACHE_AREA, cacheKey);
    if (cached !== undefined) return cached;

    const paths = await loadExtensionPaths(
      extensionPoint,
      ["*.js", "*.mjs"],
      JS_EXTENSION_SCOPE
    );
    /** @type {JsExtensionImport[]} */
    const imports = await Promise.all(
      paths.map(async (path) => ({
        path,
        module: await import(normalizePath(path))
      }))
    );
    cache.add(JS_CACHE_AREA, cacheKey, imports);
    return imports;
  } catch (error) {
    console.error("Error loading JS extensions:", error);
    return [];
  }
}

// Load all x-component tags starting from root elements
/**
 * Load and render all HTML extensions in the given DOM roots.
 *
 * @param {Element | Document | Array<Element | Document>} [roots]
 * @returns {Promise<void>}
 */
export async function loadHtmlExtensions(roots = [document.documentElement]) {
  try {
    // Convert single root to array if needed
    /** @type {Array<Element | Document>} */
    const rootElements = Array.isArray(roots) ? roots : [roots];

    // Find all top-level components and load them in parallel
    /** @type {Element[]} */
    const extensions = rootElements.flatMap((root) =>
      Array.from(root.querySelectorAll("x-extension")),
    );

    if (extensions.length === 0) return;

    await Promise.all(
      extensions.map(async (extension) => {
        const path = extension.getAttribute("id");
        if (!path) {
          console.error("x-extension missing id attribute:", extension);
          return;
        }
        await importHtmlExtensions(path, /** @type {HTMLElement} */ (extension));
      }),
    );
  } catch (error) {
    console.error("Error loading HTML extensions:", error);
  }
}

/**
 * Reload and re-render all HTML extensions in the given DOM roots.
 *
 * @param {Element | Document | Array<Element | Document>} [roots]
 * @returns {Promise<void>}
 */
export async function reloadHtmlExtensions(roots = [document.documentElement]) {
  try {
    /** @type {Array<Element | Document>} */
    const rootElements = Array.isArray(roots) ? roots : [roots];

    /** @type {Element[]} */
    const extensions = rootElements.flatMap((root) =>
      Array.from(root.querySelectorAll("x-extension")),
    );

    if (extensions.length === 0) return;

    await Promise.all(
      extensions.map(async (extension) => {
        const path = extension.getAttribute("id");
        if (!path) {
          console.error("x-extension missing id attribute:", extension);
          return;
        }

        extension.innerHTML = "";
        await importHtmlExtensions(path, /** @type {HTMLElement} */ (extension));
      }),
    );
  } catch (error) {
    console.error("Error reloading HTML extensions:", error);
  }
}

// import all extensions for extension point via backend api
/**
 * Import all HTML extensions for an extension point and inject them as `<x-component>` tags.
 *
 * @param {string} extensionPoint
 * @param {HTMLElement} targetElement
 * @returns {Promise<void>}
 */
export async function importHtmlExtensions(extensionPoint, targetElement) {
  try {
    const cacheKey = createExtensionCacheKey(
      extensionPoint,
      HTML_EXTENSION_SCOPE
    );
    const cachedHtml = readCachedValue(HTML_CACHE_AREA, cacheKey);
    if (cachedHtml !== undefined) {
      targetElement.innerHTML = cachedHtml;
      return;
    }

    const paths = await loadExtensionPaths(
      extensionPoint,
      ["*.html", "*.htm", "*.xhtml"],
      HTML_EXTENSION_SCOPE
    );
    let combinedHTML = "";
    for (const extension of paths) {
      const path = normalizePath(extension);
      combinedHTML += `<x-component path="${path}"></x-component>`;
    }
    cache.add(HTML_CACHE_AREA, cacheKey, combinedHTML);
    targetElement.innerHTML = combinedHTML;
  } catch (error) {
    console.error("Error importing HTML extensions:", error);
    return;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
  return applyModuleResolution(path.startsWith("/") ? path : "/" + path);
}

// Watch for DOM changes to dynamically load x-extensions
/** @type {MutationCallback} */
const extensionObserverCallback = (mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 1) {
        // ELEMENT_NODE
        // Check if this node or its descendants contain x-extension(s)
        const el = /** @type {Element} */ (node);
        if (el.matches?.("x-extension")) {
          const id = el.getAttribute("id");
          if (id) importHtmlExtensions(id, /** @type {HTMLElement} */ (el));
        } else if (/** @type {any} */ (el)["querySelectorAll"]) {
          loadHtmlExtensions([el]);
        }
      }
    }
  }
};

/** @type {MutationObserver} */
const extensionObserver = new MutationObserver(extensionObserverCallback);
extensionObserver.observe(document.documentElement, { childList: true, subtree: true });

// Framework-backed pages always get one head-side HTML seam for declarative
// tags or inline bootstraps that should not require page-shell edits.
ensureFrameworkHeadExtensionAnchor();

// Do an initial scan for static x-extension tags
// that already exist in the DOM (index.html), then rely on
// the observer for dynamically inserted nodes coming from components.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => loadHtmlExtensions());
} else {
  loadHtmlExtensions();
}
