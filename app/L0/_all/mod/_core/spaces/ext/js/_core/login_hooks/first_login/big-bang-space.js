import { runFirstLoginSpaceOnboarding } from "/mod/_core/spaces/first-login-onboarding.js";

export default async function createBigBangSpaceOnFirstLogin(context = {}) {
  if (context?.isFirstLogin !== true) {
    return;
  }

  await runFirstLoginSpaceOnboarding(context);
}
