import assert from "node:assert/strict";
import test from "node:test";

import { chatToResponsesRequest } from "../app/L0/_all/mod/_core/openai_codex/request_shape.js";

test("chatToResponsesRequest lifts the first system message into instructions", () => {
  const body = chatToResponsesRequest({
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello." }
    ],
    model: "gpt-5.4-mini"
  });

  assert.equal(body.instructions, "You are helpful.");
  assert.equal(body.model, "gpt-5.4-mini");
  assert.deepEqual(body.input, [
    {
      content: [{ text: "Hello.", type: "input_text" }],
      role: "user"
    }
  ]);
  assert.equal(body.store, false);
});

test("chatToResponsesRequest wraps user strings as input_text and assistant strings as output_text", () => {
  // The Codex Responses API rejects `input_text` entries that sit under a
  // `role: "assistant"` message with HTTP 400 `invalid_value`; assistant
  // text must use `output_text`. This test guards that mapping.
  const body = chatToResponsesRequest({
    messages: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hey" },
      { role: "user", content: "How are you?" }
    ],
    model: "gpt-5.4"
  });

  assert.deepEqual(body.input, [
    {
      content: [{ text: "Hi", type: "input_text" }],
      role: "user"
    },
    {
      content: [{ text: "Hey", type: "output_text" }],
      role: "assistant"
    },
    {
      content: [{ text: "How are you?", type: "input_text" }],
      role: "user"
    }
  ]);
});

test("chatToResponsesRequest converts multimodal text parts to input_text", () => {
  const body = chatToResponsesRequest({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe" },
          { type: "text", text: "this" }
        ]
      }
    ],
    model: "gpt-5.4"
  });

  assert.deepEqual(body.input[0].content, [
    { text: "Describe", type: "input_text" },
    { text: "this", type: "input_text" }
  ]);
});

test("chatToResponsesRequest converts image_url parts to input_image", () => {
  const body = chatToResponsesRequest({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "See this:" },
          {
            type: "image_url",
            image_url: { url: "https://example.invalid/a.png", detail: "high" }
          }
        ]
      }
    ],
    model: "gpt-5.4"
  });

  assert.deepEqual(body.input[0].content, [
    { text: "See this:", type: "input_text" },
    {
      detail: "high",
      image_url: "https://example.invalid/a.png",
      type: "input_image"
    }
  ]);
});

test("chatToResponsesRequest drops fields the Codex endpoint rejects", () => {
  const body = chatToResponsesRequest({
    frequency_penalty: 0.1,
    max_output_tokens: 1000,
    max_tokens: 2000,
    messages: [{ role: "user", content: "ping" }],
    model: "gpt-5.4-mini",
    presence_penalty: 0.2,
    response_format: { type: "json_object" },
    stop: ["\n\n"],
    temperature: 0.5,
    tool_choice: "none",
    tools: [{ type: "function", function: { name: "foo" } }],
    top_p: 0.9
  });

  assert.ok(!("frequency_penalty" in body));
  assert.ok(!("max_output_tokens" in body));
  assert.ok(!("max_tokens" in body));
  assert.ok(!("presence_penalty" in body));
  assert.ok(!("response_format" in body));
  assert.ok(!("stop" in body));
  assert.ok(!("temperature" in body));
  assert.ok(!("tool_choice" in body));
  assert.ok(!("tools" in body));
  assert.ok(!("top_p" in body));
});

test("chatToResponsesRequest preserves stream flag when set", () => {
  const streaming = chatToResponsesRequest({
    messages: [{ role: "user", content: "ping" }],
    model: "gpt-5.4",
    stream: true
  });
  const nonStreaming = chatToResponsesRequest({
    messages: [{ role: "user", content: "ping" }],
    model: "gpt-5.4"
  });

  assert.equal(streaming.stream, true);
  assert.ok(!("stream" in nonStreaming));
});

test("chatToResponsesRequest always sets store:false", () => {
  const body = chatToResponsesRequest({
    messages: [{ role: "user", content: "ping" }],
    model: "gpt-5.4",
    store: true
  });

  assert.equal(body.store, false);
});

test("chatToResponsesRequest keeps only the first system message as instructions", () => {
  const body = chatToResponsesRequest({
    messages: [
      { role: "system", content: "First system rule." },
      { role: "user", content: "Hi" },
      { role: "system", content: "Second system rule should be ignored." },
      { role: "assistant", content: "Hey" }
    ],
    model: "gpt-5.4"
  });

  assert.equal(body.instructions, "First system rule.");
  assert.deepEqual(
    body.input.map((entry) => entry.role),
    ["user", "assistant"]
  );
});

test("chatToResponsesRequest skips messages with empty or unsupported content", () => {
  const body = chatToResponsesRequest({
    messages: [
      { role: "user", content: "" },
      { role: "tool", content: "ignored" },
      { role: "user", content: [] },
      { role: "user", content: "keep me" }
    ],
    model: "gpt-5.4"
  });

  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].content[0].text, "keep me");
});

test("chatToResponsesRequest omits instructions when no system message exists", () => {
  const body = chatToResponsesRequest({
    messages: [{ role: "user", content: "Hi" }],
    model: "gpt-5.4"
  });

  assert.ok(!("instructions" in body));
});

test("chatToResponsesRequest never emits input_text under an assistant entry", () => {
  // Regression guard: Codex rejected this with HTTP 400 `invalid_value` on
  // `input[1].content[0]` because assistant turns must use `output_text`.
  const body = chatToResponsesRequest({
    messages: [
      { role: "system", content: "Sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" }
    ],
    model: "gpt-5.4"
  });

  for (const entry of body.input) {
    for (const part of entry.content) {
      if (entry.role === "assistant" && part.type && part.type !== "output_text" && part.type !== "input_image") {
        throw new Error(`assistant entry emitted unexpected content type ${part.type}`);
      }

      if (entry.role === "user" && part.type === "output_text") {
        throw new Error("user entry must not emit output_text");
      }
    }
  }
});

test("chatToResponsesRequest handles malformed body gracefully", () => {
  assert.deepEqual(chatToResponsesRequest(null), {
    input: [],
    model: "",
    store: false
  });
  assert.deepEqual(chatToResponsesRequest(), {
    input: [],
    model: "",
    store: false
  });
});
