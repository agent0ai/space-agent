// Self-contained Alpine factory used by the admin and onscreen settings
// dialogs to render the "Connect with Claude" / status / "Disconnect" UI.
//
// Exposed on globalThis so the template can use the standard Space Agent
// inline x-data pattern: `x-data="anthropicOauthConnectBlock()"`.
//
// All token plaintext stays server-side; this module only talks to the
// dedicated authenticated endpoints under /api/oauth_anthropic_*.

import {
  completeAnthropicOauthCallback,
  disconnectAnthropicOauth,
  fetchAnthropicOauthStatus,
  openAuthorizePopup,
  startAnthropicOauthAuthorize
} from "/mod/_core/anthropic_oauth/client.js";

function safeShowToast(message, options = {}) {
  const showToast = globalThis?.space?.visual?.showToast;
  if (typeof showToast === "function") {
    try {
      showToast(message, options);
    } catch {
      // toast failures should never break the connect flow
    }
  }
}

// `expires_at` reflects only the short-lived OAuth access token, not the
// connection itself. Space Agent silently refreshes the access token
// before it lapses, so the connection effectively persists until the user
// disconnects or invalidates the refresh token at Anthropic. The UI no
// longer surfaces the access-token expiry because it confused users into
// thinking their connection would lapse.

const POPUP_FALLBACK_PROBE_MS = 750;

