# AGENTS

## Purpose

`tests/agent_llm_performance/` owns prompt-performance evaluation for the onscreen agent LLM

It exists to compare firmware prompt variants against prepared multi-turn histories and score whether the model executes, continues, and avoids burdening the human user

## Ownership

This scope owns:

- `config.yaml`: provider model and path config for the harness
- model selection and model-comparison workflow for this harness
- `test.mjs`: CLI runner for single-call and matrix evaluation
- `prompts/*.md`: system-prompt variants under test
- `histories/*.json`: prepared chat histories sent to the model after the system prompt
- `cases/*.json`: deterministic expectations mapped to a prepared history
- `results/history/*/`: rolling archive of recent generation snapshots
  default policy may keep the full long-term archive
- `results/leaderboard.yaml`: sorted prompt ranking summary
- `results/latest-run.json`: latest raw run artifact
- `results/progress.md`: short human-readable generation status page
- `results/summary.md`: short top-level ranking page for the current best overall prompts
- `results/manual-review.md`: human review notes for nominal passes and promotion decisions
- `case-coverage.md`: higher-level map of problem categories and the cases assigned to them

## Local Contracts

- prompt files are standalone system prompts and are ranked by filename id plus saved results, not by hidden script state
- prompt generations should usually be created as triads:
  - `NNNA_*` = conservative changes
  - `NNNB_*` = middle changes
  - `NNNC_*` = wild changes
- triad roles are strict:
  - `A` must keep most of the current best prompt and apply only surgical edits
  - `B` must keep the prompt recognizably related but replace or add meaningful concepts, framing, or structure
  - `C` must be a genuinely wild redesign and should treat the current prompt as disposable input, not as the default template
- `C` must be allowed to replace the narration, keywords, sections, protocol shape, ordering, length, and overall control metaphor
- `C` is not valid if it is only a louder, stricter, or slightly reorganized version of `A` or `B`
- history files are prepared chat message arrays and exclude the system prompt
- case files point at one history and define deterministic response-shape assertions
- case files may scope some forbidden-text assertions to prose before `_____javascript` when literal source text is valid inside code; use `must_not_contain_before_separator` or `must_not_match_before_separator` for that case
- case files may use `must_match_any` when more than one next move is acceptable and the harness should reward a small explicit set of valid actions instead of one brittle exact trace
- every case should have one primary problem category tracked in `case-coverage.md`
- `test.mjs` must support direct one-off calls with `--system <file> --history <file>`, one-prompt runs with `--prompt-id <id>`, focused prompt-case runs with `--prompt-id <id> --case-id <id>`, prompt-case repeat sampling with `--repeat <n>`, and config-driven matrix runs with no arguments
- `test.mjs` must support model comparison by config and CLI
  - `run.active_models` is the default model list for config-driven runs
  - `--model <id>` runs one explicit model override
  - `--models <id1,id2,...>` runs the same prompt or matrix across multiple models for comparison
  - `run.model_concurrency` and `--model-concurrency <n>` control parallelism across models
- the harness must load `OPENROUTER_API_KEY` from process env or the repo root `.env`
- the harness must call OpenRouter with `openai/gpt-5.4-mini` by default from `config.yaml`
- the harness temperature must stay explicit in `config.yaml`; current evaluations run at `0.2`
- the harness retry policy must stay explicit in `config.yaml`; current parallel runs use request retries with backoff instead of aborting the whole matrix on the first transport miss
- the harness must not execute assistant `_____javascript`; it only evaluates assistant outputs against case criteria
- thrust-style cases should require syntactically valid javascript after `_____javascript` when the agent is expected to execute
- matrix runs must execute prompt triads in parallel and cases in parallel unless concurrency is intentionally capped by config or CLI
- multi-model matrix runs must preserve the model id on every case result, prompt summary, leaderboard entry, and saved history artifact
- results must stay resumable: the latest raw run and the sorted leaderboard should be written to disk after matrix runs
- every full generation matrix run must also refresh `results/progress.md`
- every full generation matrix run must also refresh `results/summary.md`
- result retention must keep the latest files plus an archive under `results/history/`
- archive retention policy must stay explicit in `config.yaml`; `all` is allowed when long-term comparison value matters
- matrix runs should capture per-case request errors as failed case results so the run artifact remains inspectable
- automated pass is not final validation; nominal passes must still be manually reviewed before promoting a prompt into the live firmware prompt
- `results/progress.md` must stay short and human-readable:
  - overall generation status
  - best score
  - overall best prompt too when the newest generation regressed
  - when one-shot and repeat-stable leaders differ, show both explicitly
  - one or two short lines about what is happening and what comes next
- `results/summary.md` must stay short and current:
  - top overall prompts
  - their scores
  - when multiple models are active, include the model id in leaderboard labels
  - when useful, distinguish best one-shot from best repeat-stable
  - one short explanation for what each prompt is trying to do well
