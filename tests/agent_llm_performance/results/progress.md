# Progress

Updated: `2026-04-13T09:41:25.909Z`
Generation Id: `2026-04-13T09-41-25-909Z`
Generation: `082A_069A_reliability_surgical / 082B_069A_output_gate_and_reuse / 082C_state_machine_hard_edges`
Model: `openai/gpt-5.4-mini`

- Best overall: `082A_069A_reliability_surgical @ openai/gpt-5.4-mini` with `60/64` strict
- No prompt-model run cleared the strict matrix; closest was `082A_069A_reliability_surgical @ openai/gpt-5.4-mini`
- Wild branch: `082C_state_machine_hard_edges @ openai/gpt-5.4-mini` scored `40/64` and remains exploratory
- Follow-up: `083A` fixed several targeted failures in isolation but regressed to `56/64` on a full-suite one-prompt run; it was not promoted
- Follow-up: lowering `082A` to temperature `0.0` did not remove the remaining pressure-case misses, so sampling alone is not the answer
- Next: keep `082A` as the frontier and target `widget_missing_without_replacement_requires_terminal_truth`, `widget_not_found_error_uses_available_widget_id`, and execution-block formatting without broadening the prompt
