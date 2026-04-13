# Manual Review

## Long-term Signal

- live prompt history matters less than current harness score because the suite has expanded materially since the earlier promotion of `012_open_goal_momentum`
- the useful long-term survivors before the triad workflow were `017_fresh_state_no_reread` and `021_no_immediate_helper_repeat`
- `024B_midline_followthrough` was the first stable enough bridge to promote over the older live prompt, but it still left `write_user_yaml_after_read`
- repeat sampling showed that many one-off passes were unstable, especially on:
  - `time_requires_execution`
  - `weather_self_scope_after_indirect_fail`
  - `create_note_after_user_detail_read`
  - `terminal_after_successful_widget_patch`
- the hardest historical miss was immediate reuse of fresh file text after `fileRead`; `026B_imperative_followthrough` is the first prompt that cleared that case and held up on repeat checks

## Harness Notes

- the harness now supports prompt-case repeat sampling with `--repeat <n>`
- current default workflow is generation-based:
  - create exactly three new prompt variants
  - suffix them `A`, `B`, and `C`
  - `A` = conservative and surgical
  - `B` = moderate conceptual experiment
  - `C` = wild redesign
- generation spread is part of the review contract:
  - `A` should preserve most of the current best prompt
  - `B` should try new mechanisms or framing without throwing away most of the inherited prompt
  - `C` should be willing to replace the narrative, keywords, sections, protocol shape, and overall prompt thesis
- a `C` variant that reads like a stricter rewrite of `A` or `B` is a process failure even if it scores well
- config should usually keep only the active generation in `active_prompts` so leaderboard and latest-run stay generation-sized
- comparison across generations should use `results/history/`, not a permanently growing active matrix
- `results/progress.md` is the quick human-facing status page and should stay brief
- `results/summary.md` is the quick human-facing top-rank page and should stay brief
- this file keeps the durable reasoning that does not fit in `progress.md`
- manual review should keep only:
  - durable long-term survivors
  - the current active generation
  - current open problems

#### suite expansion after `057A` promotion

- the suite now includes `47` active cases
- the new additions cover:
  - weather recovery after a precise geolocation is already known and one weather source fails
  - protocol correction after a successful `openSpace(...)` that returned no result text
  - title-based space removal that must discover the exact target before mutating
  - corrected follow-up after the agent already removed the wrong space
  - direct browser-runtime control when no dedicated helper exists
  - anti-faking checks for canvas screenshot requests
- important case-design lesson from this addition:
  - title-based removal discovery cases must forbid `openSpace(...)` as well as `removeSpace(...)`
  - otherwise a prompt can earn a false pass by discovering spaces and then taking the wrong action family
- focused evaluation of the live prompt `057A_current_code_staging` on the expanded suite landed at `41/47`
- new current miss cluster on that expanded run:
  - `screenshot_after_helper_unavailable_uses_browser_js`
  - `followup_after_screenshot_refusal_requires_browser_js`
  - `download_html_without_helper_uses_browser_js`
  - `canvas_screenshot_requires_real_capture_strategy`
  - `unpack_collapsed_weather_payload`
  - `repeat_do_it_requires_execution`
- focused repeat sampling on the four newly added cases showed:
  - stable passes:
    - `weather_after_precise_location_fetch_error_keeps_location` `3/3`
    - `protocol_correction_after_successful_open_requires_terminal` `3/3`
    - `remove_space_by_title_requires_discovery_first` `3/3`
  - unstable remaining weak spot:
    - `followup_after_wrong_space_removal_requires_discovery_execution` `1/3`
- the new helper-fixation cases show a deeper control problem:
  - `057A` can act directly in some browser-native tasks such as `click_button_without_helper_uses_browser_js`
  - but it still collapses into helper dependency or terminal refusal after helper-unavailable telemetry
  - it can also fake screenshot success by drawing a blank canvas and downloading it unless the case demands a real capture strategy
  - repeat sampling on the helper-fixation cluster:
    - `screenshot_download_without_helper_uses_browser_js` `3/3`
    - `click_button_without_helper_uses_browser_js` `3/3`
    - `screenshot_after_helper_unavailable_uses_browser_js` `0/3`
    - `followup_after_screenshot_refusal_requires_browser_js` `0/3`
    - `download_html_without_helper_uses_browser_js` `0/3`
    - `canvas_screenshot_requires_real_capture_strategy` `1/3`