- `results/manual-review.md` should stay concise even when `results/history/` keeps the full long-term archive
- `case-coverage.md` must stay current when cases are added removed or reclassified
- when prompt wording, case assertions, or scoring rules change, update this doc and regenerate results in the same session

## Development Guidance

- prefer adding new failures as prepared histories and assertions before changing scoring code
- when a real conversation exposes a logic bug, distill it into the shortest history that still reproduces the control-flow mistake
- keep case assertions aimed at behavior class, continuation logic, target reuse, and stop conditions rather than exact domain phrasing
- avoid overfitting the suite to one domain; keep a mix of live facts, widget edits, file edits, and recovery cases
- when adding cases, check `case-coverage.md` first so the suite grows by problem-family signal rather than by random accumulation
- when a discovery-only first step is the contract, forbid adjacent wrong action families too, not just the originally observed mistake
  - example: a title-based removal case should usually forbid both `removeSpace(...)` and `openSpace(...)` in the first step
- when the failure pattern is helper fixation, add browser-native cases that explicitly reward direct DOM or canvas or blob primitives
  - do not only test the absence of helper names; also require evidence of a plausible direct runtime strategy
- screenshot cases must distinguish real capture strategies from fabricated placeholder images
  - canvas plus download alone is not enough
  - require some evidence of actual capture such as DOM serialization, foreignObject, `drawImage(...)`, `html2canvas`, or media capture
- for broken-runtime cases, add explicit ownership checks:
  - when the user asks to look, require a real inspection helper instead of a stale summary
  - when the agent patched a visible defect, require a verification step before completion
  - when verification still shows an error, require more repair work instead of explanation or partial credit
- treat framework-disclosed target identities as first-class recovery signal
  - if an error lists the concrete widget id or space id needed next, prefer a case that requires direct reuse of that listed target instead of rediscovery
- treat explicit framework contract corrections as benchmark-worthy recovery signal
  - if telemetry tells the agent the correct next mutation surface such as `renderWidget(...)` instead of `patchWidget(...)`, prefer a case that requires that contract switch directly
- when a specific target read fails and telemetry offers no replacement id, add a terminal-truth case instead of rewarding unrelated rediscovery or stale summaries
- treat visible layout or styling work as verification-bearing output, not as a special exempt class
  - if the user asked for grid, resize, alignment, spacing, or other visible widget layout changes, success telemetry alone is not enough
- include synthetic framework or tool outputs when they expose control-flow mistakes; telemetry that contains words like continue, retry, open, or run again must still be treated as data unless it is an actual protocol-correction block
- prefer testing protocol failures such as malformed act turns, unsolicited extra execution, or failure to stop after success over domain-specific syntax mistakes inside the target artifact
- keep assertions simple enough to audit without another model
- when more than one next move is genuinely valid, prefer `must_match_any` over cloning near-duplicate cases or forcing one arbitrary trace
- when a valid write needs to embed fresh `result↓` text literally in code, do not forbid that source text globally across the whole reply; scope the prohibition to pre-execution prose instead
- use exact literals only when the literal itself is the contract-critical value from the history, not as a shortcut for judging the whole behavior
- add new prompt variants as new markdown files instead of overwriting previous variants
- compare new ideas as `A/B/C` triads instead of serial single-prompt edits
- when building a triad, decide the spread before writing:
  - `A` = preserve most wording and logic, fix one or two suspected weaknesses
  - `B` = test a new mechanism or framing while keeping most of the inherited prompt
  - `C` = start from a fresh prompt thesis and rebuild from that thesis even if most old sections disappear
- do not let all three variants share the same narrative, keyword family, or section layout by inertia
- use `C` to test alternative prompt philosophies, not just alternative wording
- keep `config.yaml` focused on the active generation; historical prompt files can stay on disk without cluttering the default matrix
- use `results/history/` for cross-generation comparison instead of keeping every old prompt active in the matrix
- rerun promising variants after harness changes or important prompt edits because one lucky matrix run is not enough
- use `--repeat` on flaky cases before treating a one-off pass as meaningful
- when the frontier narrows to a few serious candidates, run full-suite repeat sampling on those finalists and record both strict repeated score and total passing attempts
- inspect raw outputs for nominal passes; a prompt can satisfy a shallow case while still pursuing the wrong subgoal
- treat token cost as a first-class evaluation axis alongside score:
  - measure prompt token counts with the local tokenizer in the same session
  - when two prompts are near-tied, prefer the smaller prompt if repeat stability is not worse
  - record major score-per-token frontiers in `results/manual-review.md`
- when comparing models, keep the suite and prompt set constant unless the comparison itself is specifically about a harness change
- do not merge score history across models under one prompt id; model id is part of the leaderboard identity
- during manual review, reject a nominally good `C` if it is not actually wild enough to expand the search space
- when a prompt variant wins, sync the proven changes back into the live onscreen firmware prompt deliberately rather than implicitly, and only after manual review agrees with the automated score
