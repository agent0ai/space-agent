import { createApiClient } from "./api-client.js";
import { createStore } from "./AlpineStore.js";
import { createBundleRuntime } from "./bundles.js";
import { downloadProxiedFile } from "./download.js";
import { installFetchProxy } from "./fetch-proxy.js";
import * as markdown from "./markdown-frontmatter.js";
import { buildProxyUrl, isProxyableExternalUrl } from "./proxy-url.js";
import { getFrontendServerConfigValues } from "./server-config.js";
import * as userCrypto from "/mod/_core/user_crypto/user-crypto.js";
import * as yaml from "./yaml-lite.js";

export function initializeRuntime(options = {}) {
  const apiBasePath = options.apiBasePath || "/api";
  const proxyPath = options.proxyPath || "/api/proxy";

  installFetchProxy({ proxyPath });
  const api = createApiClient({ basePath: apiBasePath });
  const previousRuntime = globalThis.space && typeof globalThis.space === "object" ? globalThis.space : {};
  const previousConfig =
    previousRuntime.config && typeof previousRuntime.config === "object" ? previousRuntime.config : {};
  const previousFw =
    previousRuntime.fw && typeof previousRuntime.fw === "object" ? previousRuntime.fw : {};
  const previousBundles =
    previousRuntime.bundles && typeof previousRuntime.bundles === "object" ? previousRuntime.bundles : null;
  const previousUtils =
    previousRuntime.utils && typeof previousRuntime.utils === "object" ? previousRuntime.utils : {};
  const previousMarkdownUtils =
    previousUtils.markdown && typeof previousUtils.markdown === "object" ? previousUtils.markdown : {};
  const previousChat = previousRuntime.chat && typeof previousRuntime.chat === "object" ? previousRuntime.chat : null;
  const legacyCurrentChat =
    previousRuntime.currentChat && typeof previousRuntime.currentChat === "object" ? previousRuntime.currentChat : null;
  const serverConfigValues = getFrontendServerConfigValues();

  const runtime = {
    ...previousRuntime,
    api,
    apiBasePath,
    config: {
      ...previousConfig,
      all() {
        return { ...serverConfigValues };
      },
      get(name, fallback = undefined) {
        const normalizedName = String(name || "").trim().toUpperCase();

        return Object.prototype.hasOwnProperty.call(serverConfigValues, normalizedName)
          ? serverConfigValues[normalizedName]
          : fallback;
      },
      has(name) {
        const normalizedName = String(name || "").trim().toUpperCase();
        return Object.prototype.hasOwnProperty.call(serverConfigValues, normalizedName);
      },
      values: serverConfigValues
    },
    fw: {
      ...previousFw,
      createStore
    },
    chat: previousChat || legacyCurrentChat || undefined,
    bundles: previousBundles || createBundleRuntime({ api }),
    proxyPath,
    utils: {
      ...previousUtils,
      markdown: {
        ...previousMarkdownUtils,
        render: markdown.renderMarkdown,
        parseDocument: markdown.parseMarkdownDocument
      },
      yaml: {
        parse: yaml.parseSimpleYaml,
        stringify: yaml.serializeSimpleYaml
      },
      userCrypto: {
        buildPasswordRewrap: userCrypto.buildPasswordRewrap,
        clearSession: userCrypto.clearUserCryptoSession,
        decryptBytes: userCrypto.decryptBytes,
        decryptText: userCrypto.decryptText,
        encryptBytes: userCrypto.encryptBytes,
        encryptText: userCrypto.encryptText,
        initialize: userCrypto.initializeUserCrypto,
        isReady: userCrypto.isUserCryptoReady,
        status: userCrypto.getUserCryptoStatus
      }
    },
    fetchExternal(targetUrl, init) {
      return window.fetch(targetUrl, init);
    },
    proxy: {
      isExternal(targetUrl) {
        return isProxyableExternalUrl(targetUrl);
      },
      buildUrl(targetUrl, proxyOptions = {}) {
        return buildProxyUrl(targetUrl, {
          proxyPath,
          ...proxyOptions
        });
      }
    },
    download(targetUrl, downloadOptions = {}) {
      return downloadProxiedFile(targetUrl, {
        proxyPath,
        ...downloadOptions
      });
    }
  };

  delete runtime.currentChat;

  globalThis.space = runtime;
  return runtime;
}
