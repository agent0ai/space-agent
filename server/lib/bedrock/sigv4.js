import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVICE = "bedrock";

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data || "", "utf8").digest("hex");
}

function stripInline(value) {
  return String(value || "").replace(/\s*[;#].*$/u, "").trim();
}

function parseIniFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const text = fs.readFileSync(filePath, "utf8");
  const sections = {};
  let current = null;

  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/^\s+/u, "");

    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const sectionMatch = line.match(/^\[(.+?)\]/u);

    if (sectionMatch) {
      current = sectionMatch[1].trim();
      sections[current] = sections[current] || {};
      continue;
    }

    if (!current) {
      continue;
    }

    const eqIdx = line.indexOf("=");

    if (eqIdx === -1) {
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    const value = stripInline(line.slice(eqIdx + 1));

    sections[current][key] = value;
  }

  return sections;
}

function resolveProfileSection(sections, profileName, kind) {
  if (!profileName) {
    return null;
  }

  if (kind === "credentials") {
    return sections[profileName] || null;
  }

  return (
    sections[`profile ${profileName}`] ||
    sections[profileName] ||
    (profileName === "default" ? sections.default : null) ||
    null
  );
}

function splitCredentialProcessArgs(command) {
  const parts = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/gu;
  let match;
  while ((match = regex.exec(command)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }
  return parts;
}

function resolveCredentialProcess(command) {
  const args = splitCredentialProcessArgs(String(command || "").trim());
  if (!args.length) {
    return null;
  }

  const [program, ...rest] = args;
  const stdout = execFileSync(program, rest, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const parsed = JSON.parse(stdout);

  if (!parsed.AccessKeyId || !parsed.SecretAccessKey) {
    throw new Error("credential_process output missing AccessKeyId/SecretAccessKey.");
  }

  return {
    accessKeyId: parsed.AccessKeyId,
    region: null,
    secretAccessKey: parsed.SecretAccessKey,
    sessionToken: parsed.SessionToken || null,
    source: "credential_process"
  };
}

function resolveStaticCredentialsFromProfile(profileName) {
  const home = os.homedir();
  const credsPath = process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(home, ".aws", "credentials");
  const configPath = process.env.AWS_CONFIG_FILE || path.join(home, ".aws", "config");

  const credsSections = parseIniFile(credsPath);
  const configSections = parseIniFile(configPath);

  const credsEntry = resolveProfileSection(credsSections, profileName, "credentials") || {};
  const configEntry = resolveProfileSection(configSections, profileName, "config") || {};

  const accessKeyId = credsEntry.aws_access_key_id || configEntry.aws_access_key_id;
  const secretAccessKey = credsEntry.aws_secret_access_key || configEntry.aws_secret_access_key;
  const sessionToken = credsEntry.aws_session_token || configEntry.aws_session_token;
  const region = configEntry.region || credsEntry.region;

  if (accessKeyId && secretAccessKey) {
    return {
      accessKeyId,
      region: region || null,
      secretAccessKey,
      sessionToken: sessionToken || null,
      source: "shared-ini"
    };
  }

  const credentialProcess = credsEntry.credential_process || configEntry.credential_process;
  if (credentialProcess) {
    const resolved = resolveCredentialProcess(credentialProcess);
    if (resolved) {
      return { ...resolved, region: region || null };
    }
  }

  return null;
}

export async function resolveBedrockCredentials(profileName) {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || null,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN || null,
      source: "env"
    };
  }

  const profile = profileName || process.env.AWS_PROFILE || "default";
  const credentials = resolveStaticCredentialsFromProfile(profile);

  if (!credentials) {
    throw new Error(
      `Unable to load AWS credentials for profile "${profile}". ` +
        "Set SPACE_BEDROCK_API_KEY, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or populate ~/.aws/credentials."
    );
  }

  return credentials;
}

function canonicalHeaders(headers) {
  const lowered = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/gu, " ")])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));

  const canonical = lowered.map(([name, value]) => `${name}:${value}\n`).join("");
  const signed = lowered.map(([name]) => name).join(";");

  return { canonical, signed };
}

function canonicalQueryString(url) {
  const params = [];
  url.searchParams.forEach((value, key) => {
    params.push([encodeURIComponent(key), encodeURIComponent(value)]);
  });
  params.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return params.map(([key, value]) => `${key}=${value}`).join("&");
}

export function signBedrockRequest({ body, credentials, headers, method, region, url }) {
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/gu, "")
    .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const parsed = url instanceof URL ? url : new URL(url);
  const bodyBuffer = body instanceof Buffer ? body : Buffer.from(body ?? "", "utf8");
  const payloadHash = sha256Hex(bodyBuffer);

  const workingHeaders = { ...headers };
  workingHeaders.host = parsed.host;
  workingHeaders["x-amz-date"] = amzDate;
  workingHeaders["x-amz-content-sha256"] = payloadHash;

  if (credentials.sessionToken) {
    workingHeaders["x-amz-security-token"] = credentials.sessionToken;
  }

  const { canonical, signed } = canonicalHeaders(workingHeaders);
  const canonicalRequest = [
    method.toUpperCase(),
    parsed.pathname || "/",
    canonicalQueryString(parsed),
    canonical,
    signed,
    payloadHash
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  workingHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signed}, Signature=${signature}`;

  return { body: bodyBuffer, headers: workingHeaders };
}
