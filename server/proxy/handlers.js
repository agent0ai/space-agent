const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendFile(res, filePath, options = {}) {
  if (options.knownMissing) {
    sendJson(res, 404, { error: "File not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "File not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length
    });
    res.end(data);
  });
}

function normalizeHeaders(headers) {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return { ...headers };
}

function isWebResponse(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof Response !== "undefined" &&
    value instanceof Response
  );
}

function isHttpResponseShape(value) {
  return (
    value &&
    typeof value === "object" &&
    ("status" in value || "headers" in value || "body" in value || "stream" in value)
  );
}

async function pipeReadableToResponse(res, stream) {
  await new Promise((resolve, reject) => {
    const readable =
      stream && typeof stream.pipe === "function"
        ? stream
        : typeof Readable.fromWeb === "function"
          ? Readable.fromWeb(stream)
          : stream;

    readable.once("error", reject);
    res.once("error", reject);
    res.once("finish", resolve);
    readable.pipe(res);
  });
}

async function sendWebResponse(res, response) {
  res.writeHead(response.status || 200, normalizeHeaders(response.headers));

  if (!response.body) {
    res.end();
    return;
  }

  await pipeReadableToResponse(res, response.body);
}

async function sendHttpResponse(res, response) {
  const status = Number(response.status || 200);
  const headers = normalizeHeaders(response.headers);

  if (response.stream) {
    res.writeHead(status, headers);
    await pipeReadableToResponse(res, response.stream);
    return;
  }

  if (response.body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }

  if (
    typeof response.body === "object" &&
    !Buffer.isBuffer(response.body) &&
    !(response.body instanceof Uint8Array)
  ) {
    const body = JSON.stringify(response.body, null, 2);
    res.writeHead(status, {
      ...headers,
      "Content-Type": headers["Content-Type"] || headers["content-type"] || "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }

  if (Buffer.isBuffer(response.body)) {
    res.writeHead(status, {
      ...headers,
      "Content-Length": response.body.length
    });
    res.end(response.body);
    return;
  }

  if (response.body instanceof Uint8Array) {
    const body = Buffer.from(response.body);
    res.writeHead(status, {
      ...headers,
      "Content-Length": body.length
    });
    res.end(body);
    return;
  }

  const textBody = String(response.body);
  res.writeHead(status, {
    ...headers,
    "Content-Type": headers["Content-Type"] || headers["content-type"] || "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(textBody)
  });
  res.end(textBody);
}

async function sendApiResult(res, result) {
  if (res.writableEnded) {
    return;
  }

  if (result === undefined) {
    res.writeHead(204);
    res.end();
    return;
  }

  if (isWebResponse(result)) {
    await sendWebResponse(res, result);
    return;
  }

  if (isHttpResponseShape(result)) {
    await sendHttpResponse(res, result);
    return;
  }

  sendJson(res, 200, result);
}

module.exports = {
  sendApiResult,
  sendFile,
  sendJson
};