#### ownership and verification branch after the rate-limit trace

- new case family added for:
  - rendered inspection on known widget target
  - verifying a visible repair before declaring completion
  - continuing repair when visible verification still shows an error
  - refusing to treat partial mitigation as completion
- `061A/061B/061C` proved the direction:
  - `061A_verify_visible_repairs` fixed much of the ownership cluster but regressed old helper and source-reuse strengths
  - `061B` and `061C` were too broad and lost core formatting reliability
- the productive follow-up was `062A_057A_with_verify_loop`, which merged the new ownership traces back into the stronger `057A` baseline
- current best frontier is now `063A_062A_anchor_and_own`
  - one-shot full-suite result on the 53-case suite: `51/53`
  - repeat-3 result on the same suite: `47/53` strict, `150/159` passing attempts
  - it holds `3/3` on the full new ownership cluster:
    - `see_known_widget_after_render_uses_same_target`
    - `fix_visible_widget_error_requires_readwidget`
    - `verify_visible_widget_fix_after_patch`
    - `look_at_it_now_uses_see_widget`
    - `verification_reveals_remaining_widget_error_requires_correction`
    - `partial_mitigation_is_not_completion`
  - it also holds `3/3` on the helper-fixation screenshot cluster
- remaining weak spots on repeat:
  - `unpack_collapsed_weather_payload` `1/3`
  - `write_user_yaml_after_read` `2/3`
  - `repeat_do_it_requires_execution` `2/3`
  - `protocol_nudge_requires_real_thrust` `2/3`
  - `remove_space_by_title_requires_discovery_first` `0/3`
  - `followup_after_wrong_space_removal_requires_discovery_execution` `2/3`

#### suite rebuild after the financials drift trace

- the old suite was rewarding too much protocol shape and too little target anchoring
- the financials trace exposed three real gaps:
  - drifting from an obvious broken current widget into page-shell or space-list inspection
  - treating visible empty values as if they were not a defect
  - promising action after failure and then stalling instead of executing
- the harness now supports `must_match_any` so a case can allow a small explicit set of valid next moves without overfitting to one exact trace
- the suite now includes a new problem family:
  - `active target anchoring and repair momentum`
  - active cases now total `57`
- the four new cases in that family cover:
  - current-widget complaint staying on the known target
  - visible silent failure reopening source repair
  - fresh widget read plus `then do it` forcing patch now
  - patch-error recovery on the same widget instead of prose stall

#### current post-rebuild frontier

- best one-shot prompt on the rebuilt 57-case suite is now `065A_target_anchor_with_debts`
  - one-shot: `55/57`
  - repeat-3 full suite: `47/57` strict, `156/171` attempts
  - token count: `2401`
- the productive gain from `065A` is real:
  - it clears all new active-target anchoring cases in its best one-shot run
  - it also clears the title-based space-discovery recovery pair cleanly
- the repeat miss cluster on `065A` is still broader than the one-shot score suggests:
  - `click_button_without_helper_uses_browser_js` `2/3`
  - `silent_widget_failure_reopens_repair` `1/3`
  - `fresh_widget_read_then_do_it_requires_patch` `2/3`
  - `widget_patch_error_then_do_it_requires_recovery_action` `2/3`
  - `weather_self_scope_followup` `2/3`
  - `reverse_geocode_after_precise_followup` `2/3`
  - `unpack_collapsed_weather_payload` `1/3`
  - `write_user_yaml_after_read` `1/3`
  - `repeat_do_it_requires_execution` `0/3`
  - `post_success_followup_requires_execution_or_completion` `2/3`
- `066A_debt_router_trimmed` is the current compact follow-up worth keeping in view:
  - one-shot: `52/57`
  - token count: `1350`
  - it kept the new anchoring fixes but regressed stop-after-success and execution-shape reliability

#### `070` through `075` sweep and final promotion choice

- `069A_handoff_no_copy` remained the best overall prompt after the full `070` through `075` generation sweep
  - one-shot frontier on the 57-case suite: `57/57`
  - full-suite repeat-3 finalist rerun: `51/57` strict, `163/171` attempts
- strongest alternate branch from the sweep was `072A_loaded_target_examples`
  - one-shot: `55/57`
  - repeat-3 finalist rerun: `49/57` strict, `157/171` attempts
  - useful lesson:
    - extra loaded-target examples fixed `repeat_do_it_requires_execution`
    - but they destabilized simpler browser-action and read-first cases too much to win overall
