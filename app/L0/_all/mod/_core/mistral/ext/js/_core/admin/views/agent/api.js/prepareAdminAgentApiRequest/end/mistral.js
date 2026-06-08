import { applyMistralBodyRewrite, isMistralEndpoint } from "/mod/_core/mistral/request.js";

export default async function mistralAdminRequestHook(hookContext) {
  const apiRequest = hookContext?.result;

  if (!apiRequest || typeof apiRequest !== "object") {
    return;
  }

  if (!isMistralEndpoint(apiRequest.apiEndpoint || apiRequest.settings?.apiEndpoint || "")) {
    return;
  }

  hookContext.result = applyMistralBodyRewrite(apiRequest);
}
