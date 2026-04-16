import assert from "node:assert/strict";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startServer } from "../server/server.js";
import {
  createProvisionedUserCryptoRecord,
  rewrapUserCryptoRecord,
  unwrapUserCryptoMasterKey
} from "../server/pages/res/user-crypto.js";

function buildAuthMessage({ challengeToken, clientNonce, serverNonce, username }) {
  return ["space-login-v1", username, clientNonce, serverNonce, challengeToken].join(":");
}

function createClientProof({ challenge, clientNonce, password, username }) {
  const saltedPassword = pbkdf2Sync(
    password,
    Buffer.from(String(challenge.salt || ""), "base64url"),
    Number(challenge.iterations),
    32,
    "sha256"
  );
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const authMessage = buildAuthMessage({
    challengeToken: challenge.challengeToken,
    clientNonce,
    serverNonce: challenge.serverNonce,
    username
  });
  const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();

  return Buffer.from(clientKey.map((byte, index) => byte ^ clientSignature[index])).toString(
    "base64url"
  );
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    body: options.body,
    headers: options.headers,
    method: options.method || "GET"
  });
  const bodyText = await response.text();

  return {
    body: bodyText ? JSON.parse(bodyText) : null,
    headers: response.headers,
    status: response.status
  };
}

async function createRuntime(runtimeParamOverrides) {
  return startServer({
    runtimeParamOverrides: {
      HOST: "127.0.0.1",
      PORT: "0",
      WORKERS: "1",
      ...runtimeParamOverrides
    }
  });
}

