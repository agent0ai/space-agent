import { countTextTokens } from "/mod/_core/framework/js/token-count.js";

const DATA_URL_PATTERN = /^data:([^;,]+)?((?:;[^,]+)*),(.*)$/isu;
const DEFAULT_IMAGE_MEDIA_TYPE = "image/png";
const DEFAULT_IMAGE_NAME = "Image";
const DEFAULT_IMAGE_DETAIL = "auto";
const DEFAULT_IMAGE_DIMENSION = 1024;
const VISUAL_DATA_ID_PREFIX = "visual";
const VISUAL_SEPARATOR = "\u241e";
const VISUAL_FIELD_SEPARATOR = "\u241f";

const OPENAI_TILE_MODEL_TOKEN_COSTS = Object.freeze({
  computerUse: { base: 65, tile: 129 },
  default: { base: 85, tile: 170 },
  gpt5: { base: 70, tile: 140 },
  gpt4oMini: { base: 2833, tile: 5667 },
  o1o3: { base: 75, tile: 150 }
});

const OPENAI_PATCH_MODEL_MULTIPLIERS = Object.freeze({
  "gpt-4.1-mini": 1.62,
  "gpt-4.1-nano": 2.46,
  "gpt-5-codex-mini": 1.62,
  "gpt-5-mini": 1.62,
  "gpt-5-nano": 2.46,
  "gpt-5.1-codex-mini": 1.62,
  "gpt-5.2-codex": 1,
  "gpt-5.2-chat-latest": 1,
  "gpt-5.2": 1,
  "gpt-5.3-codex": 1,
  "gpt-5.4-mini": 1.62,
  "gpt-5.4-nano": 2.46,
  "o4-mini": 1.72
});

