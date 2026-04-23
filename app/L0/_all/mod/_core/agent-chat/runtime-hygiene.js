import { normalizeAssistantEvaluationLogEntry } from "./assistant-message-evaluation.js";

function cloneConversationAttachments(attachments) {
  return Array.isArray(attachments) ? attachments.map((attachment) => ({ ...attachment })) : [];
}

export function cloneConversationMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  return {
    ...message,
    attachments: cloneConversationAttachments(message.attachments)
  };
}

export function applyConversationMessage(targetMessage, nextMessage) {
  if (!targetMessage || !nextMessage || targetMessage === nextMessage) {
    return targetMessage;
  }

  Object.assign(targetMessage, nextMessage);
  targetMessage.attachments = cloneConversationAttachments(nextMessage.attachments);
  return targetMessage;
}

export function normalizeAssistantEvaluation(context = {}) {
  return {
    assistantContent: typeof context?.assistantContent === "string" ? context.assistantContent : "",
    history: Array.isArray(context?.history)
      ? context.history.map((message) => cloneConversationMessage(message)).filter(Boolean)
      : [],
    logs: Array.isArray(context?.logs)
      ? context.logs.map((entry) => normalizeAssistantEvaluationLogEntry(entry)).filter(Boolean)
      : [],
    messageId: typeof context?.messageId === "string" ? context.messageId : "",
    store: context?.store || null
  };
}

export async function resolveProcessedConversationMessage(options = {}) {
  const fallbackMessage = cloneConversationMessage(options.message);
  const processMessage = typeof options.processMessage === "function" ? options.processMessage : async (context) => context;
  const processedContext = await processMessage({
    ...options,
    history: Array.isArray(options.history)
      ? options.history.map((message) => cloneConversationMessage(message)).filter(Boolean)
      : [],
    message: fallbackMessage
  });
  const processedMessage =
    processedContext && typeof processedContext === "object" ? processedContext.message : fallbackMessage;

  return cloneConversationMessage(processedMessage) || fallbackMessage;
}

export async function createProcessedConversationMessage(options = {}) {
  const createMessage =
    typeof options.createMessage === "function"
      ? options.createMessage
      : (role, content, messageOptions = {}) => ({
          ...messageOptions,
          content,
          role
        });

  return resolveProcessedConversationMessage({
    ...(options.context && typeof options.context === "object" && !Array.isArray(options.context)
      ? options.context
      : {}),
    history: Array.isArray(options.context?.history) ? options.context.history : [],
    message: createMessage(options.role, options.content, options.options),
    processMessage: options.processMessage
  });
}
