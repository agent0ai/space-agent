import {
  COMPATIBLE_MODELS_URL,
  createSavedModelEntry,
  DEFAULT_DTYPE,
  DEFAULT_MAX_NEW_TOKENS,
  DEFAULT_MODEL_INPUT,
  LEGACY_DEFAULT_MODEL_INPUT,
  discardCachedModelEntries,
  describeModelSelection,
  DTYPE_OPTIONS,
  getSavedModelEntryKey,
  mergeSavedModelEntries,
  normalizeHuggingFaceModelInput,
  normalizeMaxNewTokens,
  normalizeUsageMetrics,
  persistSavedModelEntries,
  readSavedModelEntries,
  removeSavedModelEntries,
  validateModelSelection
} from "/mod/_core/huggingface/helpers.js";
import { WORKER_INBOUND, WORKER_OUTBOUND, WORKER_RUNTIME_VERSION } from "/mod/_core/huggingface/protocol.js";

const HUGGINGFACE_CONFIG_ROUTE = "/#/huggingface";
const PERSISTED_MODEL_STORAGE_KEY = "space.huggingface.last-loaded-model";

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value, seen = new WeakMap()) {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack || ""
    };
  }

  if (typeof globalThis.URL === "function" && value instanceof globalThis.URL) {
    return value.href;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()).toISOString();
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  if (typeof globalThis.Window === "function" && value instanceof globalThis.Window) {
    return null;
  }

  if (typeof globalThis.Element === "function" && value instanceof globalThis.Element) {
    return null;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const clonedArray = [];
    seen.set(value, clonedArray);

    value.forEach((entry) => {
      const clonedEntry = cloneValue(entry, seen);
      clonedArray.push(clonedEntry === undefined ? null : clonedEntry);
    });

    return clonedArray;
  }

  if (value instanceof Map) {
    const clonedEntries = [];
    seen.set(value, clonedEntries);

    value.forEach((entryValue, entryKey) => {
      clonedEntries.push([
        cloneValue(entryKey, seen),
        cloneValue(entryValue, seen)
      ]);
    });

    return clonedEntries;
  }

  if (value instanceof Set) {
    const clonedEntries = [];
    seen.set(value, clonedEntries);

    value.forEach((entryValue) => {
      clonedEntries.push(cloneValue(entryValue, seen));
    });

    return clonedEntries;
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
    return Array.from(value);
  }

  if (isPlainObject(value)) {
    const clonedObject = {};
    seen.set(value, clonedObject);

    Object.entries(value).forEach(([key, entryValue]) => {
      const clonedEntry = cloneValue(entryValue, seen);

      if (clonedEntry !== undefined) {
        clonedObject[key] = clonedEntry;
      }
    });

    return clonedObject;
  }

  try {
    return String(value);
  } catch {
    return null;
  }
}

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve
  };
}

export function createHuggingFaceAbortError(message = "The operation was aborted.") {
  try {
    return new DOMException(message, "AbortError");
  } catch {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }
}

export function isHuggingFaceAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === 20));
}

function createWorkerError(error, fallbackMessage) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error?.message === "string" && error.message
        ? error.message
        : "";

  const normalizedMessage = normalizeHuggingFaceRuntimeErrorMessage(rawMessage || fallbackMessage);

  if (error instanceof Error) {
    error.message = normalizedMessage;
    return error;
  }

  if (typeof error?.message === "string" && error.message) {
    return new Error(normalizedMessage);
  }

  return new Error(normalizedMessage);
}

function normalizeHuggingFaceRuntimeErrorMessage(message = "") {
  const normalizedMessage = String(message || "").trim();
  const lowerMessage = normalizedMessage.toLowerCase();

  if (
    lowerMessage.includes("failed to allocate memory for buffer mapping")
    || lowerMessage.includes("failed to download data from buffer")
    || lowerMessage.includes("mapasync")
  ) {
    return "Local Hugging Face generation ran out of WebGPU memory. Try a smaller model, shorter admin history, or a lower max-new-tokens value.";
  }

  return normalizedMessage;
}

function createLoadProgressState() {
  return {
    file: "",
    progress: 0,
    status: "",
    stepKey: "",
    stepLabel: ""
  };
}