- the other `070` through `075` variants either regressed broad execution-shape reliability or widened terminal-vs-thrust instability
- live promotion decision after generation `075`:
  - promote `069A_handoff_no_copy`
  - reason:
    - it still holds the best combination of one-shot breadth and repeat stability on `openai/gpt-5.4-mini`
    - no later branch beat it overall

#### suite expansion after the weather-layout trace

- the suite now includes `60` active cases
- the new cases cover:
  - direct recovery from a wrong widget id when framework telemetry already listed the real widget id
  - visible layout patches that must verify before `Done.`
  - reopening the same widget when a partial visible layout fix is called out with more broken subparts
- important design lesson from this addition:
  - layout and styling requests are visible-output tasks too; success telemetry alone is not enough
  - framework-disclosed ids are strong recovery signal and should be tested directly instead of rewarding extra rediscovery

#### current best on the expanded 60-case suite

- `069A_handoff_no_copy` is still the best overall prompt on the expanded suite
  - one-shot: `56/60`
  - remaining one-shot misses on the first expanded run:
    - `click_button_without_helper_uses_browser_js`
    - `terminal_after_successful_retry_patch`
    - `partial_layout_fix_followup_requires_same_widget_repair`
    - `repeat_do_it_requires_execution`
- focused repeat sampling on that miss cluster showed the misses are real stability problems, not just one lucky matrix run:
  - `click_button_without_helper_uses_browser_js` `4/5`
  - `terminal_after_successful_retry_patch` `4/5`
  - `partial_layout_fix_followup_requires_same_widget_repair` `3/5`
  - `repeat_do_it_requires_execution` `2/5`

#### `076` generation

- `076A_subparts_inherit_target`: `52/60`
- `076B_target_identity_inheritance`: `43/60`
- `076C_target_register_loop`: `44/60`
- useful signal:
  - the new target-inheritance wording can stabilize the partial layout follow-up
- failure mode:
  - broad exact-id and register rewrites reopened too many older terminal-vs-thrust and ownership cases

#### `077` generation

- `077A_surgical_followup_and_stop`: `51/60`
- `077B_exact_id_then_same_widget`: `44/60`
- `077C_finish_or_fix_loop`: `45/60`
- useful signal:
  - `077A` fixed `terminal_after_successful_retry_patch`
  - `077A` also held the new `partial_layout_fix_followup_requires_same_widget_repair` case in its best run
- failure mode:
  - even the conservative `077A` reopened too many old read-first, weather-follow-up, and recovery cases to challenge `069A`

#### focused `078A` follow-up

- `078A_minimal_partial_followup_fix` was a one-off surgical follow-up, not a full triad
- one-shot on the expanded suite: `56/60`
  - tied `069A` on raw one-shot score

#### multi-model harness readiness and first comparison

- the harness now supports explicit model comparison without changing the case or prompt set:
  - config defaults can list one or more models under `run.active_models`
  - ad hoc comparisons can use `--model <id>` or `--models <id1,id2,...>`
  - saved prompt summaries and history artifacts now keep `model_id` so scores do not collapse across models
- first direct comparison run on the live prompt `069A_handoff_no_copy` and the current 60-case suite:
  - `openai/gpt-5.4-mini`: `58/60`
  - `google/gemma-4-31b-it`: `58/60`
- miss shape differs even though the topline score ties:
  - `openai/gpt-5.4-mini` missed:
    - `repeat_do_it_requires_execution`
    - `post_success_followup_requires_execution_or_completion`
  - `google/gemma-4-31b-it` missed:
    - `download_html_without_helper_uses_browser_js`
    - `verify_visible_layout_patch_before_done`
- current interpretation:
  - `openai/gpt-5.4-mini` is still stronger on helperless browser-runtime behavior and visible verification discipline
  - `google/gemma-4-31b-it` is comparatively stronger on the stubborn post-success and `do it` continuation cases in this run
  - gemma is therefore competitive on topline score, but not yet a clean upgrade over the current GPT mini baseline
- focused repeat comparison versus `069A`:
  - `terminal_after_successful_retry_patch`
    - `069A`: `4/5`
    - `078A`: `5/5`
  - `partial_layout_fix_followup_requires_same_widget_repair`
    - `069A`: `3/5`
    - `078A`: `5/5`
  - `click_button_without_helper_uses_browser_js`
    - `069A`: `4/5`
    - `078A`: `4/5`
  - `repeat_do_it_requires_execution`
    - `069A`: `2/5`
    - `078A`: `1/5`
