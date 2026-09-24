import test from "node:test";
import assert from "node:assert/strict";

const JS_EXTENSION_CACHE_AREA = "frontend_extensions_js(extensions)";
const EXTENSION_FAILURE_EVENT = "space:extension-failure";
const EXTENSION_FAILURE_LOG_LIMIT = 25;
const EXTENSION_LOAD_FAILURE_PATH = "(js extension modules)";
const HOOK_PATH_PREFIX = "/mod/user/extension_hook_probe/ext/js";

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.innerHTML = "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  matches() {
    return false;
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createFakeDocument() {
  return {
    addEventListener() {},
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    documentElement: new FakeElement("html"),
    head: new FakeElement("head"),
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    readyState: "loading"
  };
}

function createExtensionFailureRecord(hook, extensionPoint) {
  return {
    path: `${HOOK_PATH_PREFIX}/${extensionPoint}/probe.js`,
    module: {
      default: hook
    }
  };
}

function seedJsExtensionHook(cache, extensionPoint, hook) {
  cache.add(
    JS_EXTENSION_CACHE_AREA,
    JSON.stringify({
      extensionPoint,
      maxLayer: null,
      scope: "js"
    }),
    [createExtensionFailureRecord(hook, extensionPoint)]
  );
}

async function withExtensionFailureEnvironment(run) {
  const original = {
    CustomEvent: globalThis.CustomEvent,
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver,
    consoleError: console.error,
    dispatchEvent: globalThis.dispatchEvent,
    document: globalThis.document,
    fetch: globalThis.fetch,
    location: globalThis.location,
    space: globalThis.space,
    window: globalThis.window
  };

  const consoleErrors = [];
  const dispatchedEvents = [];
  const requests = [];
  let resolveExtensionPaths = () => [];

  globalThis.document = createFakeDocument();
  globalThis.window = globalThis;
  globalThis.location = new URL("http://example.test/");
  globalThis.HTMLElement = FakeElement;
  globalThis.MutationObserver = class {
    disconnect() {}
    observe() {}
  };
  globalThis.dispatchEvent = (event) => {
    dispatchedEvents.push(event);
  };
  globalThis.space = undefined;
  console.error = (...args) => {
    consoleErrors.push(args.map((value) => String(value)).join(" "));
  };
  globalThis.fetch = async (url, options = {}) => {
    const payload =
      options.body === undefined ? null : JSON.parse(String(options.body));
    requests.push({
      payload,
      url: String(url)
    });

    return new Response(
      JSON.stringify({ extensions: resolveExtensionPaths(payload) }),
      {
        headers: {
          "Content-Type": "application/json"
        },
        status: 200
      }
    );
  };

  try {
    const nonce = String(Date.now()) + "-" + String(Math.random());
    const extensions = await import(
      "../app/L0/_all/mod/_core/framework/js/extensions.js?test=" + nonce
    );
    const cache = await import(
      "../app/L0/_all/mod/_core/framework/js/cache.js"
    );
    extensions.clearCache();

    await run({
      cache,
      consoleErrors,
      dispatchedEvents,
      extensions,
      requests,
      setExtensionPaths(resolver) {
        resolveExtensionPaths = resolver;
      },
      wrap(functionName, original) {
        return extensions.extend(
          { url: "http://example.test/mod/_core/example/execution.js" },
          functionName,
          original
        );
      }
    });
  } finally {
    globalThis.CustomEvent = original.CustomEvent;
    globalThis.HTMLElement = original.HTMLElement;
    globalThis.MutationObserver = original.MutationObserver;
    console.error = original.consoleError;
    globalThis.dispatchEvent = original.dispatchEvent;
    globalThis.document = original.document;
    globalThis.fetch = original.fetch;
    globalThis.location = original.location;
    globalThis.space = original.space;
    globalThis.window = original.window;
  }
}

function readExtensionFailures() {
  return globalThis.space?.extensionFailures ?? [];
}

test("a throwing hook on a non-enforcement seam is recorded instead of only logged", async () => {
  await withExtensionFailureEnvironment(async ({
    cache,
    consoleErrors,
    dispatchedEvents,
    wrap
  }) => {
    const extensionPoint = "_core/example/execution.js/someStep";
    const hookPath = `${HOOK_PATH_PREFIX}/${extensionPoint}/start/probe.js`;

    seedJsExtensionHook(cache, `${extensionPoint}/start`, async () => {
      throw new TypeError("probe hook is broken");
    });

    const wrapped = wrap("someStep", async () => "ok");
    const result = await wrapped();

    assert.equal(result, "ok");
    assert.equal(consoleErrors.length, 1);
    assert.match(consoleErrors[0], /Error calling extension: /u);
    assert.match(consoleErrors[0], /probe hook is broken/u);

    const failures = readExtensionFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].extensionPath, hookPath);
    assert.equal(failures[0].extensionPoint, `${extensionPoint}/start`);
    assert.equal(failures[0].message, "TypeError: probe hook is broken");
    assert.equal(typeof failures[0].stack, "string");
    assert.equal(typeof failures[0].at, "string");

    assert.equal(dispatchedEvents.length, 1);
    assert.equal(dispatchedEvents[0].type, EXTENSION_FAILURE_EVENT);
    assert.equal(dispatchedEvents[0].detail.extensionPath, hookPath);
  });
});

