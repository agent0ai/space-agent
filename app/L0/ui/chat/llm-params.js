function createYamlError(message, lineNumber) {
  return new Error(lineNumber ? `Invalid LLM params YAML on line ${lineNumber}: ${message}` : message);
}

function getLeadingWhitespace(value) {
  const match = String(value || "").match(/^\s*/);
  return match ? match[0] : "";
}

function createSourceLines(sourceText) {
  return String(sourceText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((rawLine, index) => {
      const lineNumber = index + 1;
      const leadingWhitespace = getLeadingWhitespace(rawLine);

      if (leadingWhitespace.includes("\t")) {
        throw createYamlError("tabs are not supported; use spaces for indentation", lineNumber);
      }

      const content = rawLine.slice(leadingWhitespace.length);
      const trimmedContent = content.trim();

      if (!trimmedContent || trimmedContent.startsWith("#")) {
        return [];
      }

      return [
        {
          content,
          indent: leadingWhitespace.length,
          lineNumber
        }
      ];
    });
}

function withTopLevelTracking(text, onCharacter) {
  let quote = "";
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const previousCharacter = text[index - 1] || "";

    if (quote) {
      if (character === quote && previousCharacter !== "\\") {
        quote = "";
      }

      onCharacter({
        character,
        depth,
        inQuote: true,
        index
      });
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      onCharacter({
        character,
        depth,
        inQuote: true,
        index
      });
      continue;
    }

    if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth = Math.max(depth - 1, 0);
    }

    onCharacter({
      character,
      depth,
      inQuote: false,
      index
    });
  }
}

function findTopLevelColon(text) {
  let separatorIndex = -1;

  withTopLevelTracking(text, ({ character, depth, inQuote, index }) => {
    if (separatorIndex !== -1 || inQuote || depth !== 0 || character !== ":") {
      return;
    }

    separatorIndex = index;
  });

  return separatorIndex;
}

function splitTopLevel(text, separator, lineNumber) {
  const parts = [];
  let partStart = 0;

  withTopLevelTracking(text, ({ character, depth, inQuote, index }) => {
    if (inQuote || depth !== 0 || character !== separator) {
      return;
    }

    parts.push(text.slice(partStart, index).trim());
    partStart = index + 1;
  });

  const trailingPart = text.slice(partStart).trim();

  if (trailingPart) {
    parts.push(trailingPart);
  }

  if (!parts.length && text.trim()) {
    parts.push(text.trim());
  }

  if (parts.some((part) => !part)) {
    throw createYamlError(`unexpected "${separator}" separator`, lineNumber);
  }

  return parts;
}

function parseQuotedString(value, lineNumber) {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw createYamlError("invalid double-quoted string", lineNumber);
    }
  }

  if (!value.endsWith("'")) {
    throw createYamlError("invalid single-quoted string", lineNumber);
  }

  return value.slice(1, -1).replace(/''/g, "'");
}

function normalizeObjectKey(keyText, lineNumber) {
  const normalizedKey = keyText.trim();

  if (!normalizedKey) {
    throw createYamlError("missing key before ':'", lineNumber);
  }

  if (
    (normalizedKey.startsWith('"') && normalizedKey.endsWith('"')) ||
    (normalizedKey.startsWith("'") && normalizedKey.endsWith("'"))
  ) {
    return parseQuotedString(normalizedKey, lineNumber);
  }

  return normalizedKey;
}

function parseInlineArray(value, lineNumber, parseValue) {
  const inner = value.slice(1, -1).trim();

  if (!inner) {
    return [];
  }

  return splitTopLevel(inner, ",", lineNumber).map((part) => parseValue(part, lineNumber));
}

function parseInlineObject(value, lineNumber, parseValue) {
  const inner = value.slice(1, -1).trim();

  if (!inner) {
    return {};
  }

  return splitTopLevel(inner, ",", lineNumber).reduce((result, entry) => {
    const separatorIndex = findTopLevelColon(entry);

    if (separatorIndex === -1) {
      throw createYamlError("inline objects must use key: value pairs", lineNumber);
    }

    const key = normalizeObjectKey(entry.slice(0, separatorIndex), lineNumber);
    const rawValue = entry.slice(separatorIndex + 1).trim();
    result[key] = parseValue(rawValue, lineNumber);
    return result;
  }, {});
}