- conclusion:
  - `078A` improved the two new weather-trace failures we actually targeted
  - but it did not improve the old stale-staging case and introduced new one-shot misses elsewhere
  - that is not enough to replace `069A`

#### next prompt thesis

#### suite expansion after the teapot and crypto recovery trace

- the suite now includes `64` active cases
- the four new synthetic cases cover:
  - live-fact double checks that must re-fetch instead of restating stale BTC/ETH values
  - whole-page clarification after an initial space-vs-page misunderstanding
  - explicit framework contract correction from `patchWidget(...)` to `renderWidget(...)` for full widget rewrites
  - truthful terminal handling when a widget code check fails and framework offers no replacement target
- important case-design lesson from this addition:
  - when framework explicitly prescribes the correct next mutation API, the benchmark should require that contract switch directly instead of only rewarding vague same-target recovery
  - when a specific target disappears and telemetry lists no replacement id, terminal truth is the right behavior class; unrelated rediscovery is drift

#### `080` generation on the expanded 64-case suite

- `080A_target_fate_contracts`: `55/64`
- `080C_scope_board`: `48/64`
- `080B_target_fate_registers`: `43/64`
- strongest signal:
  - `080A` fixed the new transcript-driven failures we actually targeted:
    - `live_fact_double_check_requires_refetch`
    - `full_widget_rewrite_after_patch_rewrite_error_uses_renderwidget`
    - `widget_missing_without_replacement_requires_terminal_truth`
  - it also kept broader read-first and same-target recovery strength across most of the existing suite
- baseline comparison on the same 64-case suite:
  - `069A_handoff_no_copy`: `56/64`
  - conclusion:
    - `080A` is not a promotion yet
    - it bought the new rewrite-boundary and target-collapse behavior, but it gave back too much on older stop-and-reopen cases
- current open miss cluster for the next generation:
  - `whole_page_flip_after_scope_clarification_uses_dom_root`
  - `silent_widget_failure_reopens_repair`
  - `reverse_geocode_after_precise_followup`
  - `unpack_collapsed_weather_payload`
  - `terminal_after_successful_widget_patch`
  - `terminal_after_successful_retry_patch`
  - `direct_repair_after_known_widget_error`
  - `remove_space_by_title_requires_discovery_first`
- next prompt thesis:
  - start from `069A`, not `080A`
  - add only the three transcript-proven gains:
    - whole-page scope correction
    - explicit `renderWidget(...)` rewrite recovery
    - terminal truth after target collapse with no replacement id
  - avoid importing the broader target-fate language that reopened older terminal-vs-thrust and same-widget recovery cases

- keep `069A` as the live baseline on the 60-case suite
- next serious candidate should merge only two proven gains:
  - the retry-success stop rule from `078A`
  - the partial visible follow-up rule from `078A`
- while also restoring the loaded-target-after-prose-slip behavior that matters for `repeat_do_it_requires_execution`
- do not widen exact-id or target-register rewrites until a conservative branch proves those gains without reopening the old terminal and ownership misses

## Current Frontier

### 2026-04-06 expanded 37-case suite

- model: `openai/gpt-5.4-mini`
- matrix mode:
  - prompts run in parallel
  - cases run in parallel
  - temperature `0.2`

#### `036A_nonempty_completion`

- current best overall score: `34/37`
- reasons it stayed ahead:
  - strongest balance of execution-first behavior and stop-after-success behavior on the expanded suite
  - handled the new telemetry-as-data family once the suite added those synthetic cases
- remaining miss cluster from its best run:
  - `weather_self_scope_after_indirect_fail`
  - `write_user_yaml_after_read`
  - `selective_yaml_edit_requires_read_first`

#### harness correction after `036`

- `write_user_yaml_after_read` exposed a harness problem, not just a prompt problem
- valid replies were embedding fresh `result↓` file text inside code for the next write, but the case incorrectly forbade that text anywhere in the full reply
- the harness now supports `must_not_contain_before_separator` and `must_not_match_before_separator` so prose leakage can be penalized without falsely rejecting valid code

#### `038A/038B/038C`

- scores:
  - `038A_inspect_lock_priority`: `32/37`
  - `038B_stage_debt`: `31/37`
  - `038C_scout_strike_seal`: `21/37`
