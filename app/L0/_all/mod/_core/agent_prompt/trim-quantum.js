// Quantization grid for the long-message-trim cut position.
//
// The onscreen-agent trimmer plans `removeChars` from the live overflow
// budget on every turn. Because the budget drifts as the history grows, the
// planned cut position shifts by a small number of characters from one turn
// to the next, even when the underlying message content is unchanged. For
// inference backends that reuse a prefix prompt cache (llama.cpp
// `--prompt-cache`, qwen serve, vLLM prefix cache, etc.) every byte after
// that shifting cut becomes a cache miss, which turns a 10-second warm
// reply into a multi-minute full prompt re-prefill on long-context Talk
// sessions.
//
// Snapping the planned cut to a fixed grid keeps the byte position of the
// cut stable across the vast majority of turns. The cut only moves when
// the underlying drift exceeds one full quantum step, which empirically
// happens far less often than once per realistic session.
//
// The grid width is chosen large enough to absorb the per-turn drift
// observed in long Talk sessions (tens of characters per turn) by orders
// of magnitude, while staying small enough that the first trim of a
// message does not waste a meaningful share of the budget.
export const LONG_MESSAGE_CUT_QUANTUM_CHARS = 4096;

// Round a planned `removeChars` value up to the next multiple of the cut
// quantum. Returns 0 unchanged so the trim path can still represent the
// "no trim yet" state, and clamps non-positive inputs to 0.
export function quantizeRemovedChars(value, quantum = LONG_MESSAGE_CUT_QUANTUM_CHARS) {
  const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.ceil(Number(value))) : 0;
  const normalizedQuantum = Number.isFinite(Number(quantum)) && Number(quantum) > 0
    ? Math.max(1, Math.floor(Number(quantum)))
    : LONG_MESSAGE_CUT_QUANTUM_CHARS;

  if (!normalizedValue) {
    return 0;
  }

  return Math.ceil(normalizedValue / normalizedQuantum) * normalizedQuantum;
}
