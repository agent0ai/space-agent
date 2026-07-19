export const ONSCREEN_AGENT_EXECUTION_SEPARATOR = "_____javascript";

export function hasOnscreenAgentExecutionSeparator(content) {
  return typeof content === "string" && content.includes(ONSCREEN_AGENT_EXECUTION_SEPARATOR);
}

export function resolveOnscreenAgentBoundaryAfterAssistantResponse(boundaryAction, assistantContent) {
  const action = typeof boundaryAction === "string" ? boundaryAction : "";

  if (action === "queued" && hasOnscreenAgentExecutionSeparator(assistantContent)) {
    return "";
  }

  return action;
}
