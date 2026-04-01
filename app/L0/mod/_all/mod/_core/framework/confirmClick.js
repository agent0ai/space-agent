export function registerAlpineMagic() {
  const Alpine = globalThis.Alpine;
  if (!Alpine || typeof Alpine.magic !== "function" || Alpine.__agentOneConfirmClickRegistered) {
    return;
  }

  Alpine.__agentOneConfirmClickRegistered = true;
  Alpine.magic("confirmClick", () => (message = "Are you sure?") => globalThis.confirm(message));
}
