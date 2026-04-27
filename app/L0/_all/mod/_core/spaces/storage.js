import {
  DEFAULT_WIDGET_POSITION,
  SPACE_ASSETS_DIR,
  SPACE_DATA_DIR,
  SPACE_SCRIPTS_DIR,
  SPACE_MANIFEST_FILE,
  SPACE_WIDGET_FILE_EXTENSION,
  SPACE_WIDGET_SCHEMA,
  SPACE_WIDGETS_DIR,
  SPACES_ROOT_PATH,
  SPACES_SCHEMA
} from "/mod/_core/spaces/constants.js";
import {
  normalizeWidgetPosition,
  positionToToken,
  resolveSpaceLayout
} from "/mod/_core/spaces/layout.js";
import {
  DEFAULT_WIDGET_SIZE,
  defineWidget,
  normalizeWidgetSize,
  sizeToToken
} from "/mod/_core/spaces/widget-sdk-core.js";
import {
  buildSpaceThumbnailUrlFromPath,
  resolveListedSpaceThumbnailPath
} from "/mod/_core/spaces/thumbnail_experiment/index.js";
import {
  getSpaceDisplayIcon,
  getSpaceDisplayIconColor,
  getSpaceDisplayTitle,
  normalizeSpaceAgentInstructions,
  normalizeSpaceIcon,
  normalizeSpaceIconColor,
  normalizeSpaceTitle
} from "/mod/_core/spaces/space-metadata.js";

const LISTED_SPACE_RECORD_REUSE_WINDOW_MS = 5000;

let recentListedSpaceRecords = new Map();
let recentListedSpaceRecordsAt = 0;

function ensureSpaceRuntime() {
  if (!globalThis.space || !globalThis.space.api || !globalThis.space.utils?.yaml) {
    throw new Error("Spaces runtime requires the authenticated Space browser runtime.");
  }

  return globalThis.space;
}

function isNotFoundError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("status 404") || message.includes("file not found") || message.includes("path not found");
}

function slugifySegment(value, fallback = "item") {
  const normalizedValue = String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
  const slug = normalizedValue
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug || fallback;
}

function normalizeOptionalSpaceId(value) {
  const rawValue = String(value ?? "").trim();
  return rawValue ? normalizeSpaceId(rawValue) : "";
}

function normalizeOptionalWidgetId(value) {
  const rawValue = String(value ?? "").trim();
  return rawValue ? normalizeWidgetId(rawValue) : "";
}

function formatTitleFromId(id) {
  return String(id || "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeInlineText(value, fallback = "") {
  return String(value ?? fallback ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function dedentMultilineText(value) {
  const normalizedValue = String(value ?? "").replace(/\r\n?/gu, "\n");

  if (!normalizedValue.trim()) {
    return "";
  }

  const lines = normalizedValue.split("\n");

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  const nonEmptyLines = lines.filter((line) => line.trim());
  const commonIndent = nonEmptyLines.reduce((smallestIndent, line) => {
    const indentLength = line.match(/^[\t ]*/u)?.[0].length ?? 0;
    return Math.min(smallestIndent, indentLength);
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(commonIndent) || commonIndent <= 0) {
    return lines.join("\n").trim();
  }

  return lines
    .map((line) => (line.trim() ? line.slice(commonIndent) : ""))
    .join("\n")
    .trim();
}

function ensureTrailingSlash(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return "";
  }

  return normalizedValue.endsWith("/") ? normalizedValue : `${normalizedValue}/`;
}

function getLastPathSegment(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
}

function uniqueList(values) {
  return [...new Set(values)];
}

function parseManifestSpaceId(path) {
  const match = String(path || "").match(/\/spaces\/([^/]+)\/space\.yaml$/u);
  return match ? match[1] : "";
}

function parseWidgetIdFromPath(path) {
  const match = String(path || "").match(/\/spaces\/[^/]+\/widgets\/([^/]+?)(?:\.yaml|\.js)$/u);
  return match ? normalizeOptionalWidgetId(match[1]) : "";
}

function normalizeWidgetMap(source, parser = (value) => value) {
  const entries = source && typeof source === "object" && !Array.isArray(source) ? Object.entries(source) : [];
  const output = {};

  entries.forEach(([key, value]) => {
    const normalizedKey = normalizeOptionalWidgetId(key);

    if (!normalizedKey) {
      return;
    }

    output[normalizedKey] = parser(value);
  });

  return output;
}

function pickWidgetMap(source, widgetIds) {
  const widgetIdSet = new Set(Array.isArray(widgetIds) ? widgetIds : []);
  const output = {};

  Object.entries(source || {}).forEach(([widgetId, value]) => {
    if (!widgetIdSet.has(widgetId)) {
      return;
    }

    output[widgetId] = value;
  });

  return output;
}

function normalizeWidgetIdList(values) {
  const rawValues = Array.isArray(values) ? values : typeof values === "string" && values ? [values] : [];
  return uniqueList(
    rawValues
      .map((value) => normalizeOptionalWidgetId(value))
      .filter(Boolean)
  );
}

function normalizeWidgetMetadataValue(value) {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeWidgetMetadataValue(entry))
      .filter((entry) => entry !== undefined);
  }

  const valueType = typeof value;

  if (valueType === "string" || valueType === "boolean") {
    return value;
  }

  if (valueType === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (valueType !== "object" || !value) {
    return undefined;
  }

  const output = {};

  Object.entries(value)
    .sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)))
    .forEach(([key, entryValue]) => {
      const normalizedKey = String(key ?? "").trim();

      if (!normalizedKey) {
        return;
      }

      const normalizedValue = normalizeWidgetMetadataValue(entryValue);

      if (normalizedValue !== undefined) {
        output[normalizedKey] = normalizedValue;
      }
    });

  return output;
}

function normalizeWidgetMetadata(value) {
  const normalizedValue = normalizeWidgetMetadataValue(value);
  return normalizedValue && typeof normalizedValue === "object" && !Array.isArray(normalizedValue)
    ? normalizedValue
    : {};
}

function hasOwnWidgetMetadataOption(options = {}) {
  return Object.prototype.hasOwnProperty.call(options || {}, "metadata") || Object.prototype.hasOwnProperty.call(options || {}, "meta");
}

function resolveWidgetMetadataOption(options = {}, fallback = undefined) {
  const metadataSource = hasOwnWidgetMetadataOption(options) ? options.metadata ?? options.meta : fallback;
  return normalizeWidgetMetadata(metadataSource);
}

function cloneWidgetRecord(widgetRecord) {
  return {
    ...widgetRecord,
    metadata: normalizeWidgetMetadata(widgetRecord?.metadata),
    defaultPosition: normalizeWidgetPosition(widgetRecord?.defaultPosition, DEFAULT_WIDGET_POSITION),
    defaultSize: normalizeWidgetSize(widgetRecord?.defaultSize, DEFAULT_WIDGET_SIZE)
  };
}

function cloneSpaceRecord(spaceRecord) {
  const agentInstructions = String(spaceRecord.agentInstructions ?? spaceRecord.specialInstructions ?? "");

  return {
    ...spaceRecord,
    agentInstructions,
    icon: String(spaceRecord.icon || ""),
    iconColor: String(spaceRecord.iconColor || ""),
    minimizedWidgetIds: [...spaceRecord.minimizedWidgetIds],
    specialInstructions: agentInstructions,
    widgetIds: [...spaceRecord.widgetIds],
    widgetPositions: { ...spaceRecord.widgetPositions },
    widgetSizes: { ...spaceRecord.widgetSizes },
    widgets: Object.fromEntries(
      Object.entries(spaceRecord.widgets || {}).map(([widgetId, widgetRecord]) => [widgetId, cloneWidgetRecord(widgetRecord)])
    )
  };
}

function clearRecentListedSpaceRecords() {
  recentListedSpaceRecords = new Map();
  recentListedSpaceRecordsAt = 0;
}

function setRecentListedSpaceRecords(recordsById) {
  recentListedSpaceRecords = new Map(
    [...(recordsById instanceof Map ? recordsById.entries() : [])]
      .filter(([spaceId, spaceRecord]) => Boolean(spaceId) && spaceRecord)
      .map(([spaceId, spaceRecord]) => [spaceId, cloneSpaceRecord(spaceRecord)])
  );
  recentListedSpaceRecordsAt = recentListedSpaceRecords.size ? Date.now() : 0;
}

function readRecentListedSpaceRecord(spaceId) {
  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);

  if (!normalizedSpaceId || !recentListedSpaceRecords.size) {
    return null;
  }

  if (Date.now() - recentListedSpaceRecordsAt > LISTED_SPACE_RECORD_REUSE_WINDOW_MS) {
    clearRecentListedSpaceRecords();
    return null;
  }

  const cachedRecord = recentListedSpaceRecords.get(normalizedSpaceId);
  return cachedRecord ? cloneSpaceRecord(cachedRecord) : null;
}