function createInitialState() {
  const savedModels = readSavedModelEntries();
  const persistedSelection = readPersistedModelSelection();

  return {
    activeDtype: "",
    activeModelId: "",
    compatibleModelsUrl: COMPATIBLE_MODELS_URL,
    discardingSavedModelKey: "",
    error: "",
    hasTriedPersistedReload: false,
    isGenerating: false,
    isLoadingModel: false,
    isStopRequested: false,
    isWorkerBooting: false,
    isWorkerReady: false,
    lastWorkerTraceStage: "",
    loadProgress: createLoadProgressState(),
    loadingModelLabel: "",
    maxNewTokens: DEFAULT_MAX_NEW_TOKENS,
    modelInput: savedModels.length || persistedSelection ? "" : DEFAULT_MODEL_INPUT,
    savedModels,
    selectedDtype: DEFAULT_DTYPE,
    statusText: "Hugging Face runtime idle.",
    webgpuSupported: Boolean(globalThis.navigator?.gpu)
  };
}

function logHuggingFaceConsoleError(label, details = {}, raw = null) {
  if (raw != null) {
    console.error(`[huggingface] ${label}`, details, raw);
    return;
  }

  console.error(`[huggingface] ${label}`, details);
}

function readPersistedModelSelection() {
  try {
    const rawValue = globalThis.localStorage?.getItem(PERSISTED_MODEL_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object") {
      return null;
    }

    const modelId = normalizeHuggingFaceModelInput(parsedValue.modelId || parsedValue.modelInput);
    if (!modelId) {
      return null;
    }

    if (modelId === LEGACY_DEFAULT_MODEL_INPUT) {
      globalThis.localStorage?.removeItem(PERSISTED_MODEL_STORAGE_KEY);
      return null;
    }

    return {
      dtype: String(parsedValue.dtype || DEFAULT_DTYPE).trim() || DEFAULT_DTYPE,
      maxNewTokens: normalizeMaxNewTokens(parsedValue.maxNewTokens),
      modelId,
      modelInput: String(parsedValue.modelInput || modelId).trim() || modelId
    };
  } catch {
    return null;
  }
}

function normalizeSavedModelEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => createSavedModelEntry(entry))
    .filter(Boolean);
}

function findSavedModelEntry(entries = [], selection = {}) {
  const modelId = normalizeHuggingFaceModelInput(selection.modelId || selection.modelInput);
  const dtype = String(selection.dtype || "").trim();

  if (!modelId || !dtype) {
    return null;
  }

  return entries.find((entry) => entry.modelId === modelId && entry.dtype === dtype) || null;
}

function selectPreferredSavedModel(entries = []) {
  const savedModels = normalizeSavedModelEntries(entries);

  if (!savedModels.length) {
    return null;
  }

  const persistedSelection = readPersistedModelSelection();
  const persistedSavedModel = persistedSelection
    ? findSavedModelEntry(savedModels, persistedSelection)
    : null;

  return persistedSavedModel || savedModels[0] || null;
}