test("a throwing hook on an enforcement seam fails the wrapped call through its validation errors", async () => {
  await withExtensionFailureEnvironment(async ({
    cache,
    dispatchedEvents,
    wrap
  }) => {
    const extensionPoint = "_core/example/execution.js/validateBlock";
    const hookPath = `${HOOK_PATH_PREFIX}/${extensionPoint}/end/probe.js`;
    const thrown = new TypeError("validator is broken");

    seedJsExtensionHook(cache, `${extensionPoint}/end`, async () => {
      throw thrown;
    });

    const wrapped = wrap("validateBlock", async () => ({ errors: [] }));
    const validationResult = await wrapped();

    assert.equal(validationResult.errors.length, 1);

    const [failureError] = validationResult.errors;
    assert.equal(failureError.name, "ExtensionHookError");
    assert.equal(failureError.cause, thrown);
    assert.equal(failureError.extensionPath, hookPath);
    assert.equal(failureError.extensionPoint, `${extensionPoint}/end`);
    assert.equal(
      failureError.message,
      `Extension hook failed: ${hookPath} (${extensionPoint}/end) — TypeError: validator is broken`
    );

    const failures = readExtensionFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].extensionPath, hookPath);
    assert.equal(dispatchedEvents.length, 1);
  });
});

test("a throwing hook on an enforcement seam without a validation result rejects the wrapped call", async () => {
  await withExtensionFailureEnvironment(async ({ cache, wrap }) => {
    const extensionPoint = "_core/example/execution.js/validatePlain";

    seedJsExtensionHook(cache, `${extensionPoint}/end`, async () => {
      throw new TypeError("validator is broken");
    });

    const wrapped = wrap("validatePlain", async () => undefined);

    await assert.rejects(
      () => wrapped(),
      (error) => {
        assert.equal(error.name, "ExtensionHookError");
        assert.match(error.message, /validatePlain\/end/u);
        assert.match(error.message, /TypeError: validator is broken/u);
        return true;
      }
    );

    assert.equal(readExtensionFailures().length, 1);
  });
});

test("an unimportable hook module fails an enforcement seam closed", async () => {
  await withExtensionFailureEnvironment(async ({
    setExtensionPaths,
    wrap
  }) => {
    const extensionPoint = "_core/example/execution.js/validateLoaded";
    const missingPath = `${HOOK_PATH_PREFIX}/${extensionPoint}/end/missing.js`;

    setExtensionPaths((payload) =>
      (payload?.patterns ?? []).some((pattern) => pattern.includes("/end/"))
        ? [missingPath]
        : []
    );

    const wrapped = wrap("validateLoaded", async () => ({ errors: [] }));
    const validationResult = await wrapped();

    assert.equal(validationResult.errors.length, 1);

    const [failureError] = validationResult.errors;
    assert.equal(failureError.name, "ExtensionHookError");
    assert.equal(failureError.extensionPath, EXTENSION_LOAD_FAILURE_PATH);
    assert.equal(failureError.extensionPoint, `${extensionPoint}/end`);
    assert.match(
      failureError.message,
      /Extension hook failed: \(js extension modules\) /u
    );

    const failures = readExtensionFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].extensionPath, EXTENSION_LOAD_FAILURE_PATH);
    assert.equal(failures[0].extensionPoint, `${extensionPoint}/end`);
  });
});

test("a passing hook on an enforcement seam leaves the validation result untouched", async () => {
  await withExtensionFailureEnvironment(async ({
    cache,
    consoleErrors,
    dispatchedEvents,
    wrap
  }) => {
    const extensionPoint = "_core/example/execution.js/validateClean";

    seedJsExtensionHook(cache, `${extensionPoint}/end`, async (hookContext) => {
      hookContext.result.errors.push("hook-owned error");
    });

    const wrapped = wrap("validateClean", async () => ({ errors: [] }));
    const validationResult = await wrapped();

    assert.deepEqual(validationResult.errors, ["hook-owned error"]);
    assert.deepEqual(readExtensionFailures(), []);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(dispatchedEvents, []);
  });
});

test("the recorded failure log stays bounded", async () => {
  await withExtensionFailureEnvironment(async ({
    cache,
    dispatchedEvents,
    wrap
  }) => {
    const extensionPoint = "_core/example/execution.js/repeatedStep";

    seedJsExtensionHook(cache, `${extensionPoint}/start`, async () => {
      throw new TypeError("probe hook is broken");
    });

    const wrapped = wrap("repeatedStep", async () => "ok");

    for (let index = 0; index < EXTENSION_FAILURE_LOG_LIMIT + 5; index += 1) {
      await wrapped();
    }

    const failures = readExtensionFailures();
    assert.equal(failures.length, EXTENSION_FAILURE_LOG_LIMIT);
    assert.equal(dispatchedEvents.length, EXTENSION_FAILURE_LOG_LIMIT + 5);
  });
});
