export const EXECUTION_SEPARATOR = "_____javascript";

const EXECUTION_CONTEXT_KEY = "__agentOneChatExecutionContext";
const SHARED_STATE_KEY = "__agentOneChatSharedState";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "dir", "table", "assert"];
const INTERNAL_SCOPE_KEYS = new Set(["__agentOneScope", "__agentOneWindow"]);
const WINDOW_ALIAS_KEYS = new Set(["page", "window", "globalThis", "self"]);
const MAX_STRING_LENGTH = 220;
const MAX_COLLECTION_ENTRIES = 8;
const MAX_FORMAT_DEPTH = 2;

function findLineStart(content, index) {
  let lineStart = index;

  while (lineStart > 0 && content[lineStart - 1] !== "\n" && content[lineStart - 1] !== "\r") {
    lineStart -= 1;
  }

  return lineStart;
}

function findLineEnd(content, index) {
  let lineEnd = index;

  while (lineEnd < content.length && content[lineEnd] !== "\n" && content[lineEnd] !== "\r") {
    lineEnd += 1;
  }

  return lineEnd;
}

function isSeparatorLine(content, separatorIndex) {
  const lineStart = findLineStart(content, separatorIndex);
  const lineEnd = findLineEnd(content, separatorIndex + EXECUTION_SEPARATOR.length);

  return (
    !content.slice(lineStart, separatorIndex).trim() &&
    !content.slice(separatorIndex + EXECUTION_SEPARATOR.length, lineEnd).trim()
  );
}

function getCodeStart(content, separatorIndex) {
  let codeStart = findLineEnd(content, separatorIndex + EXECUTION_SEPARATOR.length);

  if (content.startsWith("\r\n", codeStart)) {
    codeStart += 2;
  } else if (content[codeStart] === "\n" || content[codeStart] === "\r") {
    codeStart += 1;
  }

  return codeStart;
}

function findExecutionBlock(content) {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  let searchIndex = 0;

  while (searchIndex < content.length) {
    const separatorIndex = content.indexOf(EXECUTION_SEPARATOR, searchIndex);

    if (separatorIndex === -1) {
      return null;
    }

    if (isSeparatorLine(content, separatorIndex)) {
      const index = findLineStart(content, separatorIndex);
      const codeStart = getCodeStart(content, separatorIndex);

      return {
        code: content.slice(codeStart),
        codeStart,
        index,
        raw: content.slice(index)
      };
    }

    searchIndex = separatorIndex + EXECUTION_SEPARATOR.length;
  }

  return null;
}

export function extractExecuteBlocks(content) {
  const block = findExecutionBlock(content);
  return block ? [block] : [];
}

function createAsyncRunner(code) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(
    "__agentExecution",
    `
      const __agentOneScope = __agentExecution.scope
      const __agentOneWindow = __agentExecution.targetWindow
      return await (async function () {
        with (__agentOneScope) {
${code}
        }
      }).call(__agentOneWindow)
    `
  );
}

function tryCreateAsyncRunner(code) {
  try {
    createAsyncRunner(code);
    return null;
  } catch (error) {
    return error;
  }
}

function normalizeExecutionSource(code) {
  return typeof code === "string" ? code.replace(/\r\n/g, "\n") : "";
}

function isNodeLike(targetWindow, value) {
  return Boolean(targetWindow.Node && value instanceof targetWindow.Node);
}

function isElementLike(targetWindow, value) {
  return Boolean(targetWindow.Element && value instanceof targetWindow.Element);
}

function summarizeElement(element) {
  const tagName = element.tagName ? element.tagName.toLowerCase() : "element";
  const id = element.id ? `#${element.id}` : "";
  const classNames =
    typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).join(".")}`
      : "";

  return `<${tagName}${id}${classNames}>`;
}

function summarizeNode(targetWindow, value) {
  if (isElementLike(targetWindow, value)) {
    return summarizeElement(value);
  }

  if (value.nodeType === targetWindow.Node.TEXT_NODE) {
    return `#text(${JSON.stringify((value.textContent || "").trim())})`;
  }

  return `[Node type=${value.nodeType}]`;
}

