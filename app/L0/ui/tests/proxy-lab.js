const EXAMPLES = {
  json: {
    label: "Example JSON",
    url: "https://jsonplaceholder.typicode.com/todos/1"
  },
  html: {
    label: "Example HTML",
    url: "https://example.com"
  },
  githubText: {
    label: "GitHub Raw Text",
    url: "https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore"
  },
  redirectImage: {
    label: "Redirecting Image",
    url: "https://picsum.photos/seed/agent-one-runtime/960/540"
  },
  staticImage: {
    label: "Static Image",
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg"
  },
  githubDownload: {
    label: "GitHub File Download",
    url: "https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore",
    filename: "Node.gitignore"
  }
};

const BACKEND_ASSETS = {
  text: {
    label: "App Text Asset",
    url: "/ui/tests/assets/hello.txt"
  },
  json: {
    label: "App JSON Asset",
    url: "/ui/tests/assets/example-data.json"
  },
  image: {
    label: "App SVG Asset",
    url: "/ui/tests/assets/agent-one-grid.svg"
  }
};

const MAX_OUTPUT_LENGTH = 24000;

function truncateOutput(value) {
  if (value.length <= MAX_OUTPUT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_LENGTH)}\n\n...[output truncated]`;
}

function formatHeaders(headers) {
  const pairs = Array.from(headers.entries()).sort(([left], [right]) => left.localeCompare(right));
  return pairs.map(([name, value]) => `${name}: ${value}`).join("\n");
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const text = await response.text();

    try {
      const json = JSON.parse(text);
      return JSON.stringify(json, null, 2);
    } catch (error) {
      return `Invalid JSON response body:\n${text}`;
    }
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("svg")
  ) {
    return await response.text();
  }

  const bytes = await response.arrayBuffer();
  return `[binary response: ${bytes.byteLength} bytes]`;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function getProxyDebugInfo(response) {
  return {
    targetUrl: response.headers.get("x-agent-one-proxy-target-url") || "(not provided)",
    finalUrl: response.headers.get("x-agent-one-proxy-final-url") || response.url,
    redirected: response.headers.get("x-agent-one-proxy-redirected") || "false"
  };
}

async function renderFetchResult(output, targetUrl, runtime) {
  setText(output, `Fetching ${targetUrl}...`);

  const response = await runtime.fetchExternal(targetUrl);
  const body = await readResponseBody(response);
  const proxyDebug = getProxyDebugInfo(response);
  const headerBlock = formatHeaders(response.headers);

  setText(
    output,
    truncateOutput(
      [
        `Requested URL: ${targetUrl}`,
        `Proxy URL: ${runtime.proxy.buildUrl(targetUrl)}`,
        `Proxy Target Header: ${proxyDebug.targetUrl}`,
        `Final URL: ${proxyDebug.finalUrl}`,
        `Redirected: ${proxyDebug.redirected}`,
        `Status: ${response.status} ${response.statusText}`,
        `Headers:\n${headerBlock || "(none)"}`,
        `Body:\n${body}`
      ].join("\n\n")
    )
  );
}

function initializeExampleButtons(runtime, urlField, output) {
  const exampleButtons = document.querySelectorAll("[data-fetch-example]");

  exampleButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const exampleKey = button.getAttribute("data-fetch-example");
      const example = EXAMPLES[exampleKey];

      if (!example) {
        return;
      }

      urlField.value = example.url;

      try {
        await renderFetchResult(output, example.url, runtime);
      } catch (error) {
        setText(output, `Request failed: ${error.message}`);
      }
    });
  });
}

function initializeCustomFetch(runtime, urlField, output) {
  const form = document.querySelector("[data-proxy-fetch-form]");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const targetUrl = urlField.value.trim();
    if (!targetUrl) {
      setText(output, "Enter a URL to test the proxy.");
      return;
    }

    try {
      await renderFetchResult(output, targetUrl, runtime);
    } catch (error) {
      setText(output, `Request failed: ${error.message}`);
    }
  });
}

function initializeImageDemo(runtime) {
  const preview = document.querySelector("[data-image-preview]");
  const status = document.querySelector("[data-image-status]");
  const source = document.querySelector("[data-image-source]");
  const buttons = document.querySelectorAll("[data-image-example]");
  const reloadButton = document.querySelector("[data-image-reload]");

  if (!preview || !status || !source) {
    return;
  }

  let currentImageUrl = EXAMPLES.redirectImage.url;

  function loadImage(targetUrl, options = {}) {
    currentImageUrl = targetUrl;
    const proxyUrl = runtime.proxy.buildUrl(targetUrl, {
      cacheBust: options.cacheBust ? Date.now() : null
    });

    setText(status, `Loading image through ${proxyUrl}`);
    setText(source, `Source: ${targetUrl}`);
    preview.src = proxyUrl;
  }

  preview.addEventListener("load", () => {
    setText(status, `Image loaded successfully through proxy.`);
  });

  preview.addEventListener("error", () => {
    setText(status, "Image failed to load through proxy.");
  });

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const exampleKey = button.getAttribute("data-image-example");
      const example = EXAMPLES[exampleKey];

      if (!example) {
        return;
      }

      loadImage(example.url);
    });
  });

  if (reloadButton) {
    reloadButton.addEventListener("click", () => {
      loadImage(currentImageUrl, { cacheBust: true });
    });
  }

  loadImage(currentImageUrl);
}

function initializeDownloadDemo(runtime) {
  const button = document.querySelector("[data-download-example]");
  const status = document.querySelector("[data-download-status]");

  if (!button || !status) {
    return;
  }

  button.addEventListener("click", async () => {
    setText(status, "Downloading GitHub example file through proxy...");

    try {
      const result = await runtime.download(EXAMPLES.githubDownload.url, {
        filename: EXAMPLES.githubDownload.filename
      });

      setText(status, `Downloaded ${result.filename} (${result.size} bytes, ${result.type}).`);
    } catch (error) {
      setText(status, `Download failed: ${error.message}`);
    }
  });
}

function initializeBackendAssetDemo(runtime) {
  const output = document.querySelector("[data-backend-asset-output]");
  const preview = document.querySelector("[data-backend-asset-preview]");
  const status = document.querySelector("[data-backend-asset-status]");
  const fetchButtons = document.querySelectorAll("[data-backend-asset-fetch]");
  const imageButton = document.querySelector("[data-backend-asset-image]");
  const downloadButton = document.querySelector("[data-backend-asset-download]");

  if (!output || !preview || !status) {
    return;
  }

  preview.src = BACKEND_ASSETS.image.url;

  preview.addEventListener("load", () => {
    setText(status, `Backend asset image loaded from ${BACKEND_ASSETS.image.url}`);
  });

  preview.addEventListener("error", () => {
    setText(status, "Backend asset image failed to load.");
  });

  fetchButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const assetKey = button.getAttribute("data-backend-asset-fetch");
      const asset = BACKEND_ASSETS[assetKey];

      if (!asset) {
        return;
      }

      try {
        await renderFetchResult(output, asset.url, runtime);
      } catch (error) {
        setText(output, `Request failed: ${error.message}`);
      }
    });
  });

  if (imageButton) {
    imageButton.addEventListener("click", () => {
      preview.src = `${BACKEND_ASSETS.image.url}?_=${Date.now()}`;
    });
  }

  if (downloadButton) {
    downloadButton.addEventListener("click", async () => {
      setText(status, "Downloading server text asset...");

      try {
        const response = await fetch(BACKEND_ASSETS.text.url);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "hello.txt";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        setText(status, `Downloaded hello.txt (${blob.size} bytes).`);
      } catch (error) {
        setText(status, `Backend asset download failed: ${error.message}`);
      }
    });
  }
}

function initializeRuntimeStatus(runtime) {
  const runtimeElement = document.querySelector("[data-proxy-runtime]");
  const healthElement = document.querySelector("[data-proxy-health]");

  setText(runtimeElement, `Fetch override installed. Proxy endpoint: ${runtime.proxyPath}`);

  runtime.api
    .health()
    .then((payload) => {
      setText(healthElement, `Server ready: ${payload.name}`);
    })
    .catch((error) => {
      setText(healthElement, `Server health check failed: ${error.message}`);
    });
}

function initializeServerApiDemo(runtime) {
  const pathInput = document.querySelector("[data-server-api-path]");
  const contentInput = document.querySelector("[data-server-api-content]");
  const output = document.querySelector("[data-server-api-output]");
  const buttons = document.querySelectorAll("[data-server-api-action]");

  if (!pathInput || !contentInput || !output || !buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-server-api-action");
      const assetPath = pathInput.value.trim();
      const assetContent = contentInput.value;

      setText(output, `Calling ${action}...`);

      try {
        let result;

        if (action === "asset_get") {
          result = await runtime.api.assetGet(assetPath);
        } else if (action === "asset_set") {
          result = await runtime.api.assetSet(assetPath, assetContent);
        } else {
          result = await runtime.api.call(action);
        }

        setText(output, JSON.stringify(result, null, 2));
      } catch (error) {
        setText(output, `Server API call failed: ${error.message}`);
      }
    });
  });
}

export function initializeProxyLab(runtime) {
  const urlField = document.querySelector("[data-proxy-fetch-url]");
  const output = document.querySelector("[data-proxy-fetch-output]");

  if (!urlField || !output) {
    return;
  }

  urlField.value = EXAMPLES.json.url;

  initializeRuntimeStatus(runtime);
  initializeExampleButtons(runtime, urlField, output);
  initializeCustomFetch(runtime, urlField, output);
  initializeImageDemo(runtime);
  initializeDownloadDemo(runtime);
  initializeBackendAssetDemo(runtime);
  initializeServerApiDemo(runtime);
}