function createValueParser() {
  function parseValue(rawValue, lineNumber) {
    const value = String(rawValue || "").trim();

    if (!value.length) {
      return null;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return parseQuotedString(value, lineNumber);
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      return parseInlineArray(value, lineNumber, parseValue);
    }

    if (value.startsWith("{") && value.endsWith("}")) {
      return parseInlineObject(value, lineNumber, parseValue);
    }

    if (/^(?:true|false)$/i.test(value)) {
      return value.toLowerCase() === "true";
    }

    if (/^(?:null|~)$/i.test(value)) {
      return null;
    }

    if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) {
      return Number(value);
    }

    return value;
  }

  return parseValue;
}

function createBlockParser(lines) {
  const parseValue = createValueParser();

  function parseBlock(index, indent) {
    const currentLine = lines[index];

    if (!currentLine) {
      return {
        kind: "map",
        nextIndex: index,
        value: {}
      };
    }

    if (currentLine.content === "-" || currentLine.content.startsWith("- ")) {
      return parseList(index, indent);
    }

    return parseMap(index, indent);
  }

  function parseMap(index, indent) {
    const result = {};

    while (index < lines.length) {
      const line = lines[index];

      if (line.indent < indent) {
        break;
      }

      if (line.indent > indent) {
        throw createYamlError("unexpected indentation", line.lineNumber);
      }

      if (line.content === "-" || line.content.startsWith("- ")) {
        throw createYamlError("list item found where a key: value pair was expected", line.lineNumber);
      }

      const separatorIndex = findTopLevelColon(line.content);

      if (separatorIndex === -1) {
        throw createYamlError("expected a key: value pair", line.lineNumber);
      }

      const key = normalizeObjectKey(line.content.slice(0, separatorIndex), line.lineNumber);
      const rawValue = line.content.slice(separatorIndex + 1).trim();
      index += 1;

      if (rawValue) {
        result[key] = parseValue(rawValue, line.lineNumber);
        continue;
      }

      if (index < lines.length && lines[index].indent > indent) {
        const nested = parseBlock(index, lines[index].indent);
        result[key] = nested.value;
        index = nested.nextIndex;
        continue;
      }

      result[key] = null;
    }

    return {
      kind: "map",
      nextIndex: index,
      value: result
    };
  }

  function parseList(index, indent) {
    const result = [];

    while (index < lines.length) {
      const line = lines[index];

      if (line.indent < indent) {
        break;
      }

      if (line.indent > indent) {
        throw createYamlError("unexpected indentation", line.lineNumber);
      }

      if (!(line.content === "-" || line.content.startsWith("- "))) {
        throw createYamlError("expected a list item beginning with '- '", line.lineNumber);
      }

      const rawValue = line.content === "-" ? "" : line.content.slice(1).trimStart();
      index += 1;

      if (rawValue) {
        result.push(parseValue(rawValue, line.lineNumber));
        continue;
      }

      if (index < lines.length && lines[index].indent > indent) {
        const nested = parseBlock(index, lines[index].indent);
        result.push(nested.value);
        index = nested.nextIndex;
        continue;
      }

      result.push(null);
    }

    return {
      kind: "list",
      nextIndex: index,
      value: result
    };
  }

  return parseBlock;
}

export function parseLlmParamsText(sourceText) {
  const lines = createSourceLines(sourceText);

  if (!lines.length) {
    return {};
  }

  const parseBlock = createBlockParser(lines);
  const parsed = parseBlock(0, lines[0].indent);

  if (parsed.kind !== "map" || !parsed.value || Array.isArray(parsed.value)) {
    throw createYamlError("LLM params must be YAML key: value pairs");
  }

  if (parsed.nextIndex !== lines.length) {
    throw createYamlError("unexpected extra content", lines[parsed.nextIndex]?.lineNumber);
  }

  return parsed.value;
}