function formatSpaceUpdatedAtLabel(value) {
  const timestamp = Date.parse(String(value || ""));

  if (!Number.isFinite(timestamp)) {
    return "Unknown update time";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "2-digit"
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const lookup = (type) => parts.find((part) => part.type === type)?.value || "";
  const month = lookup("month");
  const day = lookup("day");
  const year = lookup("year");
  const hour = lookup("hour");
  const minute = lookup("minute");
  const dayPeriod = lookup("dayPeriod");
  const dateText = [month, day, year].filter(Boolean).join(" ");
  const timeText = [hour && minute ? `${hour}:${minute}` : "", dayPeriod].filter(Boolean).join(" ");

  return [dateText, timeText].filter(Boolean).join(" ");
}

function formatSpaceListEntry(spaceRecord, widgetCount = spaceRecord.widgetIds.length, widgetNames = [], thumbnailPath = "") {
  const normalizedWidgetNames = uniqueList(
    (Array.isArray(widgetNames) ? widgetNames : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const normalizedThumbnailPath = String(thumbnailPath || "").trim();

  return {
    ...spaceRecord,
    displayIcon: getSpaceDisplayIcon(spaceRecord),
    displayIconColor: getSpaceDisplayIconColor(spaceRecord),
    displayTitle: getSpaceDisplayTitle(spaceRecord),
    thumbnailPath: normalizedThumbnailPath,
    thumbnailUrl: buildSpaceThumbnailUrlFromPath(normalizedThumbnailPath, spaceRecord.updatedAt),
    updatedAtLabel: formatSpaceUpdatedAtLabel(spaceRecord.updatedAt),
    hiddenWidgetCount: Math.max(0, normalizedWidgetNames.length - 4),
    widgetCount,
    widgetCountLabel: `${widgetCount} ${widgetCount === 1 ? "widget" : "widgets"}`,
    widgetNames: normalizedWidgetNames,
    widgetPreviewNames: normalizedWidgetNames.slice(0, 4)
  };
}

function normalizeManifest(rawManifest, fallbackId = "") {
  const now = new Date().toISOString();
  const id = normalizeSpaceId(rawManifest?.id || fallbackId || rawManifest?.title || `space-${Date.now().toString(36)}`);
  const agentInstructions = normalizeSpaceAgentInstructions(
    rawManifest?.agent_instructions ??
      rawManifest?.agentInstructions ??
      rawManifest?.special_instructions ??
      rawManifest?.specialInstructions
  );
  const widgetIds = normalizeWidgetIdList(
    rawManifest?.layout_order ?? rawManifest?.widget_order ?? rawManifest?.widgets ?? rawManifest?.widgetIds
  );
  const minimizedWidgetIds = normalizeWidgetIdList(
    rawManifest?.minimized ?? rawManifest?.collapsed ?? rawManifest?.minimizedWidgetIds
  );
  const widgetPositions = pickWidgetMap(
    normalizeWidgetMap(rawManifest?.positions ?? rawManifest?.widgetPositions, (value) =>
      normalizeWidgetPosition(value, DEFAULT_WIDGET_POSITION)
    ),
    widgetIds
  );
  const widgetSizes = pickWidgetMap(
    normalizeWidgetMap(rawManifest?.sizes ?? rawManifest?.widgetSizes, (value) => normalizeWidgetSize(value, DEFAULT_WIDGET_SIZE)),
    widgetIds
  );

  return {
    createdAt: String(rawManifest?.created_at || rawManifest?.createdAt || now),
    dataPath: buildSpaceDataPath(id),
    agentInstructions,
    icon: normalizeSpaceIcon(rawManifest?.icon),
    iconColor: normalizeSpaceIconColor(rawManifest?.icon_color ?? rawManifest?.iconColor),
    id,
    manifestPath: buildSpaceManifestPath(id),
    minimizedWidgetIds,
    path: buildSpaceRootPath(id),
    schema: String(rawManifest?.schema || SPACES_SCHEMA),
    specialInstructions: agentInstructions,
    title: normalizeSpaceTitle(rawManifest?.title),
    updatedAt: String(rawManifest?.updated_at || rawManifest?.updatedAt || now),
    widgetIds,
    widgetPositions,
    widgetSizes,
    widgets: {},
    widgetsPath: buildSpaceWidgetsPath(id),
    assetsPath: buildSpaceAssetsPath(id)
  };
}

function serializeManifest(spaceRecord) {
  const runtime = ensureSpaceRuntime();
  const normalizedIcon = normalizeSpaceIcon(spaceRecord.icon);
  const normalizedIconColor = normalizeSpaceIconColor(spaceRecord.iconColor);
  const normalizedTitle = normalizeSpaceTitle(spaceRecord.title);
  const normalizedAgentInstructions = normalizeSpaceAgentInstructions(
    spaceRecord.agentInstructions ?? spaceRecord.specialInstructions
  );
  const yamlSource = {
    created_at: spaceRecord.createdAt,
    id: spaceRecord.id,
    schema: SPACES_SCHEMA,
    updated_at: spaceRecord.updatedAt
  };

  if (normalizedTitle) {
    yamlSource.title = normalizedTitle;
  }

  if (normalizedIcon) {
    yamlSource.icon = normalizedIcon;
  }

  if (normalizedIconColor) {
    yamlSource.icon_color = normalizedIconColor;
  }

  if (normalizedAgentInstructions) {
    yamlSource.agent_instructions = normalizedAgentInstructions;
  }

  if (spaceRecord.widgetIds.length) {
    yamlSource.layout_order = [...spaceRecord.widgetIds];
  }

  const sizeEntries = spaceRecord.widgetIds
    .filter((widgetId) => spaceRecord.widgetSizes[widgetId])
    .map((widgetId) => [widgetId, sizeToToken(spaceRecord.widgetSizes[widgetId])]);

  if (sizeEntries.length) {
    yamlSource.sizes = Object.fromEntries(sizeEntries);
  }

  const positionEntries = spaceRecord.widgetIds
    .filter((widgetId) => spaceRecord.widgetPositions[widgetId])
    .map((widgetId) => [widgetId, positionToToken(spaceRecord.widgetPositions[widgetId])]);

  if (positionEntries.length) {
    yamlSource.positions = Object.fromEntries(positionEntries);
  }

  const minimizedWidgetIds = normalizeWidgetIdList(spaceRecord.minimizedWidgetIds).filter((widgetId) =>
    spaceRecord.widgetIds.includes(widgetId)
  );

  if (minimizedWidgetIds.length) {
    yamlSource.minimized = minimizedWidgetIds;
  }

  return runtime.utils.yaml.stringify(yamlSource);
}

function normalizeWidgetRecord(rawWidget, fallback = {}) {
  const widgetId = normalizeWidgetId(rawWidget?.id || fallback.id || rawWidget?.name || "widget");
  const name = String(rawWidget?.name || rawWidget?.title || fallback.name || formatTitleFromId(widgetId) || "Untitled Widget").trim();
  const sizeSource =
    rawWidget?.size ??
    rawWidget?.default_size ??
    rawWidget?.defaultSize ??
    (rawWidget?.cols !== undefined || rawWidget?.rows !== undefined
      ? {
          cols: rawWidget?.cols,
          rows: rawWidget?.rows
        }
      : fallback.defaultSize);
  const positionSource =
    rawWidget?.position ??
    rawWidget?.default_position ??
    rawWidget?.defaultPosition ??
    (rawWidget?.col !== undefined || rawWidget?.row !== undefined
      ? {
          col: rawWidget?.col,
          row: rawWidget?.row
        }
      : fallback.defaultPosition);

  return {
    defaultPosition: normalizeWidgetPosition(positionSource, DEFAULT_WIDGET_POSITION),
    defaultSize: normalizeWidgetSize(sizeSource, DEFAULT_WIDGET_SIZE),
    id: widgetId,
    metadata: normalizeWidgetMetadata(rawWidget?.metadata ?? rawWidget?.meta ?? fallback.metadata),
    name: name || formatTitleFromId(widgetId) || "Untitled Widget",
    path: String(fallback.path || ""),
    rendererSource: normalizeRendererSource(rawWidget?.renderer ?? rawWidget?.render ?? fallback.rendererSource),
    schema: String(rawWidget?.schema || fallback.schema || SPACE_WIDGET_SCHEMA)
  };
}

function formatWidgetChoiceLabel(widgetId, widgetRecord = {}) {
  const widgetName = normalizeInlineText(widgetRecord?.name || formatTitleFromId(widgetId));

  if (!widgetName || widgetName === widgetId) {
    return widgetId;
  }

  return `${widgetId} (${widgetName})`;
}

function listReadableWidgetChoices(spaceRecord) {
  return normalizeWidgetIdList(spaceRecord?.widgetIds).map((widgetId) =>
    formatWidgetChoiceLabel(widgetId, spaceRecord?.widgets?.[widgetId])
  );
}

function resolveWidgetIdFromCurrentSpace(spaceRecord, widgetName) {
  const rawWidgetName = String(widgetName ?? "").trim();

  if (!rawWidgetName) {
    throw new Error("A widget name or id is required.");
  }

  const normalizedWidgetId = normalizeOptionalWidgetId(rawWidgetName);

  if (normalizedWidgetId && spaceRecord?.widgets?.[normalizedWidgetId]) {
    return normalizedWidgetId;
  }

  const normalizedWidgetName = rawWidgetName.toLocaleLowerCase();
  const matchingWidgetIds = normalizeWidgetIdList(spaceRecord?.widgetIds).filter((widgetId) => {
    const widgetRecord = spaceRecord?.widgets?.[widgetId];
    const displayName = normalizeInlineText(widgetRecord?.name || formatTitleFromId(widgetId));
    return displayName.toLocaleLowerCase() === normalizedWidgetName;
  });

  if (matchingWidgetIds.length === 1) {
    return matchingWidgetIds[0];
  }

  if (matchingWidgetIds.length > 1) {
    throw new Error(
      `Widget name "${rawWidgetName}" is ambiguous in space "${spaceRecord?.id || ""}". Matches: ${matchingWidgetIds
        .map((widgetId) => formatWidgetChoiceLabel(widgetId, spaceRecord?.widgets?.[widgetId]))
        .join(", ")}.`
    );
  }

  const availableWidgets = listReadableWidgetChoices(spaceRecord);
  throw new Error(
    `Widget "${rawWidgetName}" was not found in space "${spaceRecord?.id || ""}". Available widgets: ${
      availableWidgets.length ? availableWidgets.join(", ") : "none"
    }.`
  );
}

function buildWidgetMetadataLines(widgetRecord) {
  const normalizedWidget = normalizeWidgetRecord(widgetRecord, widgetRecord);
  const lines = [
    `id: ${normalizedWidget.id}`,
    `name: ${normalizeInlineText(normalizedWidget.name, "Untitled Widget") || "Untitled Widget"}`,
    `cols: ${normalizedWidget.defaultSize.cols}`,
    `rows: ${normalizedWidget.defaultSize.rows}`
  ];

  if (Object.keys(normalizedWidget.metadata).length) {
    lines.push(`metadata: ${JSON.stringify(normalizedWidget.metadata)}`);
  }

  if (normalizedWidget.defaultPosition.col !== DEFAULT_WIDGET_POSITION.col) {
    lines.push(`col: ${normalizedWidget.defaultPosition.col}`);
  }

  if (normalizedWidget.defaultPosition.row !== DEFAULT_WIDGET_POSITION.row) {
    lines.push(`row: ${normalizedWidget.defaultPosition.row}`);
  }

  return lines;
}

function getWidgetRendererReadLines(widgetRecord) {
  const normalizedWidget = normalizeWidgetRecord(widgetRecord, widgetRecord);
  return dedentMultilineText(normalizedWidget.rendererSource)
    .replace(/\r\n?/gu, "\n")
    .split("\n");
}

function formatWidgetRecordForRead(widgetRecord) {
  const rendererLines = getWidgetRendererReadLines(widgetRecord);
  return [
    ...buildWidgetMetadataLines(widgetRecord),
    "renderer↓",
    ...rendererLines.map((line, index) => `${index} ${line}`)
  ].join("\n");
}

function hasOwnWidgetPatchField(edit, key) {
  return Object.prototype.hasOwnProperty.call(edit || {}, key);
}

function isWidgetPatchTextLike(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function readWidgetPatchContentField(edit = {}) {
  if (hasOwnWidgetPatchField(edit, "content")) {
    return {
      key: "content",
      value: edit.content
    };
  }

  if (hasOwnWidgetPatchField(edit, "text")) {
    return {
      key: "text",
      value: edit.text
    };
  }

  if (hasOwnWidgetPatchField(edit, "replace")) {
    return {
      key: "replace",
      value: edit.replace
    };
  }

  if (hasOwnWidgetPatchField(edit, "value")) {
    return {
      key: "value",
      value: edit.value
    };
  }

  return null;
}

function normalizeWidgetPatchStringContent(contentField, { allowMissing = false, defaultValue = "" } = {}) {
  if (!contentField) {
    return allowMissing ? defaultValue : null;
  }

  if (contentField.value === undefined || contentField.value === null) {
    return allowMissing ? defaultValue : "";
  }

  if (!isWidgetPatchTextLike(contentField.value)) {
    throw new Error(`Widget patch \`${contentField.key}\` must be a string.`);
  }

  return String(contentField.value);
}

function normalizeWidgetPatchContentLines(content) {
  const normalizedContent = String(content ?? "").replace(/\r\n?/gu, "\n");
  const contentLines = normalizedContent.split("\n");

  if (contentLines.length > 0 && contentLines[contentLines.length - 1] === "") {
    contentLines.pop();
  }

  return contentLines;
}

function findAllWidgetPatchOccurrences(sourceText, snippet) {
  const indexes = [];
  let searchIndex = 0;

  while (searchIndex <= sourceText.length) {
    const matchIndex = sourceText.indexOf(snippet, searchIndex);

    if (matchIndex === -1) {
      break;
    }

    indexes.push(matchIndex);
    searchIndex = matchIndex + Math.max(1, snippet.length);
  }

  return indexes;
}

function normalizeWidgetTextPatchEdit(edit, sourceText) {
  const rawFind = hasOwnWidgetPatchField(edit, "find")
    ? edit.find
    : hasOwnWidgetPatchField(edit, "search")
      ? edit.search
      : undefined;

  if (typeof rawFind !== "string" || !rawFind) {
    throw new Error("Exact widget snippet edits require a non-empty string `find` copied from the readable renderer.");
  }

  const matchIndexes = findAllWidgetPatchOccurrences(sourceText, rawFind);

  if (!matchIndexes.length) {
    throw new Error("Exact widget snippet edit `find` text was not found in the readable renderer.");
  }

  if (matchIndexes.length > 1) {
    throw new Error("Exact widget snippet edit `find` text is ambiguous. Use a longer unique snippet or switch to line-based edits.");
  }

  return {
    content: normalizeWidgetPatchStringContent(readWidgetPatchContentField(edit), {
      allowMissing: true,
      defaultValue: ""
    }),
    end: matchIndexes[0] + rawFind.length,
    find: rawFind,
    kind: "text",
    mode: "text",
    start: matchIndexes[0]
  };
}

function normalizeWidgetPatchEdit(edit, lineCount, sourceText) {
  const normalizedEdit = edit && typeof edit === "object" ? edit : {};

  if (hasOwnWidgetPatchField(normalizedEdit, "find") || hasOwnWidgetPatchField(normalizedEdit, "search")) {
    return normalizeWidgetTextPatchEdit(normalizedEdit, sourceText);
  }

  const rawRange =
    Array.isArray(normalizedEdit.range) && normalizedEdit.range.length >= 1 ? normalizedEdit.range : null;
  const rawFrom = hasOwnWidgetPatchField(normalizedEdit, "from")
    ? normalizedEdit.from
    : hasOwnWidgetPatchField(normalizedEdit, "line")
      ? normalizedEdit.line
      : hasOwnWidgetPatchField(normalizedEdit, "startLine")
        ? normalizedEdit.startLine
        : rawRange?.[0];
  const rawTo = hasOwnWidgetPatchField(normalizedEdit, "to")
    ? normalizedEdit.to
    : hasOwnWidgetPatchField(normalizedEdit, "endLine")
      ? normalizedEdit.endLine
      : rawRange?.length >= 2
        ? rawRange[1]
        : hasOwnWidgetPatchField(normalizedEdit, "line")
          ? normalizedEdit.line
          : null;
  const from = Number.parseInt(rawFrom, 10);
  const hasTo = rawTo !== undefined && rawTo !== null && `${rawTo}` !== "";
  const to = hasTo ? Number.parseInt(rawTo, 10) : null;
  const contentField = readWidgetPatchContentField(normalizedEdit);
  const hasContent = Boolean(contentField);

  if (!Number.isInteger(from) || from < 0) {
    throw new Error("Widget patch edits require an integer zero-based renderer `from` line number of 0 or greater.");
  }

  if (!hasTo && !hasContent) {
    throw new Error("Insert edits must include replacement text in `content`.");
  }

  if (!hasTo) {
    if (from > lineCount) {
      throw new Error(
        `Insert edit line ${from} is outside the readable renderer range 0-${lineCount}.`
      );
    }

    return {
      contentLines: normalizeWidgetPatchContentLines(normalizeWidgetPatchStringContent(contentField)),
      from,
      kind: "insert",
      mode: "line",
      to: null
    };
  }

  if (!Number.isInteger(to) || to < from) {
    throw new Error(
      "Widget patch edits require `to` to be an integer renderer line number greater than or equal to `from`."
    );
  }

  if (to >= lineCount) {
    throw new Error(`Patch edit range ${from}-${to} is outside the readable renderer range 0-${Math.max(0, lineCount - 1)}.`);
  }

  return {
    contentLines: hasContent ? normalizeWidgetPatchContentLines(normalizeWidgetPatchStringContent(contentField)) : [],
    from,
    kind: "replace",
    mode: "line",
    to
  };
}

function validateLineWidgetPatchEdits(edits = [], lineCount = 0) {
  const spans = edits
    .map((edit) =>
      edit.kind === "insert"
        ? {
            end: edit.from - 0.5,
            label: `insert before ${edit.from}`,
            start: edit.from - 0.5
          }
        : {
            end: edit.to,
            label: `${edit.from}-${edit.to}`,
            start: edit.from
          }
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start <= spans[index - 1].end) {
      throw new Error(`Widget patch edits must not overlap. Conflicting edits: ${spans[index - 1].label} and ${spans[index].label}.`);
    }
  }

  if (lineCount > 1) {
    const rewritesWholeRenderer = edits.some(
      (edit) => edit.kind === "replace" && edit.from === 0 && edit.to === lineCount - 1
    );

    if (rewritesWholeRenderer) {
      throw new Error("patchWidget(...) is for partial renderer edits only; use renderWidget(...) for a full renderer rewrite.");
    }
  }
}

function validateTextWidgetPatchEdits(edits = [], sourceText = "") {
  const spans = edits
    .map((edit) => ({
      end: edit.end,
      label: `find "${normalizeInlineText(edit.find, "").slice(0, 60)}"`,
      start: edit.start
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) {
      throw new Error(`Widget patch edits must not overlap. Conflicting edits: ${spans[index - 1].label} and ${spans[index].label}.`);
    }
  }

  if (sourceText.length > 0) {
    const rewritesWholeRenderer = edits.some((edit) => edit.start === 0 && edit.end === sourceText.length);

    if (rewritesWholeRenderer) {
      throw new Error("patchWidget(...) is for partial renderer edits only; use renderWidget(...) for a full renderer rewrite.");
    }
  }
}

function validateWidgetPatchEdits(edits = [], lineCount = 0, sourceText = "") {
  const patchModes = uniqueList(edits.map((edit) => edit.mode).filter(Boolean));

  if (patchModes.length > 1) {
    throw new Error("Widget patch edits must use either zero-based line ranges or exact `find` snippets in one call, not both.");
  }

  if (patchModes[0] === "text") {
    validateTextWidgetPatchEdits(edits, sourceText);
    return;
  }

  validateLineWidgetPatchEdits(edits, lineCount);
}

function applyWidgetPatchEdits(widgetRecord, edits = []) {
  const sourceLines = getWidgetRendererReadLines(widgetRecord);
  const sourceText = sourceLines.join("\n");
  const normalizedEdits = (Array.isArray(edits) ? edits : []).map((edit) =>
    normalizeWidgetPatchEdit(edit, sourceLines.length, sourceText)
  );

  if (!normalizedEdits.length) {
    return normalizeWidgetRecord(widgetRecord, widgetRecord).rendererSource;
  }

  validateWidgetPatchEdits(normalizedEdits, sourceLines.length, sourceText);

  if (normalizedEdits[0]?.mode === "text") {
    let nextText = sourceText;

    [...normalizedEdits]
      .sort((left, right) => right.start - left.start)
      .forEach((edit) => {
        nextText = `${nextText.slice(0, edit.start)}${edit.content}${nextText.slice(edit.end)}`;
      });

    return normalizeRendererSource(nextText);
  }

  const nextLines = [...sourceLines];
  // Apply from bottom to top so every `from`/`to` range stays anchored to the
  // last numbered widget readback, even when the same patch inserts or deletes lines.
  const descendingEdits = [...normalizedEdits].sort((left, right) => {
    const leftAnchor = left.kind === "insert" ? left.from - 0.5 : left.from;
    const rightAnchor = right.kind === "insert" ? right.from - 0.5 : right.from;
    return rightAnchor - leftAnchor;
  });

  descendingEdits.forEach((edit) => {
    if (edit.kind === "insert") {
      nextLines.splice(edit.from, 0, ...edit.contentLines);
      return;
    }

    nextLines.splice(edit.from, edit.to - edit.from + 1, ...edit.contentLines);
  });

  return normalizeRendererSource(nextLines.join("\n"));
}

function applyPatchedWidgetAttributes(widgetRecord, options = {}) {
  const nextSize = normalizeWidgetSize(
    options.size ??
      {
        cols: options.cols,
        rows: options.rows
      },
    widgetRecord?.defaultSize || DEFAULT_WIDGET_SIZE
  );
  const nextPosition = normalizeWidgetPosition(
    options.position ??
      {
        col: options.col,
        row: options.row
      },
    widgetRecord?.defaultPosition || DEFAULT_WIDGET_POSITION
  );

  return normalizeWidgetRecord(
    {
      col: nextPosition.col,
      cols: nextSize.cols,
      id: widgetRecord?.id,
      metadata: resolveWidgetMetadataOption(options, widgetRecord?.metadata),
      name: options.name ?? options.title ?? widgetRecord?.name,
      renderer: widgetRecord?.rendererSource,
      row: nextPosition.row,
      rows: nextSize.rows,
      schema: widgetRecord?.schema
    },
    widgetRecord
  );
}

function buildWidgetWriteResult(spaceRecord, widgetId) {
  const widgetRecord = spaceRecord?.widgets?.[widgetId];

  return {
    space: spaceRecord,
    widgetId,
    widgetPath: buildSpaceWidgetFilePath(spaceRecord.id, widgetId),
    widgetText: widgetRecord ? formatWidgetRecordForRead(widgetRecord) : ""
  };
}

function buildWidgetWriteResults(spaceRecord, widgetIds = []) {
  return normalizeWidgetIdList(widgetIds)
    .filter((widgetId) => spaceRecord?.widgets?.[widgetId])
    .map((widgetId) => buildWidgetWriteResult(spaceRecord, widgetId));
}

function serializeWidgetRecord(widgetRecord) {
  const runtime = ensureSpaceRuntime();
  const normalizedMetadata = normalizeWidgetMetadata(widgetRecord?.metadata);
  const yamlSource = {
    cols: widgetRecord.defaultSize.cols,
    id: widgetRecord.id,
    name: widgetRecord.name,
    renderer: widgetRecord.rendererSource,
    rows: widgetRecord.defaultSize.rows,
    schema: SPACE_WIDGET_SCHEMA
  };

  if (Object.keys(normalizedMetadata).length) {
    yamlSource.metadata = normalizedMetadata;
  }

  if (widgetRecord.defaultPosition.col !== DEFAULT_WIDGET_POSITION.col) {
    yamlSource.col = widgetRecord.defaultPosition.col;
  }

  if (widgetRecord.defaultPosition.row !== DEFAULT_WIDGET_POSITION.row) {
    yamlSource.row = widgetRecord.defaultPosition.row;
  }

  return runtime.utils.yaml.stringify(yamlSource);
}

function createHtmlRendererSource(htmlSource) {
  return [
    "(parent) => {",
    `  parent.innerHTML = ${JSON.stringify(String(htmlSource || '<div class="spaces-raw-demo"></div>'))};`,
    "}"
  ].join("\n");
}

async function deleteAppPathIfExists(path) {
  const runtime = ensureSpaceRuntime();

  try {
    await runtime.api.fileDelete(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }

  return true;
}

function normalizeLegacyFunctionSource(sourceText) {
  const trimmedSource = String(sourceText || "").trim();

  if (!trimmedSource) {
    return "";
  }

  if (
    /^(async\s+)?function\b/u.test(trimmedSource) ||
    trimmedSource.startsWith("(") ||
    trimmedSource.includes("=>")
  ) {
    return trimmedSource;
  }

  const methodMatch = trimmedSource.match(/^(async\s+)?([A-Za-z_$][\w$]*)\s*\(/u);

  if (methodMatch) {
    const asyncPrefix = methodMatch[1] || "";
    const methodName = methodMatch[2];
    return `${asyncPrefix}function ${methodName}${trimmedSource.slice(methodMatch[0].length - 1)}`;
  }

  return trimmedSource;
}

export function normalizeRendererSource(value, fallback = "") {
  const sourceText =
    typeof value === "function"
      ? value.toString()
      : value ?? fallback ?? "";
  const normalizedValue = normalizeLegacyFunctionSource(sourceText);

  if (!normalizedValue) {
    throw new Error("Widgets require a renderer function.");
  }

  return normalizedValue;
}

function tryCompileRendererMethodSource(rendererSource) {
  const methodObject = Function(`return ({ ${rendererSource} });`)();

  if (typeof methodObject?.renderer === "function") {
    return methodObject.renderer;
  }

  const functionValues = Object.values(methodObject || {}).filter((value) => typeof value === "function");

  if (functionValues.length === 1) {
    return functionValues[0];
  }

  return null;
}

function validateWidgetRendererSourceForWrite(widgetRecord, actionLabel = "save") {
  const normalizedWidget = normalizeWidgetRecord(widgetRecord, widgetRecord);
  const rendererSource = normalizeRendererSource(normalizedWidget.rendererSource);
  const widgetId = normalizedWidget.id;
  let compiledRenderer = null;

  try {
    compiledRenderer = Function(`return (${rendererSource});`)();
  } catch (directCompileError) {
    try {
      compiledRenderer = tryCompileRendererMethodSource(rendererSource);
    } catch {
      const message = String(directCompileError?.message || "Invalid renderer syntax.");
      throw new Error(`Cannot ${actionLabel} widget "${widgetId}": renderer syntax is invalid (${message}). No files were written.`);
    }

    if (!compiledRenderer) {
      const message = String(directCompileError?.message || "Invalid renderer syntax.");
      throw new Error(`Cannot ${actionLabel} widget "${widgetId}": renderer syntax is invalid (${message}). No files were written.`);
    }
  }

  if (typeof compiledRenderer !== "function") {
    throw new Error(`Cannot ${actionLabel} widget "${widgetId}": renderer must evaluate to a function. No files were written.`);
  }

  return {
    ...normalizedWidget,
    rendererSource
  };
}

function createDefaultRendererSource() {
  return [
    "(parent) => {",
    "  const copy = document.createElement(\"p\");",
    "  copy.className = \"spaces-widget-placeholder-copy\";",
    "  copy.textContent = \"Replace this widget renderer with your own DOM code.\";",
    "  parent.appendChild(copy);",
    "}"
  ].join("\n");
}

function createWidgetRecordFromOptions(options = {}, fallback = {}) {
  const rendererSource =
    options.renderer ??
    options.render ??
    options.source ??
    (options.html !== undefined ? createHtmlRendererSource(options.html) : fallback.rendererSource ?? createDefaultRendererSource());
  const sizeSource =
    options.size ??
    (options.cols !== undefined || options.rows !== undefined
      ? {
          cols: options.cols,
          rows: options.rows
        }
      : fallback.defaultSize);
  const positionSource =
    options.position ??
    (options.col !== undefined || options.row !== undefined
      ? {
          col: options.col,
          row: options.row
        }
      : fallback.defaultPosition);

  return normalizeWidgetRecord(
    {
      col: options.col,
      cols: options.cols,
      defaultPosition: positionSource,
      defaultSize: sizeSource,
      id: options.widgetId || options.id || fallback.id,
      metadata: resolveWidgetMetadataOption(options, fallback.metadata),
      name: options.name || options.title || fallback.name,
      renderer: rendererSource,
      row: options.row,
      rows: options.rows,
      schema: options.schema || fallback.schema || SPACE_WIDGET_SCHEMA
    },
    fallback
  );
}

function parseWidgetSource(sourceText, fallback = {}) {
  const runtime = ensureSpaceRuntime();
  const normalizedSource = String(sourceText || "");
  const parsed = runtime.utils.yaml.parse(normalizedSource);

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed.renderer !== undefined || parsed.render !== undefined || parsed.id !== undefined || parsed.name !== undefined)
  ) {
    return normalizeWidgetRecord(parsed, fallback);
  }

  return normalizeWidgetRecord(
    {
      id: fallback.id,
      name: fallback.name,
      renderer: normalizedSource
    },
    fallback
  );
}

async function readManifestFile(spaceId) {
  const runtime = ensureSpaceRuntime();
  const response = await runtime.api.fileRead(buildSpaceManifestPath(spaceId));
  const parsed = runtime.utils.yaml.parse(String(response?.content || ""));
  return normalizeManifest(parsed, spaceId);
}

async function writeManifestFile(spaceRecord) {
  const runtime = ensureSpaceRuntime();
  const normalizedRecord = normalizeManifest(spaceRecord, spaceRecord?.id);
  normalizedRecord.widgetIds = [...spaceRecord.widgetIds];
  normalizedRecord.widgetPositions = pickWidgetMap(spaceRecord.widgetPositions, normalizedRecord.widgetIds);
  normalizedRecord.widgetSizes = pickWidgetMap(spaceRecord.widgetSizes, normalizedRecord.widgetIds);
  normalizedRecord.minimizedWidgetIds = normalizeWidgetIdList(spaceRecord.minimizedWidgetIds).filter((widgetId) =>
    normalizedRecord.widgetIds.includes(widgetId)
  );
  normalizedRecord.icon = normalizeSpaceIcon(spaceRecord?.icon ?? normalizedRecord.icon);
  normalizedRecord.iconColor = normalizeSpaceIconColor(spaceRecord?.iconColor ?? normalizedRecord.iconColor);
  const normalizedAgentInstructions = normalizeSpaceAgentInstructions(
    spaceRecord?.agentInstructions ??
      spaceRecord?.specialInstructions ??
      normalizedRecord.agentInstructions ??
      normalizedRecord.specialInstructions
  );
  normalizedRecord.agentInstructions = normalizedAgentInstructions;
  normalizedRecord.specialInstructions = normalizedAgentInstructions;
  normalizedRecord.updatedAt = String(spaceRecord?.updatedAt || normalizedRecord.updatedAt);
  normalizedRecord.createdAt = String(spaceRecord?.createdAt || normalizedRecord.createdAt);
  normalizedRecord.title = normalizeSpaceTitle(spaceRecord?.title ?? normalizedRecord.title);

  await runtime.api.fileWrite({
    content: serializeManifest(normalizedRecord),
    path: buildSpaceManifestPath(normalizedRecord.id)
  });

  clearRecentListedSpaceRecords();
  return normalizedRecord;
}

async function spaceExists(spaceId) {
  const runtime = ensureSpaceRuntime();

  try {
    await runtime.api.fileInfo(buildSpaceManifestPath(spaceId));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function createUniqueSpaceId(baseId) {
  const normalizedBaseId = normalizeSpaceId(baseId, "space");
  let nextId = normalizedBaseId;
  let suffix = 2;

  while (await spaceExists(nextId)) {
    nextId = `${normalizedBaseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

async function createNextUnnamedSpaceId() {
  let suffix = 1;

  while (true) {
    const nextId = `space-${suffix}`;

    if (!(await spaceExists(nextId))) {
      return nextId;
    }

    suffix += 1;
  }
}

async function listSpaceWidgetPaths(spaceId) {
  const runtime = ensureSpaceRuntime();

  try {
    const listResult = await runtime.api.fileList(buildSpaceWidgetsPath(spaceId), false);
    return Array.isArray(listResult?.paths) ? listResult.paths : [];
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

async function loadLegacyWidgetDefinition(spaceId, widgetId) {
  const moduleUrl = new URL(resolveAppUrl(buildLegacySpaceWidgetFilePath(spaceId, widgetId)), globalThis.location.origin);
  moduleUrl.searchParams.set("v", `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const module = await import(moduleUrl.toString());
  const candidate = module?.default ?? module?.widget ?? module;

  if (!candidate || typeof candidate !== "object" || typeof candidate.render !== "function") {
    throw new Error(`Legacy widget "${widgetId}" does not export a valid definition.`);
  }

  return defineWidget(candidate);
}

function createLegacyRendererSource(definition) {
  const loadSource = typeof definition.load === "function" ? normalizeLegacyFunctionSource(definition.load.toString()) : "";
  const renderSource = normalizeLegacyFunctionSource(definition.render.toString());

  return [
    "async (parent, currentSpace, context) => {",
    loadSource ? `  const load = ${loadSource};` : "  const load = null;",
    `  const render = ${renderSource};`,
    "  const data = load ? await load(context) : undefined;",
    "  return render({ ...context, data });",
    "}"
  ].join("\n");
}

async function migrateLegacyWidgetModules(spaceId, widgetPaths = null) {
  const runtime = ensureSpaceRuntime();
  const resolvedWidgetPaths = Array.isArray(widgetPaths) ? widgetPaths : await listSpaceWidgetPaths(spaceId);
  const legacyPaths = resolvedWidgetPaths.filter((path) => String(path || "").endsWith(".js"));

  if (!legacyPaths.length) {
    return false;
  }

  const nextFiles = [];
  const deletePaths = [];

  for (const legacyPath of legacyPaths) {
    const widgetId = parseWidgetIdFromPath(legacyPath);

    if (!widgetId) {
      continue;
    }

    const definition = await loadLegacyWidgetDefinition(spaceId, widgetId);
    const widgetRecord = normalizeWidgetRecord(
      {
        id: widgetId,
        name: definition.title,
        renderer: createLegacyRendererSource(definition),
        size: definition.size
      },
      {
        id: widgetId,
        path: buildSpaceWidgetFilePath(spaceId, widgetId)
      }
    );

    nextFiles.push({
      content: serializeWidgetRecord(widgetRecord),
      path: buildSpaceWidgetFilePath(spaceId, widgetId)
    });
    deletePaths.push(legacyPath);
  }

  if (nextFiles.length) {
    await runtime.api.fileWrite({ files: nextFiles });
  }

  if (deletePaths.length) {
    await runtime.api.fileDelete({ paths: deletePaths });
  }

  return nextFiles.length > 0 || deletePaths.length > 0;
}

function parseWidgetFiles(spaceId, files = []) {
  const runtime = ensureSpaceRuntime();
  const widgets = {};

  files.forEach((file) => {
    const widgetId = parseWidgetIdFromPath(file?.path);

    if (!widgetId) {
      return;
    }

    const parsed = runtime.utils.yaml.parse(String(file?.content || ""));
    widgets[widgetId] = normalizeWidgetRecord(parsed, {
      id: widgetId,
      path: buildSpaceWidgetFilePath(spaceId, widgetId)
    });
  });

  return widgets;
}

async function readWidgetFiles(spaceId, widgetPaths = null) {
  const runtime = ensureSpaceRuntime();
  const yamlWidgetPaths = (Array.isArray(widgetPaths) ? widgetPaths : await listSpaceWidgetPaths(spaceId))
    .filter((path) => String(path || "").endsWith(SPACE_WIDGET_FILE_EXTENSION));

  if (!yamlWidgetPaths.length) {
    return {};
  }

  // Idempotent batch read: same race window as `readSpace` — widget files can
  // be deleted between the path-index listing and the read. The parser
  // already accepts a partial files array, so let the server return 200
  // with any missing entries under `skipped` instead of throwing 404.
  const readResult = await runtime.api.fileRead({
    files: yamlWidgetPaths,
    ifExists: true
  });

  return parseWidgetFiles(spaceId, Array.isArray(readResult?.files) ? readResult.files : []);
}

async function readWidgetFile(spaceId, widgetId, fallback = {}) {
  const runtime = ensureSpaceRuntime();
  const widgetPath = buildSpaceWidgetFilePath(spaceId, widgetId);
  const response = await runtime.api.fileRead(widgetPath);
  const parsed = runtime.utils.yaml.parse(String(response?.content || ""));

  return normalizeWidgetRecord(parsed, {
    ...fallback,
    id: widgetId,
    path: widgetPath
  });
}

function buildResolvedLayoutInputs(spaceRecord, overrides = {}) {
  const widgetIds = normalizeWidgetIdList(overrides.widgetIds ?? spaceRecord.widgetIds).filter((widgetId) => spaceRecord.widgets[widgetId]);
  const widgetPositions = {};
  const widgetSizes = {};

  widgetIds.forEach((widgetId) => {
    const widgetRecord = overrides.widgets?.[widgetId] || spaceRecord.widgets?.[widgetId];
    const defaultPosition = widgetRecord?.defaultPosition || DEFAULT_WIDGET_POSITION;
    const defaultSize = widgetRecord?.defaultSize || DEFAULT_WIDGET_SIZE;
    const sourcePositions = overrides.widgetPositions ?? spaceRecord.widgetPositions;
    const sourceSizes = overrides.widgetSizes ?? spaceRecord.widgetSizes;

    widgetPositions[widgetId] = normalizeWidgetPosition(sourcePositions?.[widgetId] ?? defaultPosition, defaultPosition);
    widgetSizes[widgetId] = normalizeWidgetSize(sourceSizes?.[widgetId] ?? defaultSize, defaultSize);
  });

  return {
    minimizedWidgetIds: normalizeWidgetIdList(overrides.minimizedWidgetIds ?? spaceRecord.minimizedWidgetIds).filter((widgetId) =>
      widgetIds.includes(widgetId)
    ),
    widgetIds,
    widgetPositions,
    widgetSizes
  };
}

function syncManifestWithResolvedLayout(spaceRecord, resolvedLayout) {
  const widgetIds = normalizeWidgetIdList(spaceRecord.widgetIds).filter((widgetId) => spaceRecord.widgets[widgetId]);
  spaceRecord.widgetIds = widgetIds;
  spaceRecord.widgetPositions = pickWidgetMap(resolvedLayout.positions, widgetIds);
  spaceRecord.widgetSizes = pickWidgetMap(spaceRecord.widgetSizes, widgetIds);
  spaceRecord.minimizedWidgetIds = widgetIds.filter((widgetId) => resolvedLayout.minimizedMap[widgetId]);
}

export function normalizeSpaceId(value, fallback = "space") {
  const fallbackId = slugifySegment(fallback, "space");
  return slugifySegment(value, fallbackId);
}

export function normalizeWidgetId(value, fallback = "widget") {
  return slugifySegment(value, fallback);
}

export function buildSpaceRootPath(spaceId) {
  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);

  if (!normalizedSpaceId) {
    throw new Error("A spaceId is required.");
  }

  return `${SPACES_ROOT_PATH}${normalizedSpaceId}/`;
}

export function buildSpaceManifestPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_MANIFEST_FILE}`;
}

export function buildSpaceWidgetsPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_WIDGETS_DIR}`;
}

export function buildSpaceWidgetFilePath(spaceId, widgetId) {
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);

  if (!normalizedWidgetId) {
    throw new Error("A widgetId is required.");
  }

  return `${buildSpaceWidgetsPath(spaceId)}${normalizedWidgetId}${SPACE_WIDGET_FILE_EXTENSION}`;
}

function buildLegacySpaceWidgetFilePath(spaceId, widgetId) {
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);

  if (!normalizedWidgetId) {
    throw new Error("A widgetId is required.");
  }

  return `${buildSpaceWidgetsPath(spaceId)}${normalizedWidgetId}.js`;
}

export function buildSpaceDataPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_DATA_DIR}`;
}

export function buildSpaceAssetsPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_ASSETS_DIR}`;
}