function formatString(value) {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH - 3)}...`;
}

function formatEntries(entries, opener, closer, options) {
  const { depth, seen, targetWindow } = options;
  const renderedEntries = entries.slice(0, MAX_COLLECTION_ENTRIES).map(([key, value]) => {
    return `${key}: ${formatExecutionValue(value, {
      depth: depth + 1,
      seen,
      targetWindow
    })}`;
  });

  if (entries.length > MAX_COLLECTION_ENTRIES) {
    renderedEntries.push("...");
  }

  return `${opener}${renderedEntries.join(", ")}${closer}`;
}

function formatArrayLike(values, label, options) {
  const { depth, seen, targetWindow } = options;
  const renderedValues = Array.from(values)
    .slice(0, MAX_COLLECTION_ENTRIES)
    .map((value) =>
      formatExecutionValue(value, {
        depth: depth + 1,
        seen,
        targetWindow
      })
    );

  if (values.length > MAX_COLLECTION_ENTRIES) {
    renderedValues.push("...");
  }

  return `${label}(${values.length}) [${renderedValues.join(", ")}]`;
}

function formatError(error) {
  if (!error) {
    return "";
  }

  return error.stack || `${error.name || "Error"}: ${error.message || String(error)}`;
}

function formatExecutionValue(value, options) {
  const { targetWindow, depth = 0, seen = new WeakSet() } = options;

  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return formatString(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Error) {
    return formatError(value);
  }

  if (value === targetWindow) {
    return `[Window ${targetWindow.location?.href || ""}]`;
  }

  if (targetWindow.Document && value instanceof targetWindow.Document) {
    return `[Document ${value.URL || ""}]`;
  }

  if (targetWindow.Location && value instanceof targetWindow.Location) {
    return `[Location ${value.href || ""}]`;
  }

  if (isNodeLike(targetWindow, value)) {
    return summarizeNode(targetWindow, value);
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_FORMAT_DEPTH) {
      return `Array(${value.length})`;
    }

    return formatArrayLike(value, "Array", {
      depth,
      seen,
      targetWindow
    });
  }

  if (targetWindow.NodeList && value instanceof targetWindow.NodeList) {
    return formatArrayLike(Array.from(value), "NodeList", {
      depth,
      seen,
      targetWindow
    });
  }

  if (targetWindow.HTMLCollection && value instanceof targetWindow.HTMLCollection) {
    return formatArrayLike(Array.from(value), "HTMLCollection", {
      depth,
      seen,
      targetWindow
    });
  }

  if (value instanceof Map) {
    if (depth >= MAX_FORMAT_DEPTH) {
      return `Map(${value.size})`;
    }

    return formatEntries(Array.from(value.entries()), "Map { ", " }", {
      depth,
      seen,
      targetWindow
    });
  }

  if (value instanceof Set) {
    if (depth >= MAX_FORMAT_DEPTH) {
      return `Set(${value.size})`;
    }

    return formatArrayLike(Array.from(value.values()), "Set", {
      depth,
      seen,
      targetWindow
    });
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    if (depth >= MAX_FORMAT_DEPTH) {
      return `[${value.constructor?.name || "Object"}]`;
    }

    return formatEntries(Object.entries(value), "{ ", " }", {
      depth,
      seen,
      targetWindow
    });
  }

  try {
    return String(value);
  } catch (error) {
    return `[Unprintable value: ${error.message}]`;
  }
}

function createConsoleRecorder(methodName, originalMethod, logs, targetWindow) {
  return (...args) => {
    if (methodName === "assert" && args[0]) {
      if (originalMethod) {
        originalMethod(...args);
      }

      return;
    }

    const logArgs = methodName === "assert" ? args.slice(1) : args;
    const text = logArgs.length
      ? logArgs
          .map((value) =>
            formatExecutionValue(value, {
              targetWindow
            })
          )
          .join(" ")
      : "(no output)";

    logs.push({
      level: methodName,
      text
    });

    if (!originalMethod) {
      return;
    }

    try {
      originalMethod(...args);
    } catch (error) {
      // Ignore console implementation edge cases.
    }
  };
}

function patchConsole(targetWindow, logs) {
  if (!targetWindow.console) {
    return () => {};
  }

  const originalMethods = [];

  CONSOLE_METHODS.forEach((methodName) => {
    if (typeof targetWindow.console[methodName] !== "function") {
      return;
    }

    const originalMethod = targetWindow.console[methodName].bind(targetWindow.console);

    try {
      targetWindow.console[methodName] = createConsoleRecorder(methodName, originalMethod, logs, targetWindow);
      originalMethods.push([methodName, originalMethod]);
    } catch (error) {
      // Ignore read-only console implementations.
    }
  });

  return () => {
    originalMethods.forEach(([methodName, originalMethod]) => {
      try {
        targetWindow.console[methodName] = originalMethod;
      } catch (error) {
        // Ignore read-only console implementations.
      }
    });
  };
}

function isConstructable(value) {
  if (typeof value !== "function") {
    return false;
  }

  try {
    Reflect.construct(String, [], value);
    return true;
  } catch (error) {
    return false;
  }
}

function getScopedWindowValue(targetWindow, key, boundWindowMethods) {
  const value = targetWindow[key];

  if (typeof value !== "function" || isConstructable(value)) {
    return value;
  }

  const cachedBoundMethod = boundWindowMethods.get(value);

  if (cachedBoundMethod) {
    return cachedBoundMethod;
  }

  const boundWindowMethod = value.bind(targetWindow);
  boundWindowMethods.set(value, boundWindowMethod);
  return boundWindowMethod;
}

function createExecutionScope(targetWindow, sharedState) {
  const boundWindowMethods = new WeakMap();

  return new Proxy(sharedState, {
    has(_target, key) {
      if (key === Symbol.unscopables) {
        return false;
      }

      return !(typeof key === "string" && INTERNAL_SCOPE_KEYS.has(key));
    },
    get(target, key) {
      if (key === Symbol.unscopables) {
        return undefined;
      }

      if (typeof key !== "string") {
        return Reflect.get(target, key);
      }

      if (WINDOW_ALIAS_KEYS.has(key)) {
        return targetWindow;
      }

      if (key === "document") {
        return targetWindow.document;
      }

      if (key === "console") {
        return targetWindow.console;
      }

      if (key === "A1") {
        return targetWindow.A1;
      }

      if (Reflect.has(target, key)) {
        return Reflect.get(target, key);
      }

      return getScopedWindowValue(targetWindow, key, boundWindowMethods);
    },
    set(target, key, value) {
      if (typeof key !== "string") {
        Reflect.set(target, key, value);
        return true;
      }

      if (key === "A1" || WINDOW_ALIAS_KEYS.has(key) || key === "console" || key === "document") {
        return false;
      }

      if (Reflect.has(target, key)) {
        Reflect.set(target, key, value);
        return true;
      }

      if (key in targetWindow) {
        try {
          targetWindow[key] = value;
          return true;
        } catch (error) {
          // Fall through to shared state when the window property is read-only.
        }
      }

      Reflect.set(target, key, value);
      return true;
    },
    deleteProperty(target, key) {
      if (Reflect.has(target, key)) {
        return Reflect.deleteProperty(target, key);
      }

      return true;
    }
  });
}

function buildSourceUrl(runId) {
  return `agent-one-chat-execute-${runId}.js`;
}

function flattenExecutionMessageValue(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .join("\\n");
}

function formatExecutionResultLines(result) {
  const status = typeof result?.status === "string" && result.status.trim() ? result.status.trim() : "done";
  const lines = [`execution ${status}`];
  const prints = Array.isArray(result?.logs) ? result.logs : [];

  prints.forEach((entry) => {
    const level = typeof entry?.level === "string" && entry.level.trim() ? entry.level.trim() : "log";
    lines.push(`${level}: ${flattenExecutionMessageValue(entry?.text ?? "")}`);
  });

  if (result?.result !== undefined) {
    lines.push(`result: ${flattenExecutionMessageValue(result.resultText)}`);
  }

  if (!result?.error?.text && result?.result === undefined && !prints.length) {
    lines.push("warning: JavaScript finished but returned no result.");
    lines.push("warning: Use top-level return to send the final value back.");
  }

  if (result?.error?.text) {
    lines.push(`error: ${flattenExecutionMessageValue(result.error.text)}`);
  }

  return lines;
}

function createExecutionError(error) {
  return {
    message: error?.message || String(error),
    name: error?.name || "Error",
    stack: error?.stack || "",
    text: formatError(error)
  };
}

function createExecutionOutputSnapshot(result) {
  return {
    outputLines: formatExecutionResultLines(result),
    status: typeof result?.status === "string" && result.status.trim() ? result.status.trim() : "done"
  };
}

export function createExecutionOutputSnapshots(results) {
  if (!Array.isArray(results) || !results.length) {
    return [];
  }

  return results.map((result) => createExecutionOutputSnapshot(result));
}

export function formatExecutionResultsMessage(results) {
  return createExecutionOutputSnapshots(results)
    .map((result) => result.outputLines.join("\n"))
    .join("\n\n")
    .trim();
}

export function createExecutionContext(options = {}) {
  const targetWindow = options.targetWindow || window;
  const existingContext = targetWindow[EXECUTION_CONTEXT_KEY];

  if (existingContext) {
    return existingContext;
  }

  const sharedState = targetWindow[SHARED_STATE_KEY] || Object.create(null);
  targetWindow[SHARED_STATE_KEY] = sharedState;

  const executionContext = {
    runCount: 0,
    sharedState,
    async execute(code) {
      const logs = [];
      const runId = executionContext.runCount + 1;
      const scope = createExecutionScope(targetWindow, sharedState);
      const restoreConsole = patchConsole(targetWindow, logs);
      const normalizedCode = normalizeExecutionSource(code);
      const runnableCode = `${normalizedCode}\n//# sourceURL=${buildSourceUrl(runId)}`;
      const compileError = tryCreateAsyncRunner(runnableCode);

      let result;
      let error = compileError || null;

      executionContext.runCount = runId;

      if (!error) {
        try {
          const runner = createAsyncRunner(runnableCode);
          result = await runner({
            scope,
            targetWindow
          });
        } catch (runError) {
          error = runError;
        }
      }

      restoreConsole();

      return {
        error: error ? createExecutionError(error) : null,
        logs,
        result,
        resultText:
          error || result === undefined
            ? ""
            : formatExecutionValue(result, {
                targetWindow
              }),
        runId,
        status: error ? "error" : "success"
      };
    },
    async executeFromContent(content, options = {}) {
      const blocks = extractExecuteBlocks(content);

      if (!blocks.length) {
        return [];
      }

      const results = [];

      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];

        if (typeof options.onBeforeBlock === "function") {
          await options.onBeforeBlock({
            block,
            code: block.code,
            index,
            total: blocks.length
          });
        }

        results.push({
          ...(await executionContext.execute(block.code)),
          block
        });
      }

      return results;
    },
    reset() {
      Object.keys(sharedState).forEach((key) => {
        delete sharedState[key];
      });

      executionContext.runCount = 0;
    }
  };

  targetWindow[EXECUTION_CONTEXT_KEY] = executionContext;
  return executionContext;
}