- useful gain:
  - the generation fixed the direct current-context escalation plus selective read-first pressure points in focused repeat sampling
- main regression:
  - the conservative and moderate variants reopened older execution-first and widget follow-through misses in the full matrix
  - the wild variant stayed too unstable outside the focused cluster

#### `039A/039B/039C`

- scores:
  - `039A_followthrough_restore`: `30/37`
  - `039B_next_action_obligation`: `30/37`
  - `039C_modes_and_debts`: `30/37`
- lesson:
  - restoring one miss cluster too aggressively caused broad regression into terminal caveats or misplaced completion
  - `039` did not move the frontier

#### compact frontier after `040` to `047`

- the useful new result from these generations is not a new overall score winner but a new score-per-token frontier
- best compact prompts so far:
  - `045B_open_task_examples`: `33/37` at `870` tokens
  - `044A_example_router_guarded`: `33/37` at `907` tokens
  - `043C_example_router`: `31/37` at `725` tokens
- important lesson:
  - the example-router family works much better than the shorter lock or closure mini-prompts
  - direct examples for open-task behavior are carrying the compact prompts
  - heavy top-level "closed task first" rewrites in `046` and `047` regressed because they weakened open-task execution pressure
- practical base for future compact work:
  - use `045B_open_task_examples` as the compact baseline
  - borrow only very small closure fixes from later generations
  - do not replace the whole open-task router with a closure-first thesis

#### `044A/045B`

- `044A_example_router_guarded`
  - score: `33/37`
  - tokens: `907`
  - strengths:
    - strongest compact balance across live facts, selective reads, widget continuation, and navigation
  - weakness:
    - still somewhat brittle on selective-edit and closure follow-through in repeat-sensitive cases
- `045B_open_task_examples`
  - score: `33/37`
  - tokens: `870`
  - strengths:
    - best current reliability-per-token tradeoff
    - cleared the whole live-fact and inspect-first cluster in its best run
  - remaining miss family:
    - post-success stop behavior and telemetry-as-data after success

#### `046` and `047`

- both generations tested whether a stronger closure-first narration could eliminate the last `045B` misses
- result:
  - the closure-heavy rewrites regressed the open-task routing that made the compact family good
  - `047A_open_task_plus_closed_examples` reached only `30/37`
  - `046A/046B/046C` regressed harder
- decision:
  - keep `045B_open_task_examples` as the compact frontier
  - keep `044A_example_router_guarded` as the slightly larger sibling frontier
  - future work should make surgical edits on top of `045B`, not continue the `046` or `047` branch
  - after the `047` regression, the default active prompt triad in `config.yaml` was reset to `045A/045B/045C` for the next iteration branch

#### compact trace frontier after `048` to `060`

- the productive branch after `045B` was not more abstract control language, it was richer trace examples
- the strongest compact family is now the trace-router branch:
  - `054A_trace_router_inspect_first`: `36/37` at `941` tokens
  - `057A_current_code_staging`: `36/37` at `1037` tokens
  - `052B_trace_router`: `33/37` at `794` tokens
- useful lessons from this branch:
  - example traces for exact-run completion, reopened work, and inspect-first behavior are more effective than adding more protocol jargon
  - minimal current-code wording helped stale-staging recovery, but it could easily destabilize unrelated weather or file cases when over-applied
  - the best compact prompts are now clearly ahead of the old `045B` frontier

#### `054A_trace_router_inspect_first`

- best one-shot compact prompt so far
- score: `36/37`
- tokens: `941`
- remaining one-shot miss:
  - `repeat_do_it_requires_execution`
- repeat-3 result across the full 37-case suite:
  - `30/37` strict
  - `103/111` passing attempts
- interpretation:
  - extremely strong broad behavior, but a little too willing to reuse stale staging prose in repeat sampling

#### `057A_current_code_staging`

- matched the top compact one-shot score while improving repeat stability
- score: `36/37`
- tokens: `1037`
- remaining one-shot miss:
  - `unpack_collapsed_weather_payload`
- repeat-3 result across the full 37-case suite:
  - `33/37` strict
  - `105/111` passing attempts
- interpretation:
  - current best reliability candidate for `gpt-5.4-mini`
  - slightly larger than `054A`, but materially steadier under repeat sampling

#### `059` and `060`

