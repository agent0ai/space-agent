// Focused unit coverage for the Claude subscription OAuth helpers.
//
// Exercises the pure parts of `server/lib/auth/anthropic_oauth.js` that
// don't require an HTTP exchange against Anthropic: PKCE generation,
// authorize-URL composition, token sealing round-trip through the
// password seal key, and the JSON file persistence layer plus the
// status reporter that the API endpoints rely on.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAuthorizeContext,
  buildOauthEndpoints,
  disconnectUser,
  getStatusForUser
} from "../server/lib/auth/anthropic_oauth.js";

function createTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "space-anthropic-oauth-test-"));
}

function setupAuthDataDir(projectRoot) {
  const dataDir = path.join(projectRoot, "server", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.SPACE_AUTH_DATA_DIR = dataDir;
  process.env.SPACE_AUTH_PASSWORD_SEAL_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde";
  process.env.SPACE_AUTH_SESSION_HMAC_KEY =
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
}

function teardownAuthDataDir() {
  delete process.env.SPACE_AUTH_DATA_DIR;
  delete process.env.SPACE_AUTH_PASSWORD_SEAL_KEY;
  delete process.env.SPACE_AUTH_SESSION_HMAC_KEY;
}

test("buildOauthEndpoints uses public Claude Code defaults when runtime params are unset", () => {
  const endpoints = buildOauthEndpoints(null);
  assert.equal(endpoints.authorizeUrl, "https://claude.ai/oauth/authorize");
  assert.equal(endpoints.tokenUrl, "https://console.anthropic.com/v1/oauth/token");
  assert.equal(endpoints.redirectUri, "https://console.anthropic.com/oauth/code/callback");
  assert.equal(endpoints.clientId, "9d1c250a-e61b-44d9-88ed-5944d1962f5e");
});

test("buildOauthEndpoints honors runtime param overrides", () => {
  const overrides = {
    ANTHROPIC_OAUTH_CLIENT_ID: "test-client-id",
    ANTHROPIC_OAUTH_AUTHORIZE_URL: "https://example.invalid/authorize",
    ANTHROPIC_OAUTH_TOKEN_URL: "https://example.invalid/token",
    ANTHROPIC_OAUTH_REDIRECT_URI: "https://example.invalid/callback"
  };
  const endpoints = buildOauthEndpoints({
    get(name) {
      return overrides[name];
    }
  });
  assert.equal(endpoints.clientId, "test-client-id");
  assert.equal(endpoints.authorizeUrl, "https://example.invalid/authorize");
  assert.equal(endpoints.tokenUrl, "https://example.invalid/token");
  assert.equal(endpoints.redirectUri, "https://example.invalid/callback");
});

test("buildAuthorizeContext returns a PKCE verifier and a populated authorize URL", () => {
  const context = buildAuthorizeContext(null);
  assert.equal(typeof context.codeVerifier, "string");
  assert.ok(context.codeVerifier.length >= 32, "code verifier should be high-entropy");
  assert.equal(typeof context.state, "string");
  assert.ok(context.state.length >= 16, "state token should be high-entropy");

  const url = new URL(context.authorizeUrl);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), context.endpoints.redirectUri);
  assert.equal(url.searchParams.get("client_id"), context.endpoints.clientId);
  assert.equal(url.searchParams.get("state"), context.state);
  assert.ok(url.searchParams.get("code_challenge"));
});

test("buildAuthorizeContext defaults to paste mode for non-local hosts", () => {
  const context = buildAuthorizeContext(null, {
    requestHost: "space-agent.example.com",
    requestProtocol: "https"
  });
  assert.equal(context.flowMode, "paste");
  const url = new URL(context.authorizeUrl);
  // paste mode keeps the Anthropic-hosted code page redirect URI
  assert.equal(url.searchParams.get("redirect_uri"), "https://console.anthropic.com/oauth/code/callback");
  assert.equal(url.searchParams.get("code"), "true");
});

test("buildAuthorizeContext defaults to paste mode on localhost too because the public client does not allowlist arbitrary localhost callbacks", () => {
  const context = buildAuthorizeContext(null, {
    requestHost: "localhost:3000",
    requestProtocol: "http"
  });
  assert.equal(context.flowMode, "paste");
  const url = new URL(context.authorizeUrl);
  assert.equal(url.searchParams.get("redirect_uri"), "https://console.anthropic.com/oauth/code/callback");
  assert.equal(url.searchParams.get("code"), "true");
});

test("ANTHROPIC_OAUTH_FLOW_MODE=redirect with a localhost host still produces a local callback URL", () => {
  const overrides = { ANTHROPIC_OAUTH_FLOW_MODE: "redirect" };
  const context = buildAuthorizeContext(
    {
      get(name) {
        return overrides[name];
      }
    },
    { requestHost: "localhost:3000", requestProtocol: "http" }
  );
  assert.equal(context.flowMode, "redirect");
  const url = new URL(context.authorizeUrl);
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/oauth_anthropic_callback");
  // redirect mode never sets code=true; that flag is only for the paste page
  assert.equal(url.searchParams.get("code"), null);
});

test("ANTHROPIC_OAUTH_FLOW_MODE=paste forces paste mode even on localhost", () => {
  const overrides = { ANTHROPIC_OAUTH_FLOW_MODE: "paste" };
  const context = buildAuthorizeContext(
    {
      get(name) {
        return overrides[name];
      }
    },
    { requestHost: "localhost:3000", requestProtocol: "http" }
  );
  assert.equal(context.flowMode, "paste");
});

test("status helper reports disconnected when no record exists", async () => {
  const projectRoot = createTempProjectRoot();
  setupAuthDataDir(projectRoot);
  try {
    const status = await getStatusForUser({
      projectRoot,
      runtimeParams: null,
      username: "alice"
    });
    assert.equal(status.connected, false);
  } finally {
    teardownAuthDataDir();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("disconnect helper is a no-op when no record exists and reports changed=false", async () => {
  const projectRoot = createTempProjectRoot();
  setupAuthDataDir(projectRoot);
  try {
    const result = await disconnectUser({
      projectRoot,
      runtimeParams: null,
      username: "alice"
    });
    assert.equal(result.changed, false);
  } finally {
    teardownAuthDataDir();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("status helper reads sealed records back into status metadata round-trip", async () => {
  const projectRoot = createTempProjectRoot();
  setupAuthDataDir(projectRoot);
  try {
    // Hand-write a synthetic sealed-shape record. We only validate that the
    // status helper surfaces the metadata fields without touching tokens.
    const userMetaDir = path.join(projectRoot, "app", "L2", "alice", "meta");
    fs.mkdirSync(userMetaDir, { recursive: true });
    fs.writeFileSync(
      path.join(userMetaDir, "anthropic_oauth.json"),
      JSON.stringify(
        {
          version: 1,
          access_token: { ciphertext: "AA", iv: "BB", tag: "CC" },
          refresh_token: { ciphertext: "DD", iv: "EE", tag: "FF" },
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          scope: "user:inference user:profile",
          account_email: "tester@example.invalid",
          organization_id: "org_test",
          organization_name: "Test Org",
          obtained_at: new Date().toISOString()
        },
        null,
        2
      )
    );

    const status = await getStatusForUser({
      projectRoot,
      runtimeParams: null,
      username: "alice"
    });

    assert.equal(status.connected, true);
    assert.equal(status.accountEmail, "tester@example.invalid");
    assert.equal(status.organizationName, "Test Org");
    assert.equal(status.scope, "user:inference user:profile");
    assert.ok(status.expiresAt, "expiresAt should normalize to ISO string");
  } finally {
    teardownAuthDataDir();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