function createVisualDataId() {
  return `${VISUAL_DATA_ID_PREFIX}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeImageName(value) {
  return normalizeString(value) || DEFAULT_IMAGE_NAME;
}

function normalizeImageMediaType(value) {
  const normalizedValue = normalizeString(value).toLowerCase();

  if (normalizedValue === "image/jpg") {
    return "image/jpeg";
  }

  return normalizedValue || DEFAULT_IMAGE_MEDIA_TYPE;
}

function isSupportedImageMediaType(value) {
  return /^image\/(?:png|jpe?g|webp|gif)$/iu.test(normalizeImageMediaType(value));
}

function normalizeImageDetail(value) {
  const normalizedValue = normalizeString(value).toLowerCase();

  return ["auto", "high", "low", "original"].includes(normalizedValue)
    ? normalizedValue
    : DEFAULT_IMAGE_DETAIL;
}

function normalizePositiveInteger(value, fallback = 0) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(normalizedValue));
}

function parseDataUrl(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  const match = normalizedValue.match(DATA_URL_PATTERN);

  if (!match) {
    return null;
  }

  return {
    data: match[3] || "",
    mediaType: normalizeImageMediaType(match[1] || DEFAULT_IMAGE_MEDIA_TYPE),
    url: normalizedValue
  };
}

function isDataUrl(value) {
  return Boolean(parseDataUrl(value));
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== "function") {
      reject(new Error("FileReader is not available in this runtime."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };

    reader.onerror = () => {
      reject(reader.error || new Error("Unable to read image data."));
    };

    reader.readAsDataURL(blob);
  });
}

function readImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    if (typeof Image !== "function" || !dataUrl) {
      resolve({ height: 0, width: 0 });
      return;
    }

    const image = new Image();

    image.onload = () => {
      resolve({
        height: normalizePositiveInteger(image.naturalHeight || image.height, 0),
        width: normalizePositiveInteger(image.naturalWidth || image.width, 0)
      });
    };

    image.onerror = () => {
      resolve({ height: 0, width: 0 });
    };

    image.src = dataUrl;
  });
}

function extractImageSourceObject(source) {
  return source && typeof source === "object" ? source : {};
}

async function resolveImageSource(source, options = {}) {
  const sourceObject = extractImageSourceObject(source);

  if (typeof source === "string") {
    const rawSource = source.trim();

    if (isDataUrl(rawSource)) {
      return {
        dataUrl: rawSource,
        name: options.name,
        source: options.source || "data-url"
      };
    }

    throw new Error("Image visual data must be a data URL, Blob, File, attachment handle, or visual data object.");
  }

  if (typeof Blob === "function" && source instanceof Blob) {
    return {
      dataUrl: await readBlobAsDataUrl(source),
      lastModified: source.lastModified,
      mediaType: source.type,
      name: source.name,
      size: source.size,
      source: options.source || "blob"
    };
  }

  if (typeof sourceObject.dataUrl === "function") {
    return {
      attachmentId: sourceObject.id,
      dataUrl: await sourceObject.dataUrl(),
      lastModified: sourceObject.lastModified,
      mediaType: sourceObject.type || sourceObject.mediaType,
      messageId: sourceObject.messageId,
      name: sourceObject.name,
      size: sourceObject.size,
      source: options.source || "attachment"
    };
  }

  if (typeof sourceObject.dataUrl === "string" || typeof sourceObject.url === "string") {
    return {
      attachmentId: sourceObject.attachmentId,
      dataUrl: sourceObject.dataUrl || sourceObject.url,
      detail: sourceObject.detail,
      height: sourceObject.height,
      id: sourceObject.id,
      lastModified: sourceObject.lastModified,
      mediaType: sourceObject.mediaType || sourceObject.type,
      messageId: sourceObject.messageId,
      name: sourceObject.name,
      size: sourceObject.size,
      source: sourceObject.source || options.source || "visual-data",
      tokenCount: sourceObject.tokenCount,
      width: sourceObject.width
    };
  }

  if (sourceObject.file && typeof sourceObject.file.arrayBuffer === "function") {
    return {
      attachmentId: sourceObject.id,
      dataUrl: await readBlobAsDataUrl(sourceObject.file),
      lastModified: sourceObject.file.lastModified || sourceObject.lastModified,
      mediaType: sourceObject.file.type || sourceObject.type,
      messageId: sourceObject.messageId,
      name: sourceObject.file.name || sourceObject.name,
      size: sourceObject.file.size || sourceObject.size,
      source: options.source || "file"
    };
  }

  throw new Error("Unable to resolve image visual data.");
}

export function normalizeVisualDataEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const rawDataUrl = normalizeString(entry.dataUrl || entry.url);
  const parsedDataUrl = parseDataUrl(rawDataUrl);
  const mediaType = normalizeImageMediaType(entry.mediaType || entry.type || parsedDataUrl?.mediaType);

  if (!rawDataUrl || !parsedDataUrl || !isSupportedImageMediaType(mediaType)) {
    return null;
  }

  return {
    attachmentId: normalizeString(entry.attachmentId),
    dataUrl: rawDataUrl,
    detail: normalizeImageDetail(entry.detail),
    height: normalizePositiveInteger(entry.height, 0),
    id: normalizeString(entry.id) || createVisualDataId(),
    lastModified: normalizePositiveInteger(entry.lastModified, 0),
    mediaType,
    messageId: normalizeString(entry.messageId),
    name: normalizeImageName(entry.name),
    size: normalizePositiveInteger(entry.size, 0),
    source: normalizeString(entry.source),
    tokenCount: normalizePositiveInteger(entry.tokenCount, 0),
    type: "image",
    width: normalizePositiveInteger(entry.width, 0)
  };
}

export function normalizeVisualDataList(visualData) {
  if (!Array.isArray(visualData)) {
    return [];
  }

  return visualData.map((entry) => normalizeVisualDataEntry(entry)).filter(Boolean);
}

export function serializeVisualDataEntry(entry) {
  const normalizedEntry = normalizeVisualDataEntry(entry);

  if (!normalizedEntry) {
    return null;
  }

  return { ...normalizedEntry };
}

export function serializeVisualDataList(visualData) {
  return normalizeVisualDataList(visualData).map((entry) => serializeVisualDataEntry(entry)).filter(Boolean);
}

export async function createImageVisualData(source, options = {}) {
  const resolvedSource = await resolveImageSource(source, options);
  const parsedDataUrl = parseDataUrl(resolvedSource.dataUrl);

  if (!parsedDataUrl || !isSupportedImageMediaType(parsedDataUrl.mediaType)) {
    throw new Error("Only PNG, JPEG, WebP, and non-animated GIF images can be loaded as visual data.");
  }

  const explicitWidth = normalizePositiveInteger(options.width ?? resolvedSource.width, 0);
  const explicitHeight = normalizePositiveInteger(options.height ?? resolvedSource.height, 0);
  const dimensions =
    explicitWidth && explicitHeight
      ? { height: explicitHeight, width: explicitWidth }
      : await readImageDimensions(resolvedSource.dataUrl);

  const normalizedEntry = normalizeVisualDataEntry({
    ...resolvedSource,
    dataUrl: resolvedSource.dataUrl,
    detail: options.detail ?? resolvedSource.detail,
    height: explicitHeight || dimensions.height,
    id: options.id || resolvedSource.id,
    mediaType: options.mediaType || resolvedSource.mediaType || parsedDataUrl.mediaType,
    name: options.name || resolvedSource.name,
    source: options.source || resolvedSource.source,
    width: explicitWidth || dimensions.width
  });

  if (!normalizedEntry) {
    throw new Error("Unable to normalize image visual data.");
  }

  return normalizedEntry;
}

function normalizeVisionModelText(options = {}) {
  return [
    options.model,
    options.modelId,
    options.provider,
    options.apiEndpoint
  ]
    .map((value) => normalizeString(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function normalizeVisionModelConfig(options = {}) {
  const normalizedOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};

  return {
    apiEndpoint: normalizeString(normalizedOptions.apiEndpoint),
    detail: normalizeImageDetail(normalizedOptions.detail || normalizedOptions.imageDetail),
    model: normalizeString(normalizedOptions.model || normalizedOptions.modelId),
    provider: normalizeString(normalizedOptions.provider),
    supportsVision:
      normalizedOptions.supportsVision === true ||
      normalizedOptions.vision === true ||
      normalizedOptions.visionEnabled === true
  };
}

function resolveImageDimensionsForEstimate(visualData = {}) {
  return {
    height: normalizePositiveInteger(visualData.height, DEFAULT_IMAGE_DIMENSION),
    width: normalizePositiveInteger(visualData.width, DEFAULT_IMAGE_DIMENSION)
  };
}

function estimateClaudeImageTokens(visualData = {}) {
  const { height, width } = resolveImageDimensionsForEstimate(visualData);
  return Math.max(1, Math.ceil((width * height) / 750));
}

function estimateGeminiImageTokens(visualData = {}) {
  const { height, width } = resolveImageDimensionsForEstimate(visualData);

  if (width <= 384 && height <= 384) {
    return 258;
  }

  return Math.max(258, Math.ceil(width / 768) * Math.ceil(height / 768) * 258);
}

function getOpenAiTileTokenCost(modelText = "") {
  if (/\bcomputer-use-preview\b/u.test(modelText)) {
    return OPENAI_TILE_MODEL_TOKEN_COSTS.computerUse;
  }

  if (/\b(?:o1|o1-pro|o3)\b/u.test(modelText)) {
    return OPENAI_TILE_MODEL_TOKEN_COSTS.o1o3;
  }

  if (/\bgpt-4o-mini\b/u.test(modelText)) {
    return OPENAI_TILE_MODEL_TOKEN_COSTS.gpt4oMini;
  }

  if (/\bgpt-5(?:-|$)|\bgpt-5-chat-latest\b/u.test(modelText)) {
    return OPENAI_TILE_MODEL_TOKEN_COSTS.gpt5;
  }

  return OPENAI_TILE_MODEL_TOKEN_COSTS.default;
}

function getOpenAiPatchMultiplier(modelText = "") {
  const match = Object.entries(OPENAI_PATCH_MODEL_MULTIPLIERS).find(([modelName]) =>
    modelText.includes(modelName)
  );

  return Number.isFinite(match?.[1]) ? match[1] : 1;
}

function resolveOpenAiPatchBudget(modelText = "", detail = DEFAULT_IMAGE_DETAIL) {
  const useOriginalBudget =
    detail === "original" ||
    (detail === "auto" && modelText.includes("gpt-5.5"));

  if (useOriginalBudget) {
    return {
      maxDimension: 6000,
      patchBudget: 10000
    };
  }

  if (
    modelText.includes("gpt-5.4-mini") ||
    modelText.includes("gpt-5.4-nano") ||
    modelText.includes("gpt-5-mini") ||
    modelText.includes("gpt-5-nano") ||
    modelText.includes("gpt-5.2") ||
    modelText.includes("gpt-5.3-codex") ||
    modelText.includes("gpt-5-codex") ||
    modelText.includes("o4-mini") ||
    modelText.includes("gpt-4.1-mini") ||
    modelText.includes("gpt-4.1-nano")
  ) {
    return {
      maxDimension: 2048,
      patchBudget: 1536
    };
  }

  return {
    maxDimension: 2048,
    patchBudget: 2500
  };
}

function isOpenAiPatchModel(modelText = "") {
  return (
    modelText.includes("gpt-5.5") ||
    modelText.includes("gpt-5.4") ||
    modelText.includes("gpt-5.3-codex") ||
    modelText.includes("gpt-5.2") ||
    modelText.includes("gpt-5.1-codex") ||
    modelText.includes("gpt-5-codex") ||
    modelText.includes("gpt-5-mini") ||
    modelText.includes("gpt-5-nano") ||
    modelText.includes("o4-mini") ||
    modelText.includes("gpt-4.1-mini") ||
    modelText.includes("gpt-4.1-nano")
  );
}

function scaleDimensionsToMax(width, height, maxDimension) {
  if (!maxDimension || Math.max(width, height) <= maxDimension) {
    return { height, width };
  }

  const scale = maxDimension / Math.max(width, height);
  return {
    height: Math.max(1, Math.floor(height * scale)),
    width: Math.max(1, Math.floor(width * scale))
  };
}

function estimateOpenAiPatchImageTokens(visualData = {}, modelConfig = {}) {
  const detail = normalizeImageDetail(visualData.detail || modelConfig.detail);
  const modelText = normalizeVisionModelText(modelConfig);
  const multiplier = getOpenAiPatchMultiplier(modelText);

  if (detail === "low") {
    return Math.max(1, Math.ceil(256 * multiplier));
  }

  const { height, width } = resolveImageDimensionsForEstimate(visualData);
  const { maxDimension, patchBudget } = resolveOpenAiPatchBudget(modelText, detail);
  let resized = scaleDimensionsToMax(width, height, maxDimension);
  let patchCount = Math.ceil(resized.width / 32) * Math.ceil(resized.height / 32);

  if (patchCount > patchBudget) {
    const shrinkFactor = Math.sqrt((32 ** 2 * patchBudget) / (resized.width * resized.height));
    const scaledWidth = resized.width * shrinkFactor;
    const scaledHeight = resized.height * shrinkFactor;
    const adjustedShrinkFactor = shrinkFactor * Math.min(
      Math.floor(scaledWidth / 32) / Math.max(1, scaledWidth / 32),
      Math.floor(scaledHeight / 32) / Math.max(1, scaledHeight / 32)
    );

    resized = {
      height: Math.max(1, Math.floor(resized.height * adjustedShrinkFactor)),
      width: Math.max(1, Math.floor(resized.width * adjustedShrinkFactor))
    };
    patchCount = Math.ceil(resized.width / 32) * Math.ceil(resized.height / 32);
  }

  return Math.max(1, Math.ceil(Math.min(patchCount, patchBudget) * multiplier));
}

function estimateOpenAiTileImageTokens(visualData = {}, modelConfig = {}) {
  const detail = normalizeImageDetail(visualData.detail || modelConfig.detail);
  const modelText = normalizeVisionModelText(modelConfig);
  const tokenCost = getOpenAiTileTokenCost(modelText);

  if (detail === "low") {
    return tokenCost.base;
  }

  let { height, width } = resolveImageDimensionsForEstimate(visualData);
  const maxSide = Math.max(width, height);

  if (maxSide > 2048) {
    const scale = 2048 / maxSide;
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }

  const minSide = Math.min(width, height);

  if (minSide !== 768) {
    const scale = 768 / minSide;
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }

  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);
  return tokenCost.base + tiles * tokenCost.tile;
}

function estimateOpenAiImageTokens(visualData = {}, modelConfig = {}) {
  const modelText = normalizeVisionModelText(modelConfig);

  if (isOpenAiPatchModel(modelText)) {
    return estimateOpenAiPatchImageTokens(visualData, modelConfig);
  }

  return estimateOpenAiTileImageTokens(visualData, modelConfig);
}

export function estimateImageTokens(visualData = {}, options = {}) {
  const modelConfig = normalizeVisionModelConfig(options);

  if (!modelConfig.supportsVision) {
    return 0;
  }

  const modelText = normalizeVisionModelText(modelConfig);

  if (modelText.includes("anthropic") || modelText.includes("claude")) {
    return estimateClaudeImageTokens(visualData);
  }

  if (modelText.includes("google") || modelText.includes("gemini")) {
    return estimateGeminiImageTokens(visualData);
  }

  return estimateOpenAiImageTokens(visualData, modelConfig);
}

export function estimateVisualDataTokens(visualData, options = {}) {
  return normalizeVisualDataList(visualData).reduce(
    (total, entry) => total + estimateImageTokens(entry, options),
    0
  );
}

export function extractChatMessageTextContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (typeof part?.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");
}

export function countChatMessageTokens(message = {}, options = {}) {
  const textTokens = countTextTokens(extractChatMessageTextContent(message?.content));
  const visualTokens =
    message?.role === "user"
      ? estimateVisualDataTokens(message?.visualData, options)
      : 0;

  return textTokens + visualTokens;
}

export function countChatMessagesTokens(messages = [], options = {}) {
  return (Array.isArray(messages) ? messages : []).reduce(
    (total, message) => total + countChatMessageTokens(message, options),
    0
  );
}

export function buildVisualDataRenderSignature(visualData) {
  return normalizeVisualDataList(visualData)
    .map((entry) =>
      [
        entry.id,
        entry.name,
        entry.mediaType,
        entry.width,
        entry.height,
        entry.size,
        entry.detail,
        entry.dataUrl.length
      ].join(VISUAL_FIELD_SEPARATOR)
    )
    .join(VISUAL_SEPARATOR);
}

export function formatVisualDataDimensions(entry = {}) {
  const width = normalizePositiveInteger(entry.width, 0);
  const height = normalizePositiveInteger(entry.height, 0);

  return width && height ? `${width}x${height}` : "";
}

export function formatVisualDataSummary(entry = {}, options = {}) {
  const normalizedEntry = normalizeVisualDataEntry(entry);

  if (!normalizedEntry) {
    return "";
  }

  const tokenCount = estimateImageTokens(normalizedEntry, options);
  return [
    normalizedEntry.mediaType,
    formatVisualDataDimensions(normalizedEntry),
    tokenCount ? `${tokenCount.toLocaleString()} tokens` : "",
    normalizedEntry.detail && normalizedEntry.detail !== DEFAULT_IMAGE_DETAIL
      ? normalizedEntry.detail
      : ""
  ]
    .filter(Boolean)
    .join(" • ");
}

export function buildVisionContentParts(message = {}, options = {}) {
  const modelConfig = normalizeVisionModelConfig(options);
  const text = extractChatMessageTextContent(message?.content).trim();
  const visualData =
    message?.role === "user" && modelConfig.supportsVision
      ? normalizeVisualDataList(message.visualData)
      : [];

  if (!visualData.length) {
    return text;
  }

  const contentParts = [];

  if (text) {
    contentParts.push({
      text,
      type: "text"
    });
  }

  visualData.forEach((entry) => {
    contentParts.push({
      image_url: {
        detail: normalizeImageDetail(entry.detail || modelConfig.detail),
        url: entry.dataUrl
      },
      type: "image_url"
    });
  });

  return contentParts;
}

export function prepareChatMessagesForVisionTransport(messages = [], options = {}) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }

      return {
        ...message,
        content: buildVisionContentParts(message, options)
      };
    })
    .filter(Boolean);
}

export function appendVisualDataToMessage(message = {}, visualData = []) {
  const existingVisualData = normalizeVisualDataList(message.visualData);
  const nextVisualData = normalizeVisualDataList(
    Array.isArray(visualData) ? visualData : [visualData]
  );

  if (!nextVisualData.length) {
    return {
      ...message,
      visualData: existingVisualData
    };
  }

  const existingIds = new Set(existingVisualData.map((entry) => entry.id));
  const uniqueNextVisualData = nextVisualData.filter((entry) => {
    if (existingIds.has(entry.id)) {
      return false;
    }

    existingIds.add(entry.id);
    return true;
  });

  return {
    ...message,
    visualData: [...existingVisualData, ...uniqueNextVisualData]
  };
}

export function createVisualDataRuntime(options = {}) {
  const getMessages = typeof options.getMessages === "function" ? options.getMessages : () => [];
  const getActiveMessageId =
    typeof options.getActiveMessageId === "function" ? options.getActiveMessageId : () => "";
  const getAttachmentRuntime =
    typeof options.getAttachmentRuntime === "function" ? options.getAttachmentRuntime : () => null;
  const getModelConfig =
    typeof options.getModelConfig === "function" ? options.getModelConfig : () => ({});
  const addVisualDataToMessage =
    typeof options.addVisualDataToMessage === "function"
      ? options.addVisualDataToMessage
      : null;

  function listForMessage(messageId) {
    const normalizedMessageId = normalizeString(messageId);
    const message = (Array.isArray(getMessages()) ? getMessages() : []).find(
      (entry) => entry?.id === normalizedMessageId
    );

    return normalizeVisualDataList(message?.visualData);
  }

  const runtime = {
    all() {
      return (Array.isArray(getMessages()) ? getMessages() : [])
        .flatMap((message) =>
          normalizeVisualDataList(message?.visualData).map((entry) => ({
            ...entry,
            messageId: entry.messageId || message.id || ""
          }))
        );
    },
    async addToMessage(messageId, visualData) {
      if (!addVisualDataToMessage) {
        throw new Error("This chat runtime cannot mutate visual data.");
      }

      const normalizedMessageId = normalizeString(messageId);

      if (!normalizedMessageId) {
        throw new Error("A target message id is required.");
      }

      const normalizedVisualData = normalizeVisualDataList(
        Array.isArray(visualData) ? visualData : [visualData]
      );

      if (!normalizedVisualData.length) {
        throw new Error("Image visual data is required.");
      }

      return addVisualDataToMessage(normalizedMessageId, normalizedVisualData);
    },
    current() {
      return listForMessage(getActiveMessageId());
    },
    forMessage(messageId) {
      return listForMessage(messageId);
    },
    get(visualDataId) {
      const normalizedVisualDataId = normalizeString(visualDataId);

      if (!normalizedVisualDataId) {
        return null;
      }

      return runtime.all().find((entry) => entry.id === normalizedVisualDataId) || null;
    },
    async load(source, loadOptions = {}) {
      return runtime.loadImage(source, loadOptions);
    },
    async loadAttachment(attachmentOrId, loadOptions = {}) {
      const attachmentRuntime = getAttachmentRuntime();
      const attachment =
        typeof attachmentOrId === "string"
          ? attachmentRuntime?.get?.(attachmentOrId)
          : attachmentOrId;

      if (!attachment) {
        throw new Error(`Attachment not found: ${attachmentOrId}`);
      }

      return runtime.loadImage(attachment, {
        ...loadOptions,
        source: loadOptions.source || "attachment"
      });
    },
    async loadImage(source, loadOptions = {}) {
      const visualData = await createImageVisualData(source, loadOptions);
      const targetMessageId =
        normalizeString(loadOptions.messageId) ||
        normalizeString(visualData.messageId) ||
        normalizeString(getActiveMessageId());

      if (!targetMessageId) {
        throw new Error("No active chat message is available for visual data.");
      }

      const loadedVisualData = {
        ...visualData,
        messageId: targetMessageId,
        tokenCount: estimateImageTokens(visualData, getModelConfig())
      };
      await runtime.addToMessage(targetMessageId, loadedVisualData);

      return {
        ...loadedVisualData,
        visibleToModel: normalizeVisionModelConfig(getModelConfig()).supportsVision
      };
    },
    tokenCount(visualData = runtime.current(), tokenOptions = {}) {
      return estimateVisualDataTokens(visualData, {
        ...getModelConfig(),
        ...tokenOptions
      });
    }
  };

  Object.defineProperty(runtime, "activeMessageId", {
    get() {
      return normalizeString(getActiveMessageId());
    }
  });

  return runtime;
}