export function buildSpaceScriptsPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_SCRIPTS_DIR}`;
}

export function resolveAppUrl(path) {
  const normalizedPath = String(path || "").trim();

  if (!normalizedPath) {
    throw new Error("A logical app path is required.");
  }

  if (normalizedPath === "~") {
    return "/~/";
  }

  if (normalizedPath.startsWith("~/")) {
    return `/${normalizedPath}`;
  }

  if (normalizedPath.startsWith("/app/")) {
    return resolveAppUrl(normalizedPath.slice("/app/".length));
  }

  if (normalizedPath.startsWith("/~/")) {
    return normalizedPath;
  }

  if (/^\/(L0|L1|L2)\//u.test(normalizedPath)) {
    return normalizedPath;
  }

  if (/^(L0|L1|L2)\//u.test(normalizedPath)) {
    return `/${normalizedPath}`;
  }

  throw new Error(`Unsupported app path "${normalizedPath}".`);
}

export function createWidgetSource(options = {}) {
  const widgetRecord = createWidgetRecordFromOptions(
    {
      ...options,
      renderer:
        options.renderer ??
        options.render ??
        options.source ??
        (options.html !== undefined ? createHtmlRendererSource(options.html) : undefined)
    },
    {
      id: normalizeWidgetId(options.widgetId || options.id || options.name || options.title || "widget"),
      name: String(options.name || options.title || "Untitled Widget").trim() || "Untitled Widget",
      rendererSource: createDefaultRendererSource()
    }
  );

  return serializeWidgetRecord(widgetRecord);
}

export function previewWidgetRecord(options = {}, fallback = {}) {
  const widgetFallbackId = normalizeWidgetId(options.widgetId || options.id || options.name || options.title || fallback.id || "widget");

  if (options.source !== undefined) {
    const parsedWidget = parseWidgetSource(options.source, {
        ...fallback,
        id: fallback.id || widgetFallbackId,
        name: options.name || options.title || fallback.name || formatTitleFromId(widgetFallbackId),
        rendererSource: fallback.rendererSource || createDefaultRendererSource()
      });

    return applyPatchedWidgetAttributes(parsedWidget, {
      ...options,
      title: options.title ?? parsedWidget.name,
      widgetId: options.widgetId ?? options.id ?? parsedWidget.id
    });
  }

  return createWidgetRecordFromOptions(options, {
    ...fallback,
    defaultPosition: fallback.defaultPosition || DEFAULT_WIDGET_POSITION,
    defaultSize: fallback.defaultSize || DEFAULT_WIDGET_SIZE,
    id: fallback.id || widgetFallbackId,
    name: fallback.name || formatTitleFromId(widgetFallbackId),
    rendererSource: fallback.rendererSource || createDefaultRendererSource()
  });
}

export async function listSpaces() {
  const runtime = ensureSpaceRuntime();
  let matchedPaths = [];

  try {
    const listResult = await runtime.api.fileList(SPACES_ROOT_PATH, true);
    matchedPaths = Array.isArray(listResult?.paths) ? listResult.paths : [];
  } catch (error) {
    if (isNotFoundError(error)) {
      clearRecentListedSpaceRecords();
      return [];
    }

    throw error;
  }

  const manifestPaths = matchedPaths.filter((path) => /\/spaces\/[^/]+\/space\.yaml$/u.test(String(path || "")));
  const widgetPaths = matchedPaths.filter((path) => /\/spaces\/[^/]+\/widgets\/[^/]+\.(?:yaml|js)$/u.test(String(path || "")));

  if (!manifestPaths.length) {
    clearRecentListedSpaceRecords();
    return [];
  }

  const yamlWidgetPaths = widgetPaths.filter((path) => String(path || "").endsWith(SPACE_WIDGET_FILE_EXTENSION));
  const widgetCounts = {};
  widgetPaths.forEach((path) => {
    const normalizedPath = String(path || "");
    const widgetSpaceId = normalizedSpaceIdFromWidgetPath(normalizedPath);
    const widgetId = parseWidgetIdFromPath(normalizedPath);

    if (!widgetSpaceId || !widgetId) {
      return;
    }

    if (!widgetCounts[widgetSpaceId]) {
      widgetCounts[widgetSpaceId] = new Set();
    }

    widgetCounts[widgetSpaceId].add(widgetId);
  });

  // Idempotent bulk read: when listing all spaces, individual manifest or
  // widget files can disappear between the path-index walk and the read
  // (concurrent space deletion, file_explorer rename, watchdog catching up).
  // The downstream code keys files by path through a Map, so missing entries
  // simply do not appear in the lookup — the same shape we get from a 200
  // with a `skipped` field, just without the 404 noise.
  const readResult = await runtime.api.fileRead({
    files: [...manifestPaths, ...yamlWidgetPaths],
    ifExists: true
  });
  const files = Array.isArray(readResult?.files) ? readResult.files : [];
  const fileMap = new Map(
    files.map((file) => [String(file?.path || ""), file])
  );
  const widgetNamesBySpaceId = {};
  const widgetRecordsBySpaceId = {};
  const uncacheableSpaceIds = new Set(
    widgetPaths
      .filter((path) => String(path || "").endsWith(".js"))
      .map((path) => normalizedSpaceIdFromWidgetPath(path))
      .filter(Boolean)
  );

  yamlWidgetPaths.forEach((widgetPath) => {
    const file = fileMap.get(widgetPath);
    const normalizedPath = String(file?.path || widgetPath);
    const spaceId = normalizedSpaceIdFromWidgetPath(normalizedPath);
    const widgetId = parseWidgetIdFromPath(normalizedPath);

    if (!spaceId || !widgetId) {
      return;
    }

    if (!widgetNamesBySpaceId[spaceId]) {
      widgetNamesBySpaceId[spaceId] = {};
    }

    try {
      const widgetRecord = parseWidgetFiles(spaceId, [file])[widgetId];

      if (!widgetRecord) {
        return;
      }

      if (!widgetRecordsBySpaceId[spaceId]) {
        widgetRecordsBySpaceId[spaceId] = {};
      }

      widgetRecordsBySpaceId[spaceId][widgetId] = widgetRecord;
      widgetNamesBySpaceId[spaceId][widgetId] = widgetRecord.name || formatTitleFromId(widgetId);
    } catch {
      uncacheableSpaceIds.add(spaceId);
      widgetNamesBySpaceId[spaceId][widgetId] = formatTitleFromId(widgetId);
    }
  });

  const nextListedSpaceRecords = new Map();
  const listEntries = manifestPaths
    .map((manifestPath) => {
      const file = fileMap.get(manifestPath);
      const fallbackId = parseManifestSpaceId(file?.path || manifestPath);
      const parsedContent = runtime.utils.yaml.parse(String(file?.content || ""));
      const normalizedSpace = normalizeManifest(parsedContent, fallbackId);
      const widgetNameMap = widgetNamesBySpaceId[normalizedSpace.id] || {};
      const widgetRecords = widgetRecordsBySpaceId[normalizedSpace.id] || {};
      const discoveredWidgetIds = Object.keys(widgetRecords);
      const availableWidgetIds = uniqueList([
        ...normalizedSpace.widgetIds.filter((widgetId) => widgetRecords[widgetId]),
        ...discoveredWidgetIds
      ]);
      const thumbnailPath = resolveListedSpaceThumbnailPath(normalizedSpace.id, matchedPaths);
      const orderedWidgetNames = uniqueList([
        ...normalizedSpace.widgetIds
          .map((widgetId) => widgetNameMap[widgetId] || formatTitleFromId(widgetId))
          .filter(Boolean),
        ...Object.entries(widgetNameMap)
          .filter(([widgetId]) => !normalizedSpace.widgetIds.includes(widgetId))
          .map(([, widgetName]) => widgetName)
      ]);

      if (!uncacheableSpaceIds.has(normalizedSpace.id)) {
        nextListedSpaceRecords.set(normalizedSpace.id, {
          ...normalizedSpace,
          minimizedWidgetIds: normalizedSpace.minimizedWidgetIds.filter((widgetId) => availableWidgetIds.includes(widgetId)),
          widgetIds: availableWidgetIds,
          widgetPositions: pickWidgetMap(normalizedSpace.widgetPositions, availableWidgetIds),
          widgetSizes: pickWidgetMap(normalizedSpace.widgetSizes, availableWidgetIds),
          widgets: Object.fromEntries(
            availableWidgetIds
              .filter((widgetId) => widgetRecords[widgetId])
              .map((widgetId) => [widgetId, widgetRecords[widgetId]])
          )
        });
      }

      return formatSpaceListEntry(
        normalizedSpace,
        widgetCounts[normalizedSpace.id]?.size || normalizedSpace.widgetIds.length,
        orderedWidgetNames,
        thumbnailPath
      );
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "");

      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return left.title.localeCompare(right.title, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });

  setRecentListedSpaceRecords(nextListedSpaceRecords);
  return listEntries;
}

function normalizedSpaceIdFromWidgetPath(path) {
  const match = String(path || "").match(/\/spaces\/([^/]+)\/widgets\/[^/]+\.(?:yaml|js)$/u);
  return match ? normalizeOptionalSpaceId(match[1]) : "";
}

export async function readSpace(spaceId) {
  const cachedSpaceRecord = readRecentListedSpaceRecord(spaceId);

  if (cachedSpaceRecord) {
    return cachedSpaceRecord;
  }

  const runtime = ensureSpaceRuntime();
  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);

  if (!normalizedSpaceId) {
    throw new Error("A target spaceId is required to read a space.");
  }

  let widgetPaths = await listSpaceWidgetPaths(normalizedSpaceId);
  const migratedLegacyWidgets = await migrateLegacyWidgetModules(normalizedSpaceId, widgetPaths);

  if (migratedLegacyWidgets) {
    clearRecentListedSpaceRecords();
    widgetPaths = await listSpaceWidgetPaths(normalizedSpaceId);
  }

  const yamlWidgetPaths = widgetPaths.filter((path) => String(path || "").endsWith(SPACE_WIDGET_FILE_EXTENSION));
  // Idempotent batch read: a widget file or even the manifest can disappear
  // between the path-index lookup and the read (space deletion races, watchdog
  // catching up, external file removal). The downstream code already treats a
  // missing manifest as `null`, so let the server return 200 with the missing
  // path under `skipped` instead of throwing 404 and triggering the
  // fetch-proxy retry path. The widget files come from `listSpaceWidgetPaths`
  // which itself filters by index presence, so only race-window misses end up
  // skipped here.
  const readResult = await runtime.api.fileRead({
    files: [buildSpaceManifestPath(normalizedSpaceId), ...yamlWidgetPaths],
    ifExists: true
  });
  const files = Array.isArray(readResult?.files) ? readResult.files : [];
  const manifestFile =
    files.find((file) => String(file?.path || "") === buildSpaceManifestPath(normalizedSpaceId)) ||
    files[0] ||
    null;
  const manifest = normalizeManifest(
    runtime.utils.yaml.parse(String(manifestFile?.content || "")),
    normalizedSpaceId
  );
  const widgets = parseWidgetFiles(
    manifest.id,
    files.filter((file) => String(file?.path || "").endsWith(SPACE_WIDGET_FILE_EXTENSION))
  );
  const discoveredWidgetIds = Object.keys(widgets);
  const widgetIds = uniqueList([...manifest.widgetIds.filter((widgetId) => widgets[widgetId]), ...discoveredWidgetIds]);

  return {
    ...manifest,
    minimizedWidgetIds: manifest.minimizedWidgetIds.filter((widgetId) => widgetIds.includes(widgetId)),
    widgetIds,
    widgetPositions: pickWidgetMap(manifest.widgetPositions, widgetIds),
    widgetSizes: pickWidgetMap(manifest.widgetSizes, widgetIds),
    widgets
  };
}

export async function readWidget(options = {}) {
  const spaceId = normalizeOptionalSpaceId(options.spaceId);

  if (!spaceId) {
    throw new Error("A target spaceId is required to read a widget.");
  }

  const widgetName = String(options.widgetName ?? options.widgetId ?? options.name ?? "").trim();
  const currentSpace = await readSpace(spaceId);
  const widgetId = resolveWidgetIdFromCurrentSpace(currentSpace, widgetName);
  const widgetRecord = await readWidgetFile(spaceId, widgetId, currentSpace.widgets?.[widgetId]);

  return formatWidgetRecordForRead(widgetRecord);
}

export async function createSpace(options = {}) {
  const runtime = ensureSpaceRuntime();
  const icon = normalizeSpaceIcon(options.icon);
  const iconColor = normalizeSpaceIconColor(options.iconColor);
  const title = normalizeSpaceTitle(options.title);
  const requestedId = normalizeOptionalSpaceId(options.id);
  const id = requestedId
    ? await createUniqueSpaceId(requestedId)
    : title
      ? await createUniqueSpaceId(title)
      : await createNextUnnamedSpaceId();
  const timestamp = new Date().toISOString();
  const manifest = normalizeManifest(
    {
      created_at: timestamp,
      agent_instructions: normalizeSpaceAgentInstructions(
        options.agentInstructions ?? options.specialInstructions ?? options.instructions
      ),
      icon,
      icon_color: iconColor,
      id,
      schema: SPACES_SCHEMA,
      title,
      updated_at: timestamp
    },
    id
  );

  await runtime.api.fileWrite({
    files: [
      { path: buildSpaceRootPath(id) },
      { path: buildSpaceWidgetsPath(id) },
      { path: buildSpaceDataPath(id) },
      { path: buildSpaceAssetsPath(id) }
    ]
  });

  await runtime.api.fileWrite({
    content: serializeManifest(manifest),
    path: buildSpaceManifestPath(id)
  });

  clearRecentListedSpaceRecords();
  return manifest;
}

export async function installExampleSpace(options = {}) {
  const runtime = ensureSpaceRuntime();
  const sourcePath = ensureTrailingSlash(options.sourcePath ?? options.fromPath);

  if (!sourcePath) {
    throw new Error("A sourcePath is required to install an example space.");
  }

  const sourceManifestResult = await runtime.api.fileRead(`${sourcePath}${SPACE_MANIFEST_FILE}`);
  const sourceManifest = normalizeManifest(
    runtime.utils.yaml.parse(String(sourceManifestResult?.content || "")),
    getLastPathSegment(sourcePath)
  );
  const title =
    options.title !== undefined
      ? normalizeSpaceTitle(options.title)
      : normalizeSpaceTitle(sourceManifest.title);
  const icon =
    options.icon !== undefined
      ? normalizeSpaceIcon(options.icon)
      : normalizeSpaceIcon(sourceManifest.icon);
  const iconColor =
    options.iconColor !== undefined
      ? normalizeSpaceIconColor(options.iconColor)
      : normalizeSpaceIconColor(sourceManifest.iconColor);
  const id = await createUniqueSpaceId(options.id || title || sourceManifest.id);
  const timestamp = new Date().toISOString();

  await runtime.api.fileWrite(SPACES_ROOT_PATH);
  await runtime.api.fileCopy([
    {
      fromPath: sourcePath,
      toPath: buildSpaceRootPath(id)
    }
  ]);
  await writeManifestFile({
    ...sourceManifest,
    agentInstructions: normalizeSpaceAgentInstructions(
      options.agentInstructions ??
        options.specialInstructions ??
        options.instructions ??
        sourceManifest.agentInstructions ??
        sourceManifest.specialInstructions
    ),
    createdAt: timestamp,
    icon,
    iconColor,
    id,
    title,
    updatedAt: timestamp
  });

  clearRecentListedSpaceRecords();
  return readSpace(id);
}

export async function duplicateSpace(spaceIdOrOptions = {}) {
  const runtime = ensureSpaceRuntime();
  const requestedSpaceId =
    typeof spaceIdOrOptions === "string"
      ? spaceIdOrOptions
      : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
        ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id
        : "";
  const sourceSpaceId = normalizeOptionalSpaceId(requestedSpaceId);

  if (!sourceSpaceId) {
    throw new Error("A target spaceId is required to duplicate a space.");
  }

  const sourceManifest = await readManifestFile(sourceSpaceId);
  const nextId = await createUniqueSpaceId(spaceIdOrOptions?.newId || `${sourceSpaceId}-copy`);
  const timestamp = new Date().toISOString();

  await runtime.api.fileWrite(SPACES_ROOT_PATH);
  await runtime.api.fileCopy({
    fromPath: buildSpaceRootPath(sourceSpaceId),
    toPath: buildSpaceRootPath(nextId)
  });
  await writeManifestFile({
    ...sourceManifest,
    createdAt: timestamp,
    id: nextId,
    manifestPath: buildSpaceManifestPath(nextId),
    path: buildSpaceRootPath(nextId),
    updatedAt: timestamp,
    widgetsPath: buildSpaceWidgetsPath(nextId),
    dataPath: buildSpaceDataPath(nextId),
    assetsPath: buildSpaceAssetsPath(nextId)
  });

  clearRecentListedSpaceRecords();
  return readSpace(nextId);
}

export async function removeSpace(spaceIdOrOptions = {}) {
  const runtime = ensureSpaceRuntime();
  const requestedSpaceId =
    typeof spaceIdOrOptions === "string"
      ? spaceIdOrOptions
      : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
        ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id
        : "";
  const spaceId = normalizeOptionalSpaceId(requestedSpaceId);

  if (!spaceId) {
    throw new Error("A target spaceId is required to remove a space.");
  }

  const spacePath = buildSpaceRootPath(spaceId);
  await runtime.api.fileDelete(spacePath);
  clearRecentListedSpaceRecords();

  return {
    id: spaceId,
    path: spacePath
  };
}

export async function saveSpaceMeta(options = {}) {
  const currentSpace = cloneSpaceRecord(await readSpace(options.id));
  const nextSpace = cloneSpaceRecord(currentSpace);

  if (options.title !== undefined) {
    nextSpace.title = normalizeSpaceTitle(options.title);
  }

  if (options.icon !== undefined) {
    nextSpace.icon = normalizeSpaceIcon(options.icon);
  }

  if (options.iconColor !== undefined) {
    nextSpace.iconColor = normalizeSpaceIconColor(options.iconColor);
  }

  if (
    options.agentInstructions !== undefined ||
    options.specialInstructions !== undefined ||
    options.instructions !== undefined
  ) {
    const nextAgentInstructions = normalizeSpaceAgentInstructions(
      options.agentInstructions ?? options.specialInstructions ?? options.instructions
    );
    nextSpace.agentInstructions = nextAgentInstructions;
    nextSpace.specialInstructions = nextAgentInstructions;
  }

  nextSpace.updatedAt = new Date().toISOString();
  return writeManifestFile(nextSpace);
}

export async function saveSpaceLayout(options = {}) {
  const currentSpace = cloneSpaceRecord(await readSpace(options.id));
  const nextSpace = cloneSpaceRecord(currentSpace);

  if (Array.isArray(options.widgetIds)) {
    nextSpace.widgetIds = normalizeWidgetIdList(options.widgetIds).filter((widgetId) => nextSpace.widgets[widgetId]);
  }

  if (options.widgetPositions && typeof options.widgetPositions === "object") {
    nextSpace.widgetPositions = normalizeWidgetMap(options.widgetPositions, (value) =>
      normalizeWidgetPosition(value, DEFAULT_WIDGET_POSITION)
    );
  }

  if (options.widgetSizes && typeof options.widgetSizes === "object") {
    nextSpace.widgetSizes = normalizeWidgetMap(options.widgetSizes, (value) =>
      normalizeWidgetSize(value, DEFAULT_WIDGET_SIZE)
    );
  }

  if (Array.isArray(options.minimizedWidgetIds)) {
    nextSpace.minimizedWidgetIds = normalizeWidgetIdList(options.minimizedWidgetIds);
  }

  const layoutInputs = buildResolvedLayoutInputs(nextSpace);
  const resolvedLayout = resolveSpaceLayout(layoutInputs);

  syncManifestWithResolvedLayout(nextSpace, resolvedLayout);
  nextSpace.updatedAt = new Date().toISOString();

  return writeManifestFile(nextSpace);
}

export async function upsertWidget(options = {}) {
  const runtime = ensureSpaceRuntime();
  const spaceId = normalizeOptionalSpaceId(options.spaceId);

  if (!spaceId) {
    throw new Error("A target spaceId is required to upsert a widget.");
  }

  const currentSpace = cloneSpaceRecord(await readSpace(spaceId));
  const widgetFallbackId = normalizeWidgetId(options.widgetId || options.id || options.name || options.title || "widget");
  const existingWidget = currentSpace.widgets[widgetFallbackId] || null;
  const widgetRecord = validateWidgetRendererSourceForWrite(
    previewWidgetRecord(options, {
      ...existingWidget,
      defaultPosition: existingWidget?.defaultPosition || DEFAULT_WIDGET_POSITION,
      defaultSize: existingWidget?.defaultSize || DEFAULT_WIDGET_SIZE,
      id: existingWidget?.id || widgetFallbackId,
      name: options.name || options.title || existingWidget?.name || formatTitleFromId(widgetFallbackId),
      path: buildSpaceWidgetFilePath(spaceId, widgetFallbackId),
      rendererSource: existingWidget?.rendererSource || createDefaultRendererSource()
    }),
    "save"
  );
  const widgetId = widgetRecord.id;
  const nextSpace = cloneSpaceRecord(currentSpace);
  const hasExistingWidget = nextSpace.widgetIds.includes(widgetId);

  nextSpace.widgets[widgetId] = {
    ...widgetRecord,
    path: buildSpaceWidgetFilePath(spaceId, widgetId)
  };

  if (!hasExistingWidget) {
    nextSpace.widgetIds.push(widgetId);
  }

  if (!hasExistingWidget && currentSpace.widgetIds.length === 0 && !normalizeSpaceTitle(currentSpace.title)) {
    nextSpace.title = normalizeSpaceTitle(widgetRecord.name);
  }

  nextSpace.widgetPositions = pickWidgetMap(nextSpace.widgetPositions, nextSpace.widgetIds);
  nextSpace.widgetSizes = pickWidgetMap(nextSpace.widgetSizes, nextSpace.widgetIds);
  nextSpace.updatedAt = new Date().toISOString();

  const files = [
    {
      content: serializeManifest(nextSpace),
      path: buildSpaceManifestPath(spaceId)
    },
    {
      content: serializeWidgetRecord(nextSpace.widgets[widgetId]),
      path: buildSpaceWidgetFilePath(spaceId, widgetId)
    }
  ];

  await runtime.api.fileWrite({ files });
  clearRecentListedSpaceRecords();

  return buildWidgetWriteResult(nextSpace, widgetId);
}

export async function upsertWidgets(options = {}) {
  const runtime = ensureSpaceRuntime();
  const spaceId = normalizeOptionalSpaceId(options.spaceId);
  const requestedWidgets = Array.isArray(options.widgets) ? options.widgets : [];

  if (!spaceId) {
    throw new Error("A target spaceId is required to upsert widgets.");
  }

  if (!requestedWidgets.length) {
    throw new Error("At least one widget definition is required to upsert widgets.");
  }

  const currentSpace = cloneSpaceRecord(await readSpace(spaceId));
  const nextSpace = cloneSpaceRecord(currentSpace);
  const upsertedWidgetIds = [];
  const files = [];

  requestedWidgets.forEach((requestedWidget) => {
    const widgetOptions =
      requestedWidget && typeof requestedWidget === "object" && !Array.isArray(requestedWidget)
        ? requestedWidget
        : {};
    const widgetFallbackId = normalizeWidgetId(
      widgetOptions.widgetId || widgetOptions.id || widgetOptions.name || widgetOptions.title || "widget"
    );
    const existingWidget = nextSpace.widgets[widgetFallbackId] || null;
    const widgetRecord = validateWidgetRendererSourceForWrite(
      previewWidgetRecord(widgetOptions, {
        ...existingWidget,
        defaultPosition: existingWidget?.defaultPosition || DEFAULT_WIDGET_POSITION,
        defaultSize: existingWidget?.defaultSize || DEFAULT_WIDGET_SIZE,
        id: existingWidget?.id || widgetFallbackId,
        name: widgetOptions.name || widgetOptions.title || existingWidget?.name || formatTitleFromId(widgetFallbackId),
        path: buildSpaceWidgetFilePath(spaceId, widgetFallbackId),
        rendererSource: existingWidget?.rendererSource || createDefaultRendererSource()
      }),
      "save"
    );
    const widgetId = widgetRecord.id;
    const hasExistingWidget = nextSpace.widgetIds.includes(widgetId);

    nextSpace.widgets[widgetId] = {
      ...widgetRecord,
      path: buildSpaceWidgetFilePath(spaceId, widgetId)
    };

    if (!hasExistingWidget) {
      nextSpace.widgetIds.push(widgetId);
    }

    if (!hasExistingWidget && currentSpace.widgetIds.length === 0 && !normalizeSpaceTitle(currentSpace.title)) {
      nextSpace.title = normalizeSpaceTitle(widgetRecord.name);
    }

    upsertedWidgetIds.push(widgetId);
    files.push({
      content: serializeWidgetRecord(nextSpace.widgets[widgetId]),
      path: buildSpaceWidgetFilePath(spaceId, widgetId)
    });
  });

  nextSpace.widgetPositions = pickWidgetMap(nextSpace.widgetPositions, nextSpace.widgetIds);
  nextSpace.widgetSizes = pickWidgetMap(nextSpace.widgetSizes, nextSpace.widgetIds);
  nextSpace.updatedAt = new Date().toISOString();

  await runtime.api.fileWrite({
    files: [
      {
        content: serializeManifest(nextSpace),
        path: buildSpaceManifestPath(spaceId)
      },
      ...files
    ]
  });
  clearRecentListedSpaceRecords();

  return {
    space: nextSpace,
    widgetIds: normalizeWidgetIdList(upsertedWidgetIds),
    widgetResults: buildWidgetWriteResults(nextSpace, upsertedWidgetIds)
  };
}

export async function patchWidget(options = {}) {
  const runtime = ensureSpaceRuntime();
  const spaceId = normalizeOptionalSpaceId(options.spaceId);
  const widgetId = normalizeOptionalWidgetId(options.widgetId ?? options.id);

  if (!spaceId) {
    throw new Error("A target spaceId is required to patch a widget.");
  }

  if (!widgetId) {
    throw new Error("A widgetId is required to patch a widget.");
  }

  if (
    options.renderer !== undefined ||
    options.render !== undefined ||
    options.source !== undefined ||
    options.html !== undefined
  ) {
    throw new Error("patchWidget(...) accepts renderer line edits through `edits`; use renderWidget(...) for full renderer replacement.");
  }

  const currentSpace = cloneSpaceRecord(await readSpace(spaceId));
  const currentWidget = currentSpace.widgets?.[widgetId];

  if (!currentWidget) {
    throw new Error(`Cannot patch widget "${widgetId}": widget not found in space "${spaceId}".`);
  }

  const patchedRendererSource = applyWidgetPatchEdits(currentWidget, options.edits ?? options.lineEdits);
  const nextWidget = validateWidgetRendererSourceForWrite(
    applyPatchedWidgetAttributes(
      {
        ...currentWidget,
        rendererSource: patchedRendererSource
      },
      options
    ),
    "patch"
  );
  const nextSpace = cloneSpaceRecord(currentSpace);
  nextSpace.widgets[widgetId] = {
    ...nextWidget,
    path: buildSpaceWidgetFilePath(spaceId, widgetId)
  };
  nextSpace.updatedAt = new Date().toISOString();

  const files = [
    {
      content: serializeManifest(nextSpace),
      path: buildSpaceManifestPath(spaceId)
    },
    {
      content: serializeWidgetRecord(nextSpace.widgets[widgetId]),
      path: buildSpaceWidgetFilePath(spaceId, widgetId)
    }
  ];

  await runtime.api.fileWrite({ files });
  clearRecentListedSpaceRecords();

  return buildWidgetWriteResult(nextSpace, widgetId);
}

export async function removeWidget(options = {}) {
  const result = await removeWidgets({
    ...options,
    widgetIds: [options.widgetId]
  });

  return {
    space: result.space,
    widgetId: result.widgetIds[0] || normalizeOptionalWidgetId(options.widgetId)
  };
}

export async function removeWidgets(options = {}) {
  const runtime = ensureSpaceRuntime();
  const spaceId = normalizeOptionalSpaceId(options.spaceId);
  const widgetIds = normalizeWidgetIdList(options.widgetIds ?? options.widgetId);

  if (!spaceId) {
    throw new Error("A target spaceId is required to remove widgets.");
  }

  const currentSpace = cloneSpaceRecord(await readSpace(spaceId));
  const existingWidgetIds = new Set(currentSpace.widgetIds);
  const missingWidgetIds = widgetIds.filter((widgetId) => !existingWidgetIds.has(widgetId));

  if (!widgetIds.length) {
    return {
      space: currentSpace,
      widgetIds: []
    };
  }

  if (missingWidgetIds.length) {
    throw new Error(`Widgets "${missingWidgetIds.join('", "')}" were not found in space "${spaceId}".`);
  }

  const widgetIdSet = new Set(widgetIds);
  currentSpace.widgetIds = currentSpace.widgetIds.filter((entry) => !widgetIdSet.has(entry));
  currentSpace.minimizedWidgetIds = currentSpace.minimizedWidgetIds.filter((entry) => !widgetIdSet.has(entry));
  widgetIds.forEach((widgetId) => {
    delete currentSpace.widgetPositions[widgetId];
    delete currentSpace.widgetSizes[widgetId];
    delete currentSpace.widgets[widgetId];
  });
  currentSpace.updatedAt = new Date().toISOString();

  await runtime.api.fileWrite({
    content: serializeManifest(currentSpace),
    path: buildSpaceManifestPath(spaceId)
  });

  await runtime.api.fileDelete({
    paths: widgetIds.map((widgetId) => buildSpaceWidgetFilePath(spaceId, widgetId))
  });
  await Promise.all(widgetIds.map((widgetId) => deleteAppPathIfExists(buildLegacySpaceWidgetFilePath(spaceId, widgetId))));
  clearRecentListedSpaceRecords();

  return {
    space: currentSpace,
    widgetIds
  };
}
