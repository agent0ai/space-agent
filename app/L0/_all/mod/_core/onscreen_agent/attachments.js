import {
  formatVisualDataDimensions,
  normalizeVisualDataList,
  serializeVisualDataList
} from "/mod/_core/agent-chat/visual-data.js";

const ATTACHMENT_ID_PREFIX = "attachment";
const DEFAULT_ATTACHMENT_TYPE = "application/octet-stream";
export const MESSAGE_PROMPT_PART_BLOCK = Object.freeze({
  ASSISTANT: "assistant",
  FRAMEWORK: "framework",
  USER: "user"
});

function createAttachmentId() {
  return `${ATTACHMENT_ID_PREFIX}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeAttachmentName(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return normalizedValue || "Attachment";
}

function normalizeAttachmentType(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return normalizedValue || DEFAULT_ATTACHMENT_TYPE;
}

function normalizeAttachmentSize(value) {
  const size = Number(value);

  if (!Number.isFinite(size) || size < 0) {
    return 0;
  }

  return Math.round(size);
}

function normalizeAttachmentLastModified(value) {
  const timestamp = Number(value);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  return Math.round(timestamp);
}

function readFileAsDataUrl(file) {
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
      reject(reader.error || new Error("Unable to read attachment as a data URL."));
    };

    reader.readAsDataURL(file);
  });
}

function createAttachmentHandle(messageId, attachment) {
  return {
    available: true,
    file: attachment.file,
    id: attachment.id,
    lastModified: attachment.lastModified,
    messageId,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    async arrayBuffer() {
      return attachment.file.arrayBuffer();
    },
    async dataUrl() {
      return readFileAsDataUrl(attachment.file);
    },
    async json() {
      return JSON.parse(await attachment.file.text());
    },
    async text() {
      return attachment.file.text();
    },
    toJSON() {
      return serializeAttachmentMetadata(attachment);
    }
  };
}

function findAttachmentMatch(attachmentsByMessageId, attachmentId) {
  for (const [messageId, attachments] of attachmentsByMessageId.entries()) {
    const attachment = attachments.find((entry) => entry.id === attachmentId);

    if (attachment) {
      return {
        attachment,
        messageId
      };
    }
  }

  return null;
}

function buildAttachmentListLines(attachments) {
  return attachments.map((attachment) => {
    const status = attachment.available ? "available now in browser JavaScript" : "unavailable after page reload";
    return `- ${attachment.id} | name: ${JSON.stringify(attachment.name)} | type: ${attachment.type} | size: ${formatAttachmentSize(attachment.size)} | status: ${status}`;
  });
}

function buildAttachmentListBlock(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) {
    return "";
  }

  return ["Attachments↓", ...buildAttachmentListLines(attachments)].join("\n");
}

function buildVisualDataListLines(visualData) {
  return normalizeVisualDataList(visualData).map((entry) => {
    const dimensions = formatVisualDataDimensions(entry);
    const source = entry.source ? ` | source: ${entry.source}` : "";
    return `- ${entry.id} | name: ${JSON.stringify(entry.name)} | type: ${entry.mediaType}${dimensions ? ` | dimensions: ${dimensions}` : ""}${source}`;
  });
}

function buildVisualDataListBlock(visualData) {
  const lines = buildVisualDataListLines(visualData);

  if (!lines.length) {
    return "";
  }

  return ["Visual data↓", ...lines].join("\n");
}

function buildChatRuntimeAccessBlock(messageId, attachments, visualData) {
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const hasVisualData = normalizeVisualDataList(visualData).length > 0;

  if (!hasAttachments && !hasVisualData) {
    return "";
  }

  const availabilityNote = hasAttachments && attachments.some((attachment) => !attachment.available)
    ? "Some files listed below are metadata-only because the page was reloaded. Those bytes are no longer readable in JavaScript."
    : hasAttachments
      ? "These files are live in the browser runtime for this message."
      : "";
  const attachmentLines = hasAttachments
    ? [
        availabilityNote,
        "Read live attachments with `space.chat.attachments.current()`, `space.chat.attachments.forMessage(\"" +
          messageId +
          "\")`, or `space.chat.attachments.get(\"<attachment-id>\")`.",
        "Each attachment object exposes `id`, `messageId`, `name`, `type`, `size`, `lastModified`, `file`, and async methods `text()`, `json()`, `arrayBuffer()`, `dataUrl()`."
      ]
    : [];
  const visualLines = [
    "Read visual data with `space.chat.visual.current()`, `space.chat.visual.forMessage(\"" +
      messageId +
      "\")`, or `space.chat.visual.get(\"<visual-id>\")`.",
    "Load image data into model context with `await space.chat.visual.loadImage(dataUrlOrBlobOrFile, { name })` or `await space.chat.visual.loadAttachment(\"<attachment-id>\")`."
  ];

  return [
    "Chat runtime access↓",
    "The current thread is available in JavaScript as `space.chat`.",
    "Read current messages with `space.chat.messages`.",
    ...attachmentLines,
    ...visualLines
  ].join("\n");
}

