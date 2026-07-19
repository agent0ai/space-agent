import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveOnscreenAgentBoundaryAfterAssistantResponse
} from "../app/L0/_all/mod/_core/onscreen_agent/turn-boundary.js";

test("queued onscreen follow-up waits for pending assistant execution output", () => {
  assert.equal(
    resolveOnscreenAgentBoundaryAfterAssistantResponse(
      "queued",
      "Checking the current state now...\n_____javascript\nreturn await space.api.userSelfInfo()"
    ),
    ""
  );
});

test("queued onscreen follow-up can proceed after a non-executing assistant reply", () => {
  assert.equal(
    resolveOnscreenAgentBoundaryAfterAssistantResponse("queued", "Done."),
    "queued"
  );
});

test("stop boundary remains immediate even when assistant content contains execution", () => {
  assert.equal(
    resolveOnscreenAgentBoundaryAfterAssistantResponse(
      "stopped",
      "Checking the current state now...\n_____javascript\nreturn await space.api.userSelfInfo()"
    ),
    "stopped"
  );
});