- these generations were stability finals, not broad search
- `059A_current_code_plus_unpack` hit `35/37` and showed the unpack fix is compatible with the trace family, but it reopened file-recovery and staging-repeat issues
- `060A_054A_stale_invalid` landed `34/37`; the stale-staging warning alone was not enough to beat the existing frontiers
- conclusion:
  - `054A` remains the best one-shot compact prompt
  - `057A` is the better repeat-stable compact prompt
  - the remaining work is no longer broad routing; it is a narrow stability problem on a few flaky cases

## Decision

- do not promote a new live firmware prompt from this batch yet
- the old live-prompt decision recorded here is no longer the frontier; current work moved beyond `036A`
- current best compact candidates are:
  - best one-shot: `054A_trace_router_inspect_first` at `36/37`, `941` tokens
  - best repeat-stable: `057A_current_code_staging` at `36/37` one-shot, `33/37` strict on repeat-3, `105/111` attempts, `1037` tokens
- current best small-token frontier is:
  - `052B_trace_router` at `33/37`, `794` tokens
- `057A_current_code_staging` is the best overall promotion choice because reliability on `gpt-5.4-mini` is more important than the slightly smaller one-shot winner
- next useful target is narrow stability work on:
  - stale-staging recovery after sentence-only assistant turns
  - collapsed payload unpack follow-through
  - a few repeat-sensitive inspect-first and telemetry-as-data edge cases
  - corrected follow-up after removing the wrong space from a title-based request

## 2026-04-13 extended 64-case follow-up

#### `081` to `082`

- the first expanded 64-case frontier after the history-derived additions was still too unstable
- `081A_069A_scope_and_collapse_surgical` hit `60/64` in its best one-shot run but reran at `58/64`
- `082A_069A_reliability_surgical` kept the same best one-shot ceiling at `60/64` while fixing the newly added transcript-derived cases more directly
- decision:
  - keep `082A` as the saved frontier for now because it is the best validated prompt on the expanded suite
  - do not promote it yet because the remaining misses are still stochastic enough to matter

#### `083` targeted overfit branch

- `083A_082A_replacement_and_parent_task` was built to fix four specific `082A` misses:
  - `partial_mitigation_is_not_completion`
  - `widget_not_found_error_uses_available_widget_id`
  - `weather_after_place_prerequisite`
  - screenshot syntax drift
- targeted repeat probes showed real local gains:
  - `partial_mitigation_is_not_completion`: `5/5`
  - `weather_after_place_prerequisite`: `5/5`
  - `widget_missing_without_replacement_requires_terminal_truth`: `5/5`
  - `screenshot_download_without_helper_uses_browser_js`: `5/5`
- but the broader prompt drift was worse than the local wins
- a full-suite single-prompt run for `083A` fell to `56/64`
- the regressions reopened simple execution cases such as:
  - page-title execution
  - current-time execution
  - collapsed weather unpack continuation
  - simple inspect-after-read formatting
- interpretation:
  - adding explicit parent-task and replacement-target examples helped the intended cases
  - but the extra example surface contaminated simpler execution traces
- decision:
  - reject `083A` as the new frontier
  - keep `082A` active in `config.yaml`

#### `083C` focused probe

- `083C_router_with_parent_task` was materially better than `082C` on the targeted cluster
- it stabilized:
  - screenshot download
  - replacement-id reuse
  - weather continuation after place lookup
- but it still failed the two most important truth-and-reopen cases:
  - `widget_missing_without_replacement_requires_terminal_truth`
  - `partial_mitigation_is_not_completion`
- decision:
  - treat `083C` as useful evidence for future routing simplification
  - do not run it as the active frontier until its truth and reopen behavior is repaired

#### temperature probe on `082A`

- the remaining `082A` misses looked partly stochastic, so a targeted `temperature: 0.0` probe was run on the same `openai/gpt-5.4-mini` prompt
- result on the 10-case pressure cluster:
  - several formatting-sensitive cases improved to `5/5`
  - but core misses remained, including:
    - `widget_missing_without_replacement_requires_terminal_truth`
    - `partial_mitigation_is_not_completion`
    - `widget_not_found_error_uses_available_widget_id`
    - `weather_after_place_prerequisite`
- interpretation:
  - lower sampling reduced some formatting variance
  - it did not solve the actual control-flow weaknesses
- decision:
  - do not treat temperature reduction alone as the fix
  - keep the leaderboard on the standard `0.2` track for now
