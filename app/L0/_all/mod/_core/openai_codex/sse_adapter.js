export const CODEX_STREAM_DONE_MARKER = "[DONE]";

const IGNORED_EVENT_TYPES = new Set([
  "response.audio.delta",
  "response.audio.done",
  "response.audio_transcript.delta",
  "response.audio_transcript.done",
  "response.code_interpreter_call_code.delta",
  "response.code_interpreter_call_code.done",
  "response.code_interpreter_call.completed",
  "response.code_interpreter_call.in_progress",
  "response.code_interpreter_call.interpreting",
  "response.content_part.added",
  "response.content_part.done",
  "response.created",
  "response.custom_tool_call_input.delta",
  "response.custom_tool_call_input.done",
  "response.file_search_call.completed",
  "response.file_search_call.in_progress",
  "response.file_search_call.searching",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.image_gen_call.completed",
  "response.image_gen_call.generating",
  "response.image_gen_call.in_progress",
  "response.image_gen_call.partial_image",
  "response.in_progress",
  "response.mcp_call.completed",
  "response.mcp_call.failed",
  "response.mcp_call.in_progress",
  "response.mcp_call_arguments.delta",
  "response.mcp_call_arguments.done",
  "response.mcp_list_tools.completed",
  "response.mcp_list_tools.failed",
  "response.mcp_list_tools.in_progress",
  "response.output_item.added",
  "response.output_item.done",
  "response.output_text.done",
  "response.output_text_annotation.added",
  "response.queued",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.reasoning_text.delta",
  "response.reasoning_text.done",
  "response.refusal.done",
  "response.web_search_call.completed",
  "response.web_search_call.in_progress",
  "response.web_search_call.searching"
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildTextDeltaFrame(delta) {
  return {
    choices: [
      {
        delta: { content: delta },
        index: 0
      }
    ]
  };
}

function buildFinishFrame(finishReason, usage) {
  const frame = {
    choices: [
      {
        delta: {},
        finish_reason: finishReason,
        index: 0
      }
    ]
  };

  if (usage && isObject(usage)) {
    frame.usage = {
      completion_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
      prompt_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
      total_tokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : 0
    };
  }

  return frame;
}

function readEventType(event) {
  if (!isObject(event)) {
    return "";
  }

  return typeof event.type === "string" ? event.type : "";
}

function readErrorMessage(event) {
  if (!isObject(event)) {
    return "Codex stream failed with an unknown error.";
  }

  if (typeof event.message === "string" && event.message) {
    return event.message;
  }

  const nestedError = event.response?.error;

  if (isObject(nestedError) && typeof nestedError.message === "string" && nestedError.message) {
    return nestedError.message;
  }

  return "Codex stream failed without an error message.";
}

export function mapCodexEventToChatFrames(event) {
  const eventType = readEventType(event);

  if (!eventType) {
    return [];
  }

  if (IGNORED_EVENT_TYPES.has(eventType)) {
    return [];
  }

  switch (eventType) {
    case "response.output_text.delta":
    case "response.refusal.delta": {
      const delta = typeof event.delta === "string" ? event.delta : "";

      if (!delta) {
        return [];
      }

      return [buildTextDeltaFrame(delta)];
    }

    case "response.completed": {
      const usage = event.response?.usage;
      return [buildFinishFrame("stop", usage), CODEX_STREAM_DONE_MARKER];
    }

    case "response.incomplete": {
      const reason = event.response?.incomplete_details?.reason;
      const finishReason =
        reason === "max_output_tokens"
          ? "length"
          : reason === "content_filter"
            ? "content_filter"
            : reason === "max_tokens"
              ? "length"
              : typeof reason === "string" && reason
                ? reason
                : "length";
      const usage = event.response?.usage;

      return [buildFinishFrame(finishReason, usage), CODEX_STREAM_DONE_MARKER];
    }

    case "response.failed":
    case "error": {
      throw new Error(readErrorMessage(event));
    }

    default:
      // Unknown event type - skip silently so future Codex additions do not break streaming.
      return [];
  }
}

export function mapCodexEventSequenceToChatFrames(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  const frames = [];

  for (const event of events) {
    const eventFrames = mapCodexEventToChatFrames(event);

    for (const frame of eventFrames) {
      frames.push(frame);
    }
  }

  return frames;
}
