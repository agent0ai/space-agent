import assert from "node:assert/strict";
import test from "node:test";

import {
  countChatMessageTokens,
  prepareChatMessagesForVisionTransport
} from "../app/L0/_all/mod/_core/agent-chat/visual-data.js";
import { mergeConsecutiveChatMessages } from "../app/L0/_all/mod/_core/framework/js/chat-messages.js";

const VISUAL_DATA = Object.freeze({
  dataUrl: "data:image/png;base64,AA==",
  detail: "high",
  height: 512,
  id: "visual-1",
  mediaType: "image/png",
  name: "probe.png",
  width: 512
});

test("vision transport emits provider content parts without internal prompt metadata", () => {
  const sourceMessage = {
    content: "Describe this image.",
    role: "user",
    tokenCount: 999,
    visualData: [VISUAL_DATA]
  };
  const messages = prepareChatMessagesForVisionTransport([sourceMessage], {
    model: "gpt-5.4",
    supportsVision: true
  });

  assert.deepEqual(messages, [
    {
      content: [
        {
          text: "Describe this image.",
          type: "text"
        },
        {
          image_url: {
            detail: "high",
            url: VISUAL_DATA.dataUrl
          },
          type: "image_url"
        }
      ],
      role: "user"
    }
  ]);
  assert.equal(Object.hasOwn(messages[0], "tokenCount"), false);
  assert.equal(Object.hasOwn(messages[0], "visualData"), false);
  assert.deepEqual(sourceMessage.visualData, [VISUAL_DATA]);
});

test("non-vision transport preserves text while dropping internal visual metadata", () => {
  const messages = prepareChatMessagesForVisionTransport(
    [
      {
        content: "Text only.",
        role: "user",
        tokenCount: 12,
        visualData: [VISUAL_DATA]
      }
    ],
    {
      supportsVision: false
    }
  );

  assert.deepEqual(messages, [
    {
      content: "Text only.",
      role: "user"
    }
  ]);
});

test("consecutive user turns merge text and deduplicate visual ids before token accounting", () => {
  const mergedMessages = mergeConsecutiveChatMessages([
    {
      content: "First",
      role: "user",
      visualData: [VISUAL_DATA]
    },
    {
      content: "Second",
      role: "user",
      visualData: [VISUAL_DATA, { ...VISUAL_DATA, id: "visual-2", name: "second.png" }]
    }
  ]);

  assert.equal(mergedMessages.length, 1);
  assert.equal(mergedMessages[0].content, "First\n\nSecond");
  assert.deepEqual(
    mergedMessages[0].visualData.map((entry) => entry.id),
    ["visual-1", "visual-2"]
  );
  assert.ok(
    countChatMessageTokens(mergedMessages[0], {
      model: "gpt-5.4",
      supportsVision: true
    }) > countChatMessageTokens({ content: mergedMessages[0].content, role: "user" })
  );
});
