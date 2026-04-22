import { Readable } from "node:stream";

import { handleConverseOpenAiRequest } from "./converse.js";
import { resolveBedrockCredentials, signBedrockRequest } from "./sigv4.js";

const DEFAULT_REGION = "us-east-1";

function readBedrockConfig() {
  const mode = (process.env.SPACE_BEDROCK_MODE || "").toLowerCase();
  const apiKey = (process.env.SPACE_BEDROCK_API_KEY || "").trim();
  const profile = (process.env.SPACE_BEDROCK_AWS_PROFILE || process.env.AWS_PROFILE || "").trim();
  const region =
    (process.env.SPACE_BEDROCK_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || DEFAULT_REGION).trim();

  const resolvedMode = mode || (apiKey ? "apikey" : "sigv4");

  return { apiKey, mode: resolvedMode, profile, region };
}

function readIncomingBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function buildUpstreamUrl(region, subPath) {
  const trimmed = (subPath || "").replace(/^\/+/u, "");
  const pathSegment = trimmed ? `/${trimmed}` : "/openai/v1/chat/completions";
  return new URL(`https://bedrock-runtime.${region}.amazonaws.com${pathSegment}`);
}

function sendJsonError(res, status, message, extra = {}) {
  const body = JSON.stringify({ error: { message, ...extra } });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function filterUpstreamHeaders(upstreamHeaders) {
  const out = {};
  upstreamHeaders.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === "content-encoding" || lower === "content-length" || lower === "transfer-encoding" || lower === "connection") {
      return;
    }
    out[name] = value;
  });
  return out;
}

async function forwardResponse(res, upstream) {
  res.writeHead(upstream.status, filterUpstreamHeaders(upstream.headers));

  if (!upstream.body) {
    res.end();
    return;
  }

  await new Promise((resolve, reject) => {
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on("error", reject);
    res.on("error", reject);
    res.on("close", resolve);
    res.on("finish", resolve);
    nodeStream.pipe(res);
  });
}

export async function handleBedrockRequest(req, res, requestUrl) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "GET" && requestUrl.pathname === "/api/bedrock/config") {
    const cfg = readBedrockConfig();
    const body = JSON.stringify({
      mode: cfg.mode,
      profile: cfg.mode === "sigv4" ? cfg.profile || "default" : null,
      region: cfg.region,
      hasApiKey: Boolean(cfg.apiKey)
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(body);
    return;
  }

  if (method !== "POST") {
    sendJsonError(res, 405, `Method ${method} is not supported for ${requestUrl.pathname}`);
    return;
  }

  const config = readBedrockConfig();
  const subPath = requestUrl.pathname.replace(/^\/api\/bedrock/u, "");
  const rawBody = await readIncomingBody(req);

  if (/^\/converse\/v1\/chat\/completions\/?$/u.test(subPath)) {
    try {
      const openaiPayload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
      await handleConverseOpenAiRequest(req, res, { openaiPayload, region: config.region });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJsonError(res, 500, `Bedrock converse error: ${message}`);
    }
    return;
  }

  const upstreamUrl = buildUpstreamUrl(config.region, subPath);

  const outgoingHeaders = {
    "content-type": req.headers["content-type"] || "application/json",
    accept: req.headers.accept || "application/json, text/event-stream"
  };

  const rawClientAuth = req.headers["authorization"] || req.headers["Authorization"] || "";
  const clientBearer =
    typeof rawClientAuth === "string" && rawClientAuth.toLowerCase().startsWith("bearer ")
      ? rawClientAuth.slice(7).trim()
      : "";
  const clientProvidedRealKey = clientBearer && clientBearer.toLowerCase() !== "local";

  try {
    let finalHeaders = outgoingHeaders;
    let finalBody = rawBody;

    if (clientProvidedRealKey && /^\/openai\//u.test(subPath)) {
      finalHeaders.authorization = `Bearer ${clientBearer}`;
    } else if (config.mode === "apikey") {
      if (!config.apiKey) {
        sendJsonError(res, 500, "SPACE_BEDROCK_API_KEY is not configured.");
        return;
      }
      finalHeaders.authorization = `Bearer ${config.apiKey}`;
    } else {
      const credentials = await resolveBedrockCredentials(config.profile);
      const signed = signBedrockRequest({
        body: rawBody,
        credentials,
        headers: outgoingHeaders,
        method: "POST",
        region: config.region,
        url: upstreamUrl
      });
      finalHeaders = signed.headers;
      finalBody = signed.body;
    }

    const upstream = await fetch(upstreamUrl, {
      body: finalBody,
      headers: finalHeaders,
      method: "POST"
    });

    await forwardResponse(res, upstream);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJsonError(res, 500, `Bedrock proxy error: ${message}`);
  }
}
