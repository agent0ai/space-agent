import {
  applyAnthropicSubscriptionRequest,
  isAnthropicSubscriptionProvider
} from "/mod/_core/anthropic_oauth/request.js";

export default async function anthropicSubscriptionAdminRequestHook(hookContext) {
  const apiRequest = hookContext?.result;

  if (!apiRequest || typeof apiRequest !== "object") {
    return;
  }

  const provider = apiRequest.settings?.provider;
  if (!isAnthropicSubscriptionProvider(provider)) {
    return;
  }

  hookContext.result = applyAnthropicSubscriptionRequest(apiRequest);
}