test("password_change validates the current password, clears sessions, and accepts the replacement password", async (testContext) => {
  const customwarePath = await fs.mkdtemp(path.join(os.tmpdir(), "space-password-change-"));
  const runtime = await createRuntime({
    ALLOW_GUEST_USERS: "true",
    CUSTOMWARE_PATH: customwarePath
  });

  testContext.after(async () => {
    await runtime.close();
    await fs.rm(customwarePath, { force: true, recursive: true });
  });

  const guestCreateResponse = await requestJson(runtime.browserUrl, "/api/guest_create", {
    body: "{}",
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  assert.equal(guestCreateResponse.status, 200);
  assert.ok(guestCreateResponse.body?.username);
  assert.ok(guestCreateResponse.body?.password);

  const username = guestCreateResponse.body.username;
  const originalPassword = guestCreateResponse.body.password;
  const replacementPassword = "fresh-password-123";
  const initialNonce = randomBytes(18).toString("base64url");

  const initialChallengeResponse = await requestJson(runtime.browserUrl, "/api/login_challenge", {
    body: JSON.stringify({
      clientNonce: initialNonce,
      username
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  assert.equal(initialChallengeResponse.status, 200);
  assert.ok(initialChallengeResponse.body?.challengeToken);
  assert.equal(initialChallengeResponse.body?.userCrypto?.state, "missing");

  const provisionedUserCrypto = await createProvisionedUserCryptoRecord({
    password: originalPassword,
    serverShare: decodeBase64Url(initialChallengeResponse.body.userCrypto.provisioningShare)
  });

  const initialLoginResponse = await requestJson(runtime.browserUrl, "/api/login", {
    body: JSON.stringify({
      challengeToken: initialChallengeResponse.body.challengeToken,
      clientProof: createClientProof({
        challenge: initialChallengeResponse.body,
        clientNonce: initialNonce,
        password: originalPassword,
        username
      }),
      userCryptoProvisioning: {
        record: provisionedUserCrypto.record
      }
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
  const sessionCookie = initialLoginResponse.headers.get("set-cookie") || "";

  assert.equal(initialLoginResponse.status, 200);
  assert.equal(initialLoginResponse.body?.authenticated, true);
  assert.ok(sessionCookie.includes("space_session="));
  assert.equal(initialLoginResponse.body?.userCrypto?.state, "ready");

  const userCryptoMasterKey = await unwrapUserCryptoMasterKey({
    password: originalPassword,
    record: initialLoginResponse.body.userCrypto.record,
    serverShare: decodeBase64Url(initialLoginResponse.body.userCrypto.serverShare)
  });
  const replacementUserCrypto = await rewrapUserCryptoRecord({
    keyId: initialLoginResponse.body.userCrypto.keyId,
    masterKey: userCryptoMasterKey,
    password: replacementPassword,
    serverShare: decodeBase64Url(initialLoginResponse.body.userCrypto.serverShare)
  });

  const rejectedChangeResponse = await requestJson(runtime.browserUrl, "/api/password_change", {
    body: JSON.stringify({
      currentPassword: "wrong-password",
      newPassword: replacementPassword
    }),
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie
    },
    method: "POST"
  });

  assert.equal(rejectedChangeResponse.status, 401);
  assert.match(String(rejectedChangeResponse.body?.error || ""), /current password is incorrect/i);

  const successfulChangeResponse = await requestJson(runtime.browserUrl, "/api/password_change", {
    body: JSON.stringify({
      currentPassword: originalPassword,
      newPassword: replacementPassword,
      userCryptoRecord: replacementUserCrypto.record
    }),
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie
    },
    method: "POST"
  });
  const clearedCookie = successfulChangeResponse.headers.get("set-cookie") || "";

  assert.equal(successfulChangeResponse.status, 200);
  assert.deepEqual(successfulChangeResponse.body, {
    passwordChanged: true,
    signedOut: true,
    username
  });
  assert.match(clearedCookie, /space_session=/);
  assert.match(clearedCookie, /Max-Age=0/i);

  const staleLoginCheckResponse = await requestJson(runtime.browserUrl, "/api/login_check", {
    headers: {
      cookie: sessionCookie
    }
  });

  assert.equal(staleLoginCheckResponse.status, 200);
  assert.deepEqual(staleLoginCheckResponse.body, {
    authenticated: false,
    username: ""
  });
  assert.match(staleLoginCheckResponse.headers.get("set-cookie") || "", /Max-Age=0/i);

  const oldPasswordNonce = randomBytes(18).toString("base64url");
  const oldPasswordChallengeResponse = await requestJson(runtime.browserUrl, "/api/login_challenge", {
    body: JSON.stringify({
      clientNonce: oldPasswordNonce,
      username
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  assert.equal(oldPasswordChallengeResponse.status, 200);

  const oldPasswordLoginResponse = await requestJson(runtime.browserUrl, "/api/login", {
    body: JSON.stringify({
      challengeToken: oldPasswordChallengeResponse.body.challengeToken,
      clientProof: createClientProof({
        challenge: oldPasswordChallengeResponse.body,
        clientNonce: oldPasswordNonce,
        password: originalPassword,
        username
      })
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  assert.equal(oldPasswordLoginResponse.status, 401);

  const replacementNonce = randomBytes(18).toString("base64url");
  const replacementChallengeResponse = await requestJson(runtime.browserUrl, "/api/login_challenge", {
    body: JSON.stringify({
      clientNonce: replacementNonce,
      username
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  assert.equal(replacementChallengeResponse.status, 200);

  const replacementLoginResponse = await requestJson(runtime.browserUrl, "/api/login", {
    body: JSON.stringify({
      challengeToken: replacementChallengeResponse.body.challengeToken,
      clientProof: createClientProof({
        challenge: replacementChallengeResponse.body,
        clientNonce: replacementNonce,
        password: replacementPassword,
        username
      })
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  assert.equal(replacementLoginResponse.status, 200);
  assert.equal(replacementLoginResponse.body?.authenticated, true);
});

test("password_change is disabled in single-user mode", async (testContext) => {
  const customwarePath = await fs.mkdtemp(path.join(os.tmpdir(), "space-password-change-single-"));
  const runtime = await createRuntime({
    CUSTOMWARE_PATH: customwarePath,
    SINGLE_USER_APP: "true"
  });

  testContext.after(async () => {
    await runtime.close();
    await fs.rm(customwarePath, { force: true, recursive: true });
  });

  const response = await requestJson(runtime.browserUrl, "/api/password_change", {
    body: JSON.stringify({
      currentPassword: "old",
      newPassword: "new"
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  assert.equal(response.status, 403);
  assert.match(String(response.body?.error || ""), /password login is disabled in single-user mode/i);
});