function createAnthropicOauthConnectBlockData() {
  // Closure-scoped non-reactive holders for things Alpine should never
  // try to proxy. Window references (the popup) and registered event
  // listeners are not safe to put on the reactive state object: Alpine's
  // reactivity wrapper introspects every value with `__v_raw` and other
  // proxy probes, and cross-origin Window objects throw on those reads
  // ("Failed to read a named property '__v_raw' from 'Window': An attempt
  // was made to break through the security policy of the user agent").
  let pendingPopup = null;
  let messageHandler = null;
  let popupWatcher = null;

  return {
    isLoading: false,
    isConnecting: false,
    isSubmittingCode: false,
    isDisconnecting: false,
    codeInput: "",
    lastError: "",
    pendingState: "",
    flowMode: "paste",
    showPasteFallback: false,
    status: {
      allowed: true,
      connected: false,
      accountEmail: "",
      organizationName: "",
      expiresAt: "",
      scope: "",
      obtainedAt: ""
    },
    init() {
      void this.refresh();
    },
    destroy() {
      this.stopWaitingForPopup();
    },
    get connected() {
      return Boolean(this.status?.connected);
    },
    get allowed() {
      return this.status?.allowed !== false;
    },
    get accountLabel() {
      return String(this.status?.accountEmail || "").trim();
    },
    get isCodePending() {
      return Boolean(this.pendingState);
    },
    get isRedirectMode() {
      return this.flowMode === "redirect";
    },
    get isPasteMode() {
      return this.flowMode === "paste";
    },
    get shouldShowPasteField() {
      return this.isPasteMode || this.showPasteFallback;
    },
    get connectButtonLabel() {
      if (this.isConnecting) {
        return "Opening Claude...";
      }
      if (this.isCodePending) {
        return this.isRedirectMode ? "Reopen Claude window" : "Reopen Claude authorize page";
      }
      return "Connect with Claude";
    },
    get statusBadgeTone() {
      if (this.lastError) {
        return "color-status-danger";
      }
      if (this.connected) {
        return "color-status-success";
      }
      return "";
    },
    async refresh() {
      this.isLoading = true;
      try {
        const result = await fetchAnthropicOauthStatus();
        this.status = {
          allowed: result?.allowed !== false,
          connected: Boolean(result?.connected),
          accountEmail: String(result?.accountEmail || ""),
          organizationName: String(result?.organizationName || ""),
          expiresAt: String(result?.expiresAt || ""),
          scope: String(result?.scope || ""),
          obtainedAt: String(result?.obtainedAt || "")
        };
        if (this.connected) {
          // Once connected we no longer need the in-flight state token.
          this.pendingState = "";
          this.codeInput = "";
          this.showPasteFallback = false;
          this.stopWaitingForPopup();
        }
        this.lastError = "";
      } catch (error) {
        this.lastError = String(error?.message || "Could not load Claude subscription status.");
      } finally {
        this.isLoading = false;
      }
    },
    installMessageListener() {
      if (messageHandler || typeof window === "undefined") {
        return;
      }
      const self = this;
      const handler = (event) => {
        const data = event?.data;
        if (!data || typeof data !== "object" || data.type !== "space-anthropic-oauth-complete") {
          return;
        }
        if (data.success) {
          void self.handleRedirectSuccess();
        } else {
          self.lastError =
            String(data.error || "Claude rejected the connect. Try again or paste the code below.");
          self.showPasteFallback = true;
          self.isConnecting = false;
        }
      };
      window.addEventListener("message", handler);
      messageHandler = handler;
    },
    removeMessageListener() {
      if (messageHandler && typeof window !== "undefined") {
        window.removeEventListener("message", messageHandler);
      }
      messageHandler = null;
    },
    watchPopupClosed() {
      this.clearPopupWatcher();
      if (typeof window === "undefined" || !pendingPopup) {
        return;
      }
      const popup = pendingPopup;
      const self = this;
      popupWatcher = window.setInterval(() => {
        let closed = false;
        try {
          closed = !popup || popup.closed;
        } catch {
          // Cross-origin access can throw; treat as closed and stop probing.
          closed = true;
        }
        if (closed) {
          self.clearPopupWatcher();
          if (self.isRedirectMode && !self.connected && self.pendingState) {
            self.showPasteFallback = true;
            self.isConnecting = false;
          }
        }
      }, POPUP_FALLBACK_PROBE_MS);
    },
    clearPopupWatcher() {
      if (popupWatcher && typeof window !== "undefined") {
        window.clearInterval(popupWatcher);
      }
      popupWatcher = null;
    },
    stopWaitingForPopup() {
      this.removeMessageListener();
      this.clearPopupWatcher();
      try {
        pendingPopup?.close?.();
      } catch {
        // ignore popup cleanup failures
      }
      pendingPopup = null;
    },
    async handleRedirectSuccess() {
      this.stopWaitingForPopup();
      this.pendingState = "";
      this.codeInput = "";
      this.showPasteFallback = false;
      this.isConnecting = false;
      await this.refresh();
      safeShowToast("Claude subscription connected.", { tone: "success" });
    },
    async startConnect() {
      if (this.isConnecting || this.isSubmittingCode) {
        return;
      }
      if (!this.allowed) {
        this.lastError = "Claude subscription OAuth is disabled in this system.";
        return;
      }
      this.lastError = "";
      this.isConnecting = true;
      this.showPasteFallback = false;
      try {
        const result = await startAnthropicOauthAuthorize();
        const authorizeUrl = String(result?.authorizeUrl || "").trim();
        const state = String(result?.state || "").trim();
        const flowMode = String(result?.flowMode || "paste").trim().toLowerCase();
        if (!authorizeUrl || !state) {
          throw new Error("The server did not return a Claude authorize URL.");
        }
        this.pendingState = state;
        this.flowMode = flowMode === "redirect" ? "redirect" : "paste";
        this.stopWaitingForPopup();
        if (this.isRedirectMode) {
          this.installMessageListener();
        }
        pendingPopup = openAuthorizePopup(authorizeUrl);
        if (!pendingPopup) {
          // Popup blocker fired. Open in a new tab and surface paste as
          // a fallback path because postMessage won't fire from a
          // top-level tab navigation.
          if (typeof window !== "undefined" && typeof window.open === "function") {
            window.open(authorizeUrl, "_blank", "noopener,noreferrer");
          }
          this.showPasteFallback = true;
        } else if (this.isRedirectMode) {
          this.watchPopupClosed();
        }
      } catch (error) {
        this.lastError = String(error?.message || "Could not start the Claude connect flow.");
      } finally {
        this.isConnecting = false;
      }
    },
    setCodeInput(value) {
      this.codeInput = String(value || "");
    },
    async submitCode() {
      let code = String(this.codeInput || "").trim();
      let state = String(this.pendingState || "").trim();
      // Anthropic's hosted code page shows `<code>#<state>` joined by `#`.
      // If the user pasted the whole thing, accept it and split here so
      // the user doesn't have to.
      const hashIndex = code.indexOf("#");
      if (hashIndex !== -1) {
        const tail = code.slice(hashIndex + 1).trim();
        code = code.slice(0, hashIndex).trim();
        if (tail) {
          state = tail;
        }
      }
      if (!code) {
        this.lastError = "Paste the code Claude showed you.";
        return;
      }
      if (!state) {
        this.lastError = "Start a Claude connect first, then paste the code.";
        return;
      }
      this.isSubmittingCode = true;
      this.lastError = "";
      try {
        await completeAnthropicOauthCallback({ code, state });
        this.codeInput = "";
        this.pendingState = "";
        this.showPasteFallback = false;
        this.stopWaitingForPopup();
        await this.refresh();
        safeShowToast("Claude subscription connected.", { tone: "success" });
      } catch (error) {
        this.lastError = String(
          error?.message || "Could not finish the Claude connect. Try again or click Connect with Claude to start fresh."
        );
      } finally {
        this.isSubmittingCode = false;
      }
    },
    async disconnect() {
      if (this.isDisconnecting) {
        return;
      }
      this.isDisconnecting = true;
      this.lastError = "";
      try {
        await disconnectAnthropicOauth();
        this.stopWaitingForPopup();
        await this.refresh();
        safeShowToast("Claude subscription disconnected.", { tone: "neutral" });
      } catch (error) {
        this.lastError = String(error?.message || "Could not disconnect Claude.");
      } finally {
        this.isDisconnecting = false;
      }
    }
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.anthropicOauthConnectBlock = function anthropicOauthConnectBlock() {
    return createAnthropicOauthConnectBlockData();
  };
}

export {
  createAnthropicOauthConnectBlockData
};