export function formatAttachmentSize(bytes) {
  const normalizedBytes = normalizeAttachmentSize(bytes);

  if (normalizedBytes < 1024) {
    return `${normalizedBytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = normalizedBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const roundedValue = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${roundedValue} ${units[unitIndex]}`;
}

export function isAttachmentLive(attachment) {
  return Boolean(
    attachment &&
      attachment.available !== false &&
      attachment.file &&
      typeof attachment.file.text === "function" &&
      typeof attachment.file.arrayBuffer === "function"
  );
}

export function createDraftAttachments(files) {
  return Array.from(files || [])
    .map((file) => {
      if (!file || typeof file.name !== "string") {
        return null;
      }

      return {
        available: true,
        file,
        id: createAttachmentId(),
        lastModified: normalizeAttachmentLastModified(file.lastModified),
        name: normalizeAttachmentName(file.name),
        size: normalizeAttachmentSize(file.size),
        type: normalizeAttachmentType(file.type)
      };
    })
    .filter(Boolean);
}

export function serializeAttachmentMetadata(attachment) {
  return {
    available: isAttachmentLive(attachment),
    id: typeof attachment?.id === "string" && attachment.id ? attachment.id : createAttachmentId(),
    lastModified: normalizeAttachmentLastModified(attachment?.lastModified),
    name: normalizeAttachmentName(attachment?.name),
    size: normalizeAttachmentSize(attachment?.size),
    type: normalizeAttachmentType(attachment?.type)
  };
}

export function normalizeStoredAttachment(attachment) {
  return {
    // Stored history only keeps metadata, so browser bytes are never live after reload.
    available: false,
    id: typeof attachment?.id === "string" && attachment.id ? attachment.id : createAttachmentId(),
    lastModified: normalizeAttachmentLastModified(attachment?.lastModified),
    name: normalizeAttachmentName(attachment?.name),
    size: normalizeAttachmentSize(attachment?.size),
    type: normalizeAttachmentType(attachment?.type)
  };
}

export function buildMessagePromptParts(message) {
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments.map((attachment) => serializeAttachmentMetadata(attachment))
    : [];
  const visualData = serializeVisualDataList(message?.visualData);
  const isFrameworkMessage = Boolean(typeof message?.kind === "string" ? message.kind.trim() : "");

  if (message?.role === "assistant") {
    return content
      ? [{
          blockType: MESSAGE_PROMPT_PART_BLOCK.ASSISTANT,
          content
        }]
      : [];
  }

  if (message?.role !== "user") {
    return [];
  }

  if (isFrameworkMessage || (!attachments.length && !visualData.length)) {
    const frameworkContent = [content, buildVisualDataListBlock(visualData)].filter(Boolean).join("\n\n");

    return frameworkContent || visualData.length
      ? [{
          blockType: isFrameworkMessage ? MESSAGE_PROMPT_PART_BLOCK.FRAMEWORK : MESSAGE_PROMPT_PART_BLOCK.USER,
          content: frameworkContent,
          visualData
        }]
      : [];
  }

  const attachmentListBlock = buildAttachmentListBlock(attachments);
  const visualDataListBlock = buildVisualDataListBlock(visualData);
  const messageId = typeof message.id === "string" ? message.id : "current-user-message";
  const runtimeAccessBlock = buildChatRuntimeAccessBlock(messageId, attachments, visualData);
  const userContent = [content, attachmentListBlock, visualDataListBlock].filter(Boolean).join("\n\n");

  return [
    userContent
      ? {
          blockType: MESSAGE_PROMPT_PART_BLOCK.USER,
          content: userContent,
          visualData
        }
      : null,
    runtimeAccessBlock
      ? {
          blockType: MESSAGE_PROMPT_PART_BLOCK.FRAMEWORK,
          content: runtimeAccessBlock
        }
      : null
  ].filter(Boolean);
}

export function buildMessageContentForApi(message) {
  return buildMessagePromptParts(message)
    .map((part) => part.content)
    .filter(Boolean)
    .join("\n\n");
}

export function createAttachmentRuntime() {
  const attachmentsByMessageId = new Map();
  let activeMessageId = "";

  const runtime = {
    clear() {
      attachmentsByMessageId.clear();
      activeMessageId = "";
    },
    current() {
      return runtime.forMessage(activeMessageId);
    },
    forMessage(messageId) {
      if (typeof messageId !== "string" || !messageId || !attachmentsByMessageId.has(messageId)) {
        return [];
      }

      return attachmentsByMessageId.get(messageId).map((attachment) => createAttachmentHandle(messageId, attachment));
    },
    forgetMessage(messageId) {
      attachmentsByMessageId.delete(messageId);

      if (activeMessageId === messageId) {
        activeMessageId = "";
      }
    },
    get(attachmentId) {
      if (typeof attachmentId !== "string" || !attachmentId) {
        return null;
      }

      const match = findAttachmentMatch(attachmentsByMessageId, attachmentId);

      if (!match) {
        return null;
      }

      return createAttachmentHandle(match.messageId, match.attachment);
    },
    async json(attachmentId) {
      const attachment = runtime.get(attachmentId);

      if (!attachment) {
        throw new Error(`Attachment not found: ${attachmentId}`);
      }

      return attachment.json();
    },
    list() {
      return runtime.current();
    },
    all() {
      return Array.from(attachmentsByMessageId.entries()).flatMap(([messageId, attachments]) =>
        attachments.map((attachment) => createAttachmentHandle(messageId, attachment))
      );
    },
    rememberMessageAttachments(messageId, attachments = []) {
      if (typeof messageId !== "string" || !messageId) {
        return [];
      }

      const liveAttachments = Array.isArray(attachments)
        ? attachments.filter((attachment) => isAttachmentLive(attachment))
        : [];

      if (!liveAttachments.length) {
        attachmentsByMessageId.delete(messageId);
        return [];
      }

      attachmentsByMessageId.set(messageId, liveAttachments);
      return runtime.forMessage(messageId);
    },
    setActiveMessage(messageId) {
      activeMessageId = typeof messageId === "string" && attachmentsByMessageId.has(messageId) ? messageId : "";
      return runtime.current();
    },
    async text(attachmentId) {
      const attachment = runtime.get(attachmentId);

      if (!attachment) {
        throw new Error(`Attachment not found: ${attachmentId}`);
      }

      return attachment.text();
    }
  };

  runtime.arrayBuffer = async (attachmentId) => {
    const attachment = runtime.get(attachmentId);

    if (!attachment) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    return attachment.arrayBuffer();
  };

  runtime.dataUrl = async (attachmentId) => {
    const attachment = runtime.get(attachmentId);

    if (!attachment) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    return attachment.dataUrl();
  };

  Object.defineProperty(runtime, "activeMessageId", {
    get() {
      return activeMessageId;
    }
  });

  return runtime;
}
