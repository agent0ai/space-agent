function normalizeChatMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const role = typeof message.role === "string" ? message.role.trim() : "";

  if (!["system", "user", "assistant"].includes(role)) {
    return null;
  }

  const normalizedMessage = {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => (part && typeof part === "object" ? { ...part } : part))
      : typeof message.content === "string"
        ? message.content
        : "",
    role
  };

  if (Array.isArray(message.visualData) && message.visualData.length) {
    normalizedMessage.visualData = message.visualData.map((entry) =>
      entry && typeof entry === "object" ? { ...entry } : entry
    );
  }

  return normalizedMessage;
}

function joinMessageContent(left = "", right = "") {
  if (!Array.isArray(left) && !Array.isArray(right)) {
    return [left, right].filter((content) => typeof content === "string" && content.length).join("\n\n");
  }

  const parts = [];

  [left, right].forEach((content) => {
    if (Array.isArray(content)) {
      parts.push(...content);
    } else if (typeof content === "string" && content.length) {
      parts.push({
        text: content,
        type: "text"
      });
    }
  });

  return parts;
}

function joinVisualData(left = [], right = []) {
  const nextVisualData = [];
  const seenIds = new Set();

  [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const id = typeof entry.id === "string" ? entry.id : "";

    if (id && seenIds.has(id)) {
      return;
    }

    if (id) {
      seenIds.add(id);
    }

    nextVisualData.push({ ...entry });
  });

  return nextVisualData;
}

export function mergeConsecutiveChatMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => normalizeChatMessage(message))
    .filter(Boolean)
    .reduce((mergedMessages, message) => {
      const previousMessage = mergedMessages[mergedMessages.length - 1];

      if (
        previousMessage &&
        previousMessage.role === message.role &&
        ["user", "assistant"].includes(message.role)
      ) {
        previousMessage.content = joinMessageContent(previousMessage.content, message.content);
        previousMessage.visualData = joinVisualData(previousMessage.visualData, message.visualData);
        return mergedMessages;
      }

      mergedMessages.push({
        ...message
      });
      return mergedMessages;
    }, []);
}
