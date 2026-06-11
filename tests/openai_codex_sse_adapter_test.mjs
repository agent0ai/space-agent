import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_STREAM_DONE_MARKER,
  mapCodexEventSequenceToChatFrames,
  mapCodexEventToChatFrames
} from "../app/L0/_all/mod/_core/openai_codex/sse_adapter.js";

test("mapCodexEventToChatFrames emits content frames for output_text deltas", () => {
  const frames = mapCodexEventToChatFrames({
    delta: "Hel",
    item_id: "msg_1",
    output_index: 0,
    sequence_number: 5,
    type: "response.output_text.delta"
  });

  assert.deepEqual(frames, [
    {
      choices: [
        {
          delta: { content: "Hel" },
          index: 0
        }
      ]
    }
  ]);
});

test("mapCodexEventToChatFrames emits content frames for refusal deltas", () => {
  const frames = mapCodexEventToChatFrames({
    delta: "I cannot",
    type: "response.refusal.delta"
  });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].choices[0].delta.content, "I cannot");
});

test("mapCodexEventToChatFrames skips empty text deltas", () => {
  const frames = mapCodexEventToChatFrames({
    delta: "",
    type: "response.output_text.delta"
  });

  assert.deepEqual(frames, []);
});

test("mapCodexEventToChatFrames synthesizes finish + [DONE] on response.completed", () => {
  const frames = mapCodexEventToChatFrames({
    response: {
      usage: {
        input_tokens: 12,
        output_tokens: 3,
        total_tokens: 15
      }
    },
    sequence_number: 99,
    type: "response.completed"
  });

  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], {
    choices: [
      {
        delta: {},
        finish_reason: "stop",
        index: 0
      }
    ],
    usage: {
      completion_tokens: 3,
      prompt_tokens: 12,
      total_tokens: 15
    }
  });
  assert.equal(frames[1], CODEX_STREAM_DONE_MARKER);
});

test("mapCodexEventToChatFrames handles response.completed without usage", () => {
  const frames = mapCodexEventToChatFrames({
    response: {},
    type: "response.completed"
  });

  assert.equal(frames.length, 2);
  assert.equal(frames[0].choices[0].finish_reason, "stop");
  assert.ok(!("usage" in frames[0]));
  assert.equal(frames[1], CODEX_STREAM_DONE_MARKER);
});

test("mapCodexEventToChatFrames maps incomplete reasons onto chat finish reasons", () => {
  const lengthFrames = mapCodexEventToChatFrames({
    response: {
      incomplete_details: { reason: "max_output_tokens" }
    },
    type: "response.incomplete"
  });
  assert.equal(lengthFrames[0].choices[0].finish_reason, "length");
  assert.equal(lengthFrames[1], CODEX_STREAM_DONE_MARKER);

  const filterFrames = mapCodexEventToChatFrames({
    response: {
      incomplete_details: { reason: "content_filter" }
    },
    type: "response.incomplete"
  });
  assert.equal(filterFrames[0].choices[0].finish_reason, "content_filter");

  const unknownFrames = mapCodexEventToChatFrames({
    response: {},
    type: "response.incomplete"
  });
  assert.equal(unknownFrames[0].choices[0].finish_reason, "length");
});

test("mapCodexEventToChatFrames throws on response.failed", () => {
  assert.throws(
    () =>
      mapCodexEventToChatFrames({
        response: {
          error: { message: "upstream boom" }
        },
        type: "response.failed"
      }),
    /upstream boom/u
  );
});

test("mapCodexEventToChatFrames throws on standalone error event", () => {
  assert.throws(
    () =>
      mapCodexEventToChatFrames({
        message: "rate limited",
        type: "error"
      }),
    /rate limited/u
  );
});

test("mapCodexEventToChatFrames silently ignores documented low-level events", () => {
  const ignoredTypes = [
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.output_item.done",
    "response.content_part.added",
    "response.content_part.done",
    "response.output_text.done",
    "response.refusal.done",
    "response.function_call_arguments.delta",
    "response.function_call_arguments.done",
    "response.reasoning_text.delta",
    "response.reasoning_summary_text.delta",
    "response.queued",
    "response.output_text_annotation.added",
    "response.audio.delta",
    "response.code_interpreter_call.in_progress",
    "response.file_search_call.searching",
    "response.web_search_call.completed",
    "response.image_gen_call.generating",
    "response.mcp_call.in_progress",
    "response.custom_tool_call_input.delta"
  ];

  for (const type of ignoredTypes) {
    const frames = mapCodexEventToChatFrames({ type });
    assert.deepEqual(frames, [], `expected ${type} to produce no frames`);
  }
});