function persistModelSelection(selection) {
  try {
    if (!selection) {
      globalThis.localStorage?.removeItem(PERSISTED_MODEL_STORAGE_KEY);
      return;
    }

    globalThis.localStorage?.setItem(PERSISTED_MODEL_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

function clearPersistedModelSelection() {
  persistModelSelection(null);
}

function normalizeRequestOptions(requestOptions, fallbackMaxNewTokens) {
  const nextRequestOptions =
    requestOptions && typeof requestOptions === "object" && !Array.isArray(requestOptions)
      ? { ...requestOptions }
      : {};
  const maxNewTokens = normalizeMaxNewTokens(
    nextRequestOptions.max_new_tokens ?? nextRequestOptions.maxNewTokens ?? fallbackMaxNewTokens
  );

  delete nextRequestOptions.max_new_tokens;
  delete nextRequestOptions.maxNewTokens;

  return {
    maxNewTokens,
    requestOptions: nextRequestOptions
  };
}

function createCompletionResponseMeta(payload = {}, text = "") {
  return {
    finishReason: payload.finishReason || "stop",
    mode: "huggingface",
    payloadCount: 1,
    protocolObserved: true,
    sawDoneMarker: false,
    textChunkCount: text.trim() ? 1 : 0,
    verifiedEmpty: !text.trim()
  };
}

function updateSelectionState(state, selection = {}) {
  return {
    ...state,
    maxNewTokens: selection.maxNewTokens,
    modelInput: selection.modelInput || selection.modelId,
    selectedDtype: selection.dtype
  };
}

function isMatchingSelection(leftSelection = {}, rightSelection = {}) {
  return leftSelection.modelId === rightSelection.modelId && leftSelection.dtype === rightSelection.dtype;
}

class HuggingFaceManager {
  constructor() {
    this.listeners = new Set();
    this.pendingGenerate = null;
    this.pendingLoad = null;
    this.readyDeferred = null;
    this.state = createInitialState();
    this.worker = null;

    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerMessageError = this.handleWorkerMessageError.bind(this);
  }

  subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      return () => {};
    }

    this.listeners.add(listener);

    if (options.emitCurrent !== false) {
      listener(this.getSnapshot());
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  emitState() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      listener(snapshot);
    });
  }

  getSnapshot() {
    return cloneValue(this.state);
  }

  setState(patch = {}) {
    this.state = {
      ...this.state,
      ...patch
    };
    this.emitState();
  }

  setError(message = "", options = {}) {
    const nextPatch = {
      error: String(message || "")
    };

    if (typeof options.statusText === "string") {
      nextPatch.statusText = options.statusText;
    }

    this.setState(nextPatch);
  }

  setModelInput(value) {
    this.setState({
      modelInput: String(value ?? "")
    });
  }

  setSelectedDtype(value) {
    const normalizedValue = String(value || "").trim();
    const nextDtype = DTYPE_OPTIONS.some((option) => option.value === normalizedValue)
      ? normalizedValue
      : DEFAULT_DTYPE;

    this.setState({
      selectedDtype: nextDtype
    });
  }

  setMaxNewTokens(value) {
    this.setState({
      maxNewTokens: value
    });
  }

  getPreferredSavedModelSelection() {
    return cloneValue(selectPreferredSavedModel(this.state.savedModels));
  }

  awaitAbortablePromise(promise, signal, onAbort, message = "The operation was aborted.") {
    if (!signal) {
      return promise;
    }

    if (signal.aborted) {
      onAbort?.();
      return Promise.reject(createHuggingFaceAbortError(message));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const abortHandler = () => {
        if (settled) {
          return;
        }

        onAbort?.();
        reject(createHuggingFaceAbortError(message));
      };

      signal.addEventListener("abort", abortHandler, {
        once: true
      });

      promise.then(
        (value) => {
          settled = true;
          signal.removeEventListener("abort", abortHandler);
          resolve(value);
        },
        (error) => {
          settled = true;
          signal.removeEventListener("abort", abortHandler);
          reject(error);
        }
      );
    });
  }

  ensureDefaultModelInput() {
    if (String(this.state.modelInput || "").trim()) {
      return;
    }

    if (
      this.state.activeModelId
      || this.state.isLoadingModel
      || this.state.savedModels.length
      || readPersistedModelSelection()
    ) {
      return;
    }

    this.setModelInput(DEFAULT_MODEL_INPUT);
  }

  createReadyDeferred() {
    this.readyDeferred = createDeferred();
    return this.readyDeferred;
  }

  clearPendingLoad(error = null) {
    if (!this.pendingLoad) {
      return;
    }

    this.pendingLoad.signal?.removeEventListener("abort", this.pendingLoad.abortHandler);

    if (error) {
      this.pendingLoad.deferred.reject(error);
    }

    this.pendingLoad = null;
  }

  clearPendingGenerate(error = null) {
    if (!this.pendingGenerate) {
      return;
    }

    this.pendingGenerate.signal?.removeEventListener("abort", this.pendingGenerate.abortHandler);

    if (error) {
      this.pendingGenerate.deferred.reject(error);
    }

    this.pendingGenerate = null;
  }

  removeWorkerListeners(worker) {
    worker?.removeEventListener("message", this.handleWorkerMessage);
    worker?.removeEventListener("error", this.handleWorkerError);
    worker?.removeEventListener("messageerror", this.handleWorkerMessageError);
  }

  terminateWorker(worker) {
    try {
      worker?.terminate();
    } catch {
      // Ignore termination failures on already-dead workers.
    }
  }

  ensureWorker() {
    if (this.worker) {
      return this.readyDeferred?.promise || Promise.resolve(this.getSnapshot());
    }

    this.setState({
      error: "",
      isWorkerBooting: true,
      statusText: "Starting Hugging Face worker..."
    });
    this.createReadyDeferred();

    const workerUrl = new URL("./huggingface-worker-bootstrap.js", import.meta.url);
    workerUrl.searchParams.set("v", WORKER_RUNTIME_VERSION);

    const worker = new Worker(workerUrl, {
      type: "module"
    });

    worker.addEventListener("message", this.handleWorkerMessage);
    worker.addEventListener("error", this.handleWorkerError);
    worker.addEventListener("messageerror", this.handleWorkerMessageError);

    this.worker = worker;
    worker.postMessage({
      type: WORKER_INBOUND.BOOT
    });

    return this.readyDeferred.promise;
  }

  postMessage(type, payload = {}) {
    if (!this.worker) {
      throw new Error("Hugging Face worker is not available.");
    }

    this.worker.postMessage({
      payload,
      type
    });
  }

  teardownWorker(error = null) {
    const worker = this.worker;

    if (worker) {
      this.removeWorkerListeners(worker);
      this.terminateWorker(worker);
    }

    this.worker = null;

    if (this.readyDeferred && error) {
      this.readyDeferred.reject(error);
    }

    this.readyDeferred = null;
    this.clearPendingLoad(error);
    this.clearPendingGenerate(error);

    this.setState({
      activeDtype: "",
      activeModelId: "",
      discardingSavedModelKey: "",
      isGenerating: false,
      isLoadingModel: false,
      isStopRequested: false,
      isWorkerBooting: false,
      isWorkerReady: false,
      lastWorkerTraceStage: "",
      loadProgress: createLoadProgressState(),
      loadingModelLabel: ""
    });
  }

  restartWorker(options = {}) {
    const {
      clearPersistedSelection = false,
      keepLoadingState = false,
      reboot = true,
      statusText = ""
    } = options;

    const worker = this.worker;

    if (worker) {
      this.removeWorkerListeners(worker);
      this.terminateWorker(worker);
    }

    this.worker = null;

    if (this.readyDeferred) {
      this.readyDeferred.reject(createHuggingFaceAbortError(statusText || "Hugging Face worker restarted."));
    }

    this.readyDeferred = null;
    this.clearPendingLoad(createHuggingFaceAbortError(statusText || "Model load stopped."));
    this.clearPendingGenerate(createHuggingFaceAbortError(statusText || "Generation stopped."));

    const nextPatch = {
      activeDtype: "",
      activeModelId: "",
      discardingSavedModelKey: "",
      isGenerating: false,
      isStopRequested: false,
      isWorkerBooting: false,
      isWorkerReady: false,
      lastWorkerTraceStage: ""
    };

    if (!keepLoadingState) {
      nextPatch.isLoadingModel = false;
      nextPatch.loadProgress = createLoadProgressState();
      nextPatch.loadingModelLabel = "";
    }

    if (statusText) {
      nextPatch.statusText = statusText;
    }

    this.setState(nextPatch);

    if (clearPersistedSelection) {
      clearPersistedModelSelection();
    }

    this.ensureDefaultModelInput();

    if (reboot) {
      void this.ensureWorker().catch(() => {});
    }
  }

  handleWorkerError(event) {
    logHuggingFaceConsoleError("Worker error", {
      colno: event.colno,
      error: event.error,
      filename: event.filename,
      isTrusted: event.isTrusted,
      lastWorkerTraceStage: this.state.lastWorkerTraceStage,
      lineno: event.lineno,
      message: event.message,
      type: event.type
    }, event);

    const error = createWorkerError(
      event.error || event.message,
      this.state.lastWorkerTraceStage
        ? `The Hugging Face worker crashed during ${this.state.lastWorkerTraceStage}. Inspect the console for the raw worker event and trace logs.`
        : "The Hugging Face worker failed before exposing a useful error message. Inspect the raw worker ErrorEvent in the console."
    );

    this.setState({
      error: error.message,
      statusText: "Worker startup failed."
    });
    this.teardownWorker(error);
  }

  handleWorkerMessageError(event) {
    logHuggingFaceConsoleError("Worker message error", {
      data: event.data,
      isTrusted: event.isTrusted,
      origin: event.origin,
      type: event.type
    }, event);

    const error = new Error("The Hugging Face worker produced an invalid message.");
    this.setState({
      error: error.message,
      statusText: error.message
    });
    this.teardownWorker(error);
  }

  handleWorkerMessage(event) {
    const message = event.data || {};
    const payload = message.payload || {};

    switch (message.type) {
      case WORKER_OUTBOUND.READY: {
        this.setState({
          error: "",
          isWorkerBooting: false,
          isWorkerReady: true,
          statusText: payload.webgpuSupported === false
            ? "WebGPU is unavailable in this browser context."
            : this.state.isLoadingModel
              ? this.state.statusText
              : "Enter a model id or Hub URL and load it.",
          webgpuSupported: payload.webgpuSupported !== false
        });
        this.readyDeferred?.resolve(this.getSnapshot());

        if (!this.state.isLoadingModel) {
          this.restorePersistedModel();
        }

        break;
      }

      case WORKER_OUTBOUND.LOAD_PROGRESS: {
        if (!this.pendingLoad || payload.requestId !== this.pendingLoad.requestId) {
          return;
        }

        const nextStatus = String(payload.report?.status || "");
        const nextFile = String(payload.report?.file || "");
        const nextStepLabel = String(payload.report?.stepLabel || "");
        const nextStepKey = String(payload.report?.stepId || `${nextStatus}:${nextFile}`);
        const incomingProgress = Math.max(0.01, Math.min(1, Number(payload.report?.progress || 0)));

        this.setState({
          error: "",
          isLoadingModel: true,
          loadProgress: {
            file: nextFile,
            progress: incomingProgress,
            status: nextStatus,
            stepKey: nextStepKey,
            stepLabel: nextStepLabel
          },
          statusText: nextStepLabel || "Loading model..."
        });
        break;
      }

      case WORKER_OUTBOUND.CONSOLE_ERROR: {
        logHuggingFaceConsoleError("Forwarded worker console.error", {
          args: Array.isArray(payload.args) ? payload.args : [],
          currentDtype: payload.currentDtype,
          currentModelId: payload.currentModelId,
          loadRequestId: payload.loadRequestId,
          timestamp: payload.timestamp
        });
        break;
      }

      case WORKER_OUTBOUND.TRACE: {
        this.setState({
          lastWorkerTraceStage: String(payload.stage || "")
        });
        console.log("[huggingface] Worker trace", {
          currentDtype: payload.currentDtype,
          currentModelId: payload.currentModelId,
          requestId: payload.requestId,
          stage: payload.stage,
          timestamp: payload.timestamp
        });
        break;
      }

      case WORKER_OUTBOUND.LOAD_COMPLETE: {
        if (!this.pendingLoad || payload.requestId !== this.pendingLoad.requestId) {
          return;
        }

        const pendingLoad = this.pendingLoad;
        this.clearPendingLoad();

        const modelId = String(payload.modelId || pendingLoad.selection.modelId || "");
        const dtype = String(payload.dtype || pendingLoad.selection.dtype || DEFAULT_DTYPE);
        const nextSavedModels = mergeSavedModelEntries(
          readSavedModelEntries(),
          createSavedModelEntry({
            dtype,
            modelId
          })
        );
        persistSavedModelEntries(nextSavedModels);
        persistModelSelection({
          dtype,
          maxNewTokens: normalizeMaxNewTokens(this.state.maxNewTokens),
          modelId,
          modelInput: modelId
        });

        this.setState({
          activeDtype: dtype,
          activeModelId: modelId,
          error: "",
          isLoadingModel: false,
          loadProgress: {
            file: "",
            progress: 1,
            status: "done",
            stepKey: "done",
            stepLabel: "Model ready"
          },
          loadingModelLabel: "",
          modelInput: modelId,
          savedModels: nextSavedModels,
          statusText: `Loaded ${modelId}.`
        });
        pendingLoad.deferred.resolve({
          dtype,
          modelId
        });
        break;
      }

      case WORKER_OUTBOUND.LOAD_ERROR: {
        if (!this.pendingLoad || payload.requestId !== this.pendingLoad.requestId) {
          return;
        }

        logHuggingFaceConsoleError("Model load failed", {
          activeModelId: this.state.activeModelId,
          error: payload.error,
          loadProgress: this.state.loadProgress,
          modelInput: this.state.modelInput,
          requestId: payload.requestId,
          selectedDtype: this.state.selectedDtype
        });

        const error = createWorkerError(payload.error, "Model load failed.");
        const pendingLoad = this.pendingLoad;
        this.clearPendingLoad();
        this.setState({
          activeDtype: "",
          activeModelId: "",
          error: error.message,
          isLoadingModel: false,
          loadProgress: createLoadProgressState(),
          loadingModelLabel: "",
          statusText: "Model load failed."
        });
        pendingLoad.deferred.reject(error);
        break;
      }

      case WORKER_OUTBOUND.CHAT_DELTA: {
        if (!this.pendingGenerate || payload.requestId !== this.pendingGenerate.requestId) {
          return;
        }

        const nextText = String(payload.text || "");
        const previousText = typeof this.pendingGenerate.fullText === "string" ? this.pendingGenerate.fullText : "";
        const delta = nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText;
        this.pendingGenerate.fullText = nextText;

        if (delta) {
          this.pendingGenerate.onDelta(delta);
        }

        break;
      }

      case WORKER_OUTBOUND.INTERRUPT_ACK: {
        if (!this.pendingGenerate || payload.requestId !== this.pendingGenerate.requestId) {
          return;
        }

        this.setState({
          isStopRequested: true,
          statusText: "Stopping generation..."
        });
        break;
      }

      case WORKER_OUTBOUND.CHAT_COMPLETE: {
        if (!this.pendingGenerate || payload.requestId !== this.pendingGenerate.requestId) {
          return;
        }

        const pendingGenerate = this.pendingGenerate;
        const text = String(payload.text || pendingGenerate.fullText || "");
        const metrics = normalizeUsageMetrics(payload.metrics);
        const modelId = String(payload.modelId || this.state.activeModelId || "");
        const finishReason = String(payload.finishReason || "stop");
        const responseMeta = createCompletionResponseMeta(payload, text);
        this.clearPendingGenerate();
        this.setState({
          error: "",
          isGenerating: false,
          isStopRequested: false,
          statusText: finishReason === "abort" ? "Generation stopped." : "Reply complete."
        });

        if (pendingGenerate.abortRequested || finishReason === "abort") {
          const error = createHuggingFaceAbortError();
          error.finishReason = finishReason;
          error.metrics = metrics;
          error.modelId = modelId;
          error.responseMeta = responseMeta;
          error.text = text;
          pendingGenerate.deferred.reject(error);
          return;
        }

        pendingGenerate.deferred.resolve({
          finishReason,
          metrics,
          modelId,
          responseMeta,
          text
        });
        break;
      }

      case WORKER_OUTBOUND.CHAT_ERROR: {
        if (!this.pendingGenerate || payload.requestId !== this.pendingGenerate.requestId) {
          return;
        }

        logHuggingFaceConsoleError("Chat generation failed", {
          activeModelId: this.state.activeModelId,
          error: payload.error,
          requestId: payload.requestId
        });

        const error = createWorkerError(payload.error, "Generation failed.");
        const pendingGenerate = this.pendingGenerate;
        this.clearPendingGenerate();
        this.setState({
          error: error.message,
          isGenerating: false,
          isStopRequested: false,
          statusText: "Generation failed."
        });
        pendingGenerate.deferred.reject(error);
        break;
      }

      default:
        break;
    }
  }

  buildRequestedSelection(overrides = {}) {
    const modelInput = String(overrides.modelInput ?? overrides.modelId ?? this.state.modelInput).trim();
    const modelId = normalizeHuggingFaceModelInput(overrides.modelId ?? modelInput);

    return {
      dtype: String(overrides.dtype ?? this.state.selectedDtype).trim() || DEFAULT_DTYPE,
      maxNewTokens: normalizeMaxNewTokens(overrides.maxNewTokens ?? this.state.maxNewTokens),
      modelId,
      modelInput
    };
  }

  async dispatchLoadModel(selection, options = {}) {
    if (!this.worker) {
      throw new Error("Hugging Face worker is not available.");
    }

    const signal = options.signal;
    const deferred = createDeferred();
    const requestId = crypto.randomUUID();
    const abortHandler = () => {
      this.restartWorker({
        clearPersistedSelection: false,
        keepLoadingState: false,
        statusText: "Model load stopped."
      });
    };

    this.pendingLoad = {
      abortHandler,
      deferred,
      requestId,
      selection,
      signal
    };

    signal?.addEventListener("abort", abortHandler, {
      once: true
    });

    this.setState(updateSelectionState({
      ...this.state,
      error: "",
      isLoadingModel: true,
      loadProgress: {
        file: "",
        progress: 0.01,
        status: "queued",
        stepKey: "queued",
        stepLabel: "Queued"
      },
      loadingModelLabel: describeModelSelection(selection),
      statusText: `Loading ${describeModelSelection(selection)}...`
    }, selection));

    this.postMessage(WORKER_INBOUND.LOAD_MODEL, {
      dtype: selection.dtype,
      modelId: selection.modelId,
      modelInput: selection.modelInput,
      requestId
    });

    return deferred.promise;
  }

  async loadModel(overrides = {}, options = {}) {
    const signal = options.signal;
    const selection = this.buildRequestedSelection(overrides);
    const validationError = validateModelSelection(selection);

    if (!this.state.webgpuSupported) {
      const error = new Error("WebGPU is unavailable in this browser context.");
      this.setState({
        error: error.message
      });
      throw error;
    }

    if (this.state.isGenerating) {
      const error = new Error("Stop the current generation before loading another model.");
      this.setState({
        error: error.message
      });
      throw error;
    }

    if (validationError) {
      const error = new Error(validationError);
      this.setState({
        error: error.message
      });
      throw error;
    }

    if (signal?.aborted) {
      throw createHuggingFaceAbortError("Model load stopped.");
    }

    if (
      this.pendingLoad
      && isMatchingSelection(this.pendingLoad.selection, selection)
    ) {
      return this.awaitAbortablePromise(
        this.pendingLoad.deferred.promise,
        signal,
        () => {
          this.restartWorker({
            clearPersistedSelection: false,
            keepLoadingState: false,
            statusText: "Model load stopped."
          });
        },
        "Model load stopped."
      );
    }

    if (
      this.state.activeModelId === selection.modelId
      && this.state.activeDtype === selection.dtype
      && !this.state.isLoadingModel
    ) {
      persistModelSelection({
        dtype: selection.dtype,
        maxNewTokens: normalizeMaxNewTokens(selection.maxNewTokens),
        modelId: selection.modelId,
        modelInput: selection.modelInput || selection.modelId
      });
      this.setState(updateSelectionState({
        ...this.state,
        error: ""
      }, selection));
      return {
        dtype: selection.dtype,
        modelId: selection.modelId
      };
    }

    this.setState(updateSelectionState({
      ...this.state,
      error: "",
      isLoadingModel: true,
      loadProgress: {
        file: "",
        progress: 0.01,
        status: "queued",
        stepKey: "queued",
        stepLabel: "Queued"
      },
      loadingModelLabel: describeModelSelection(selection),
      statusText: `Loading ${describeModelSelection(selection)}...`
    }, selection));

    await this.ensureWorker();

    if (signal?.aborted) {
      this.setState({
        isLoadingModel: false,
        loadProgress: createLoadProgressState(),
        loadingModelLabel: "",
        statusText: "Model load stopped."
      });
      throw createHuggingFaceAbortError("Model load stopped.");
    }

    if (
      this.pendingLoad
      && isMatchingSelection(this.pendingLoad.selection, selection)
    ) {
      return this.awaitAbortablePromise(
        this.pendingLoad.deferred.promise,
        signal,
        () => {
          this.restartWorker({
            clearPersistedSelection: false,
            keepLoadingState: false,
            statusText: "Model load stopped."
          });
        },
        "Model load stopped."
      );
    }

    if (this.pendingLoad) {
      this.restartWorker({
        clearPersistedSelection: false,
        keepLoadingState: true,
        statusText: `Loading ${describeModelSelection(selection)}...`
      });
      await this.ensureWorker();
    }

    if (
      this.state.activeModelId
      && (
        this.state.activeModelId !== selection.modelId
        || this.state.activeDtype !== selection.dtype
      )
    ) {
      this.restartWorker({
        clearPersistedSelection: false,
        keepLoadingState: true,
        statusText: `Loading ${describeModelSelection(selection)}...`
      });
      await this.ensureWorker();
    }

    return this.dispatchLoadModel(selection, {
      signal
    });
  }

  async ensureModelLoaded(selection = {}, options = {}) {
    const requestedSelection = this.buildRequestedSelection(selection);

    if (!requestedSelection.modelId) {
      throw new Error("Choose a Hugging Face model.");
    }

    if (!requestedSelection.dtype) {
      throw new Error("Choose a Hugging Face dtype.");
    }

    if (
      this.state.activeModelId === requestedSelection.modelId
      && this.state.activeDtype === requestedSelection.dtype
      && !this.state.isLoadingModel
    ) {
      return {
        dtype: requestedSelection.dtype,
        modelId: requestedSelection.modelId
      };
    }

    return this.loadModel(requestedSelection, options);
  }

  isActiveSavedModel(entry = {}) {
    return entry?.modelId === this.state.activeModelId && entry?.dtype === this.state.activeDtype;
  }

  isDiscardingSavedModel(entry = {}) {
    return Boolean(this.state.discardingSavedModelKey)
      && this.state.discardingSavedModelKey === getSavedModelEntryKey(entry);
  }

  canDiscardSavedModel(entry = {}) {
    return Boolean(entry?.modelId)
      && !this.state.isGenerating
      && !this.state.isLoadingModel
      && !this.state.discardingSavedModelKey;
  }

  getSavedModelActionLabel(entry = {}) {
    return this.isActiveSavedModel(entry) ? "Unload" : "Load";
  }

  async unloadModel(options = {}) {
    if (this.state.isGenerating && options.force !== true) {
      throw new Error("Stop the current generation before unloading the model.");
    }

    if (!this.state.activeModelId && !this.state.isLoadingModel) {
      return {
        stoppedLoad: false
      };
    }

    const stoppedLoad = this.state.isLoadingModel;

    this.restartWorker({
      clearPersistedSelection: options.clearPersistedSelection !== false,
      keepLoadingState: false,
      reboot: options.reboot === true,
      statusText: stoppedLoad ? "Model load stopped." : "Model unloaded."
    });

    return {
      stoppedLoad
    };
  }

  refreshSavedModels() {
    const savedModels = readSavedModelEntries();
    this.setState({
      savedModels
    });
    this.ensureDefaultModelInput();
    return savedModels;
  }

  refreshPreferredSavedModelSelection() {
    return cloneValue(selectPreferredSavedModel(this.refreshSavedModels()));
  }

  async discardSavedModel(entry = {}) {
    const modelId = normalizeHuggingFaceModelInput(entry.modelId || entry.modelInput);
    const modelKey = getSavedModelEntryKey(entry);

    if (!modelId || !modelKey || !this.canDiscardSavedModel(entry)) {
      return;
    }

    const persistedSelection = readPersistedModelSelection();
    const shouldClearPersistedSelection = persistedSelection?.modelId === modelId;
    const isActiveModel = this.state.activeModelId === modelId;

    this.setState({
      discardingSavedModelKey: modelKey,
      error: "",
      statusText: `Discarding cached files for ${modelId}...`
    });

    try {
      if (isActiveModel) {
        this.restartWorker({
          clearPersistedSelection: shouldClearPersistedSelection,
          keepLoadingState: false,
          reboot: false,
          statusText: `Discarding cached files for ${modelId}...`
        });
      } else if (shouldClearPersistedSelection) {
        clearPersistedModelSelection();
      }

      await discardCachedModelEntries(modelId);

      const nextSavedModels = removeSavedModelEntries(this.state.savedModels, {
        modelId
      });
      persistSavedModelEntries(nextSavedModels);

      this.setState({
        discardingSavedModelKey: "",
        savedModels: nextSavedModels,
        statusText: `Discarded cached files for ${modelId}.`
      });
      this.ensureDefaultModelInput();
    } catch (error) {
      logHuggingFaceConsoleError("Cached model discard failed", {
        activeModelId: this.state.activeModelId,
        error,
        modelId
      }, error);
      this.setState({
        discardingSavedModelKey: "",
        error: error?.message || "Cached model discard failed.",
        statusText: "Cached model discard failed."
      });
      throw error;
    } finally {
      if (!this.worker) {
        void this.ensureWorker().catch(() => {});
      }
    }
  }

  restorePersistedModel() {
    if (
      this.state.hasTriedPersistedReload
      || !this.state.isWorkerReady
      || !this.state.webgpuSupported
      || this.state.isLoadingModel
    ) {
      return;
    }

    this.setState({
      hasTriedPersistedReload: true
    });

    const persistedSelection = readPersistedModelSelection();

    if (!persistedSelection) {
      this.ensureDefaultModelInput();
      return;
    }

    void this.loadModel(persistedSelection).catch(() => {});
  }

  requestStop() {
    if (!this.pendingGenerate || this.pendingGenerate.abortRequested) {
      return;
    }

    this.pendingGenerate.abortRequested = true;
    this.setState({
      isStopRequested: true,
      statusText: "Stopping generation..."
    });
    this.postMessage(WORKER_INBOUND.INTERRUPT, {
      requestId: this.pendingGenerate.requestId
    });
  }

  async streamCompletion(options = {}) {
    const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
    const signal = options.signal;
    const requestedSelection = options.modelSelection || {};
    const requestedMessages = Array.isArray(options.messages) ? options.messages : [];
    const {
      maxNewTokens,
      requestOptions
    } = normalizeRequestOptions(options.requestOptions, this.state.maxNewTokens);

    await this.ensureModelLoaded({
      dtype: requestedSelection.dtype || this.state.activeDtype || DEFAULT_DTYPE,
      maxNewTokens,
      modelId: requestedSelection.modelId || this.state.activeModelId,
      modelInput: requestedSelection.modelInput || requestedSelection.modelId || this.state.activeModelId
    }, {
      signal
    });

    if (signal?.aborted) {
      throw createHuggingFaceAbortError();
    }

    if (this.pendingGenerate) {
      throw new Error("A Hugging Face response is already running.");
    }

    const deferred = createDeferred();
    const requestId = crypto.randomUUID();
    const abortHandler = () => {
      if (!this.pendingGenerate || this.pendingGenerate.requestId !== requestId) {
        return;
      }

      this.requestStop();
    };

    this.pendingGenerate = {
      abortHandler,
      abortRequested: false,
      deferred,
      fullText: "",
      onDelta,
      requestId,
      signal
    };

    signal?.addEventListener("abort", abortHandler, {
      once: true
    });

    this.setState({
      error: "",
      isGenerating: true,
      isStopRequested: false,
      maxNewTokens,
      statusText: `Generating with ${this.state.activeModelId}...`
    });

    this.postMessage(WORKER_INBOUND.RUN_CHAT, {
      dtype: requestedSelection.dtype || this.state.activeDtype || DEFAULT_DTYPE,
      maxNewTokens,
      messages: requestedMessages,
      modelId: requestedSelection.modelId || this.state.activeModelId || "",
      requestId,
      requestOptions
    });

    return deferred.promise;
  }

  async resetChat() {}

  openConfiguration() {
    const targetUrl = new URL(HUGGINGFACE_CONFIG_ROUTE, globalThis.location?.origin || globalThis.location?.href || "/").href;
    globalThis.open?.(targetUrl, "_blank", "noopener");
  }
}

let singletonManager = null;

export function getHuggingFaceManager() {
  if (!(singletonManager instanceof HuggingFaceManager)) {
    singletonManager = new HuggingFaceManager();
  }

  return singletonManager;
}