test("mapCodexEventToChatFrames ignores unknown future events without throwing", () => {
  assert.deepEqual(
    mapCodexEventToChatFrames({ type: "response.some_future_event" }),
    []
  );
});

test("mapCodexEventToChatFrames handles malformed input defensively", () => {
  assert.deepEqual(mapCodexEventToChatFrames(null), []);
  assert.deepEqual(mapCodexEventToChatFrames(undefined), []);
  assert.deepEqual(mapCodexEventToChatFrames("string"), []);
  assert.deepEqual(mapCodexEventToChatFrames({}), []);
  assert.deepEqual(mapCodexEventToChatFrames({ type: 42 }), []);
});

test("mapCodexEventSequenceToChatFrames processes a realistic happy-path stream", () => {
  const events = [
    { response: {}, sequence_number: 0, type: "response.created" },
    { sequence_number: 1, type: "response.in_progress" },
    { item: {}, output_index: 0, sequence_number: 2, type: "response.output_item.added" },
    {
      content_index: 0,
      item_id: "msg_1",
      output_index: 0,
      part: {},
      sequence_number: 3,
      type: "response.content_part.added"
    },
    {
      content_index: 0,
      delta: "Hel",
      item_id: "msg_1",
      output_index: 0,
      sequence_number: 4,
      type: "response.output_text.delta"
    },
    {
      content_index: 0,
      delta: "lo",
      item_id: "msg_1",
      output_index: 0,
      sequence_number: 5,
      type: "response.output_text.delta"
    },
    {
      content_index: 0,
      delta: "!",
      item_id: "msg_1",
      output_index: 0,
      sequence_number: 6,
      type: "response.output_text.delta"
    },
    {
      content_index: 0,
      item_id: "msg_1",
      output_index: 0,
      sequence_number: 7,
      text: "Hello!",
      type: "response.output_text.done"
    },
    { item: {}, output_index: 0, sequence_number: 8, type: "response.output_item.done" },
    {
      response: {
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 }
      },
      sequence_number: 9,
      type: "response.completed"
    }
  ];

  const frames = mapCodexEventSequenceToChatFrames(events);

  // 3 text deltas + 1 finish frame + 1 [DONE] marker
  assert.equal(frames.length, 5);
  assert.equal(frames[0].choices[0].delta.content, "Hel");
  assert.equal(frames[1].choices[0].delta.content, "lo");
  assert.equal(frames[2].choices[0].delta.content, "!");
  assert.equal(frames[3].choices[0].finish_reason, "stop");
  assert.deepEqual(frames[3].usage, {
    completion_tokens: 3,
    prompt_tokens: 8,
    total_tokens: 11
  });
  assert.equal(frames[4], CODEX_STREAM_DONE_MARKER);
});

test("mapCodexEventSequenceToChatFrames processes a refusal sequence", () => {
  const events = [
    { response: {}, type: "response.created" },
    {
      delta: "I cannot ",
      type: "response.refusal.delta"
    },
    {
      delta: "help with that.",
      type: "response.refusal.delta"
    },
    {
      text: "I cannot help with that.",
      type: "response.refusal.done"
    },
    {
      response: {
        usage: { input_tokens: 5, output_tokens: 8, total_tokens: 13 }
      },
      type: "response.completed"
    }
  ];

  const frames = mapCodexEventSequenceToChatFrames(events);

  assert.equal(frames.length, 4);
  assert.equal(frames[0].choices[0].delta.content, "I cannot ");
  assert.equal(frames[1].choices[0].delta.content, "help with that.");
  assert.equal(frames[2].choices[0].finish_reason, "stop");
  assert.equal(frames[3], CODEX_STREAM_DONE_MARKER);
});

test("mapCodexEventSequenceToChatFrames passes errors through the middle of a stream", () => {
  const events = [
    { type: "response.created" },
    { delta: "Start", type: "response.output_text.delta" },
    { message: "mid-stream failure", type: "error" }
  ];

  assert.throws(() => mapCodexEventSequenceToChatFrames(events), /mid-stream failure/u);
});

test("mapCodexEventSequenceToChatFrames tolerates non-array input", () => {
  assert.deepEqual(mapCodexEventSequenceToChatFrames(null), []);
  assert.deepEqual(mapCodexEventSequenceToChatFrames("not-an-array"), []);
});
