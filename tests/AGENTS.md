# AGENTS

## Purpose

`tests/` owns repo-level verification harnesses and evaluation fixtures

Keep test workflows explicit scriptable and isolated from app runtime behavior unless a test explicitly targets that runtime

## Ownership

This scope owns:

- repo-level test harnesses under `tests/`
- `browser_component_harness_cli.mjs`: interactive and one-shot CLI wrapper around the standalone Electron browser-component harness; it launches the harness with parent IPC, buffers harness console output for the explicit `log` command instead of streaming it by default, prints `content` results as raw readable markdown, applies a 10-second timeout to harness readiness plus every IPC browser command so stuck requests fail fast instead of freezing the terminal, and lets operators call browser methods such as `open`, `state`, `dom`, `content`, `detail`, `click`, `type`, `typeSubmit`, `submit`, `scroll`, `back`, `forward`, and `reload`
- `browser_address_bar_test.mjs`: focused browser-harness regression coverage for browser-like address-bar normalization so bare-host `open` input such as `localhost:3000` resolves to a real browser destination instead of an app-relative path
- `browser_content_format_test.mjs`: focused browser-harness regression coverage for the lean typed-ref `content(...)` format, including image refs, URL fallback labels for empty links or images, compact state or semantic tags such as `[disabled muted button N]` or `[checked checkbox N]`, cheap visual-lite hidden-content filtering for `hidden`, `aria-hidden`, `display:none`, `visibility:hidden|collapse`, `content-visibility:hidden`, and `opacity:0` subtrees while still preserving visible `display: contents` descendants, dialog or structural containers with handler metadata staying readable instead of collapsing their whole body into one ref, low-token `[link N]` or `[button N]` or `[image N]` markers that still support `detail(...)`, action-result payloads that distinguish real visible reactions from no-op retries through `action.status` and `action.effect`, Trusted Types pages where helper-backed readable capture must fall back to live DOM instead of failing outright, and late same-document navigations that must not strand the harness bridge before a later `content(...)` read
- `browser_runtime_navigation_wait_test.mjs`: focused real-app browser-store regression coverage for stale post-navigation snapshots, ensuring unobserved pending navigations do not query or trust the old guest bridge and `space.browser.navigate(...)` waits for an observed browser-side navigation before returning the settled state snapshot
- `browser_window_persistence_test.mjs`: focused real-app browser-store regression coverage for persisted browser-window restoration, generic inline `<x-browser>` surface registration, URL normalization outside popup windows, reload restoring URLs plus geometry and minimized state from browser-local storage, clamping restored windows back onto the current viewport, the shared fit pass on live resize, persisted snapshots staying in sync with those fitted bounds, and browser windows raising to the top when their iframe or desktop webview content surface receives direct focus
- `desktop_browser_harness.mjs`: shared Node wrapper that launches the standalone browser-component harness under Electron, optionally under Xvfb, and returns structured JSON scenario results
- `browser_harness_cli_test_utils.mjs`: shared local HTTP server helpers plus browser-component harness launch, IPC command, and shutdown helpers used by focused browser tests without routing everything through the human CLI wrapper
- `browser_desktop_harness_test.mjs`: regression coverage for the standalone browser-component harness against the Novinky consent flow
- `browser_skill_contract_test.mjs`: focused frontend-skill coverage for the onscreen `browser-manager` auto-load metadata, the `browser-control` `browser:open` auto-load gate, and the browser overlay `x-context` export that makes that gate work
- `customware_git_history_test.mjs`: focused server-side harness for optional writable-layer Git history, adaptive debounce rules, primary-owned scheduling, per-repo queue serialization, repository discovery, pagination, nested filename filters with full file metadata, diff reads, operation previews, revert, ignore rules, rollback or forward-travel preservation, filtered-list `total: null` behavior, explicit `409` revert-conflict coverage, successful non-overlapping isomorphic revert coverage, and runtime-param-selected isomorphic-backend coverage for Time Travel diff, preview, rollback, and revert flows
- `desktop_packaging_test.mjs`: focused packaging-runtime coverage for the packaged desktop host storage overrides so bundled desktop builds keep transient temp artifacts under a writable OS temp root, preserve the rebrand-stable packaged `userData` tree, keep backend-only auth fallback data under that user-data root instead of the installed app tree, keep the packaged updater log rooted at `<userData>/logs/desktop-updater.log`, keep Windows on the stock direct updater handoff while hardening the NSIS installer-side running-app shutdown path, detect malformed Windows updater metadata that omits the current arch installer and preserve the canonical fallback asset naming used to recover from it, stage same-version or downgrade debug reinstalls against canonical GitHub Release metadata, and clean stale updater `pending/` payloads after a marked install handoff without deleting reusable cache metadata
- `extensions_load_request_shape_test.mjs`: focused frontend-loader request-shape coverage for top-level `maxLayer`, ordered grouped `patterns`, and grouped `extensions_load` responses without synthetic transport keys
- `assistant_message_evaluation_test.mjs`: focused frontend agent-runtime coverage for repeated-assistant-message loop detection, severity escalation, normalization of exact-message matches, and safe prepending of synthetic transcript logs ahead of real execution console output
- `file_api_request_context_test.mjs`: live HTTP regression coverage for file endpoints that depend on router-supplied `headers` and `requestUrl` request-context fields
- `file_write_operations_test.mjs`: focused server-side coverage for `file_write` append, prepend, line insert, pattern insert, and invalid insert-anchor behavior
- `framework_context_test.mjs`: focused frontend-bootstrap coverage for generic `x-context` helpers, the framework-owned `data-runtime="browser|app"` context element, the derived `runtime-browser` or `runtime-app` tags, and the shared tag collection that metadata-driven skills consume alongside feature-owned tags such as `space:open` or `browser:open`
- `github_auth_test.mjs`: focused coverage for GitHub token resolution via `SPACE_GITHUB_TOKEN`, no-auth behavior when the token is absent, and supervisor Git command auth-header injection
- `module_discovery_state_test.mjs`: focused coverage for state-backed module inheritance, extension lookup, and module-management visibility across firmware `L0`, group `L1`, self `L2`, and admin cross-user `L2` access
- `password_change_test.mjs`: live HTTP coverage for authenticated self-service password rotation, including current-password validation, session clearing, old-password rejection, replacement-password login, and single-user-mode rejection
- `server_cluster_test.mjs`: clustered-runtime smoke and stress coverage for cross-worker file-write visibility, version fencing, guest creation, login challenge, login completion, cookie validation, and 8-worker index-parity checks through the temporary debug path-index endpoint
- `server_cluster_read_stress_test.mjs`: CLI read pressure harness that seeds temporary `L2/<user>/` trees including the implicit single-user `user` plus many additional synthetic users, drives concurrent `/mod/...` fetches and `/api/file_paths` pattern listings through a single-process `--workers 1` baseline or clustered workers, can compare forced `--connection close` against HTTP keep-alive through `--connection keep-alive`, and reports throughput, latency percentiles, indexed path counts, match counts, worker distribution, and per-process CPU deltas for module-resolution style read workloads
- `server_cluster_write_stress_test.mjs`: CLI write pressure harness that seeds temporary `L2/<user>/` trees, can fan that seed across many synthetic users, drives concurrent `/api/file_write` requests through a single-process `--workers 1` baseline or multiple clustered workers, records startup plus restart timings on the same dataset, can toggle `CUSTOMWARE_WATCHDOG` to isolate background watcher cost from the explicit clustered mutation path, reports throughput plus latency percentiles and per-process CPU deltas, and can optionally sample the clustered primary CPU profile to highlight primary-side write bottlenecks such as replicated-state cloning or watchdog path rebuild work
- `watchdog_external_changes_test.mjs`: focused watchdog coverage for raw external L2 changes staying unloaded until demand-loaded, auth-only L2 state loading without a full user-tree scan, CLI-style group writes remaining live-indexed while user writes load on demand, explicit project-path sync hydrating newly created ancestor directories without a whole-layer rescan, and completion-anchored backstop reconcile scheduling when periodic full rescans are disabled or slowed
- `set_command_test.mjs`: focused coverage for `space set` `KEY=VALUE` parsing, rejection of non-assignment arguments, ordered multi-assignment application, and runtime-param schema validation for stored server config keys
- `supervise_command_test.mjs`: focused coverage for `supervise` argument partitioning, opaque child `space serve` arg forwarding, child `HOST` and `PORT` rewriting, `CUSTOMWARE_PATH` resolution, the default project-root `supervisor/` state directory, canonical auth-key reuse, and legacy supervisor auth-key migration
- `state_system_test.mjs`: focused coverage for the unified primary-owned state system, delta pruning, TTL behavior, and named lock semantics
- `update_remote_test.mjs`: focused coverage for shared update-repository URL resolution from explicit config, runtime `GIT_URL`, environment, and local git origin fallback
- `user_home_tree_transient_test.mjs`: focused prompt-context coverage for the bounded current-user `~/` transient tree, including folder-first ordering, per-folder limits, depth-limit summaries, and explicit line-limit summaries
- `user_folder_quota_test.mjs`: focused server-side harness for `USER_FOLDER_SIZE_LIMIT_BYTES`, indexed current-size and subtree-size reads, cached per-user `L2` size accounting, write growth rejection, size-reducing writes, deletes, batch aggregation, and copy checks
- standalone repo-level verification scripts such as `yaml_lite_test.mjs`
- `project_version_test.mjs`: focused helper coverage for package-version display tags and project-version fallback behavior used by the CLI and page shells
- `prompt_items_test.mjs`: focused shared prompt-item helper coverage for blank-line array value joins, cached prompt-item token metadata, plus the live `space.chat` long-message access runtime that hides full prompt text from the public metadata list
- `prompt_budget_trim_test.mjs`: focused shared prompt-budget coverage for the `250`-token minimum contributor trim plan, one-shot outlier trimming, and `system` section-body fallback when contributor-level trims are too small
- `promptinclude_test.mjs`: focused prompt-include coverage for alphabetical include discovery plus keyed system or transient prompt-item output, ordering, and fenced transient rendering
- `onscreen_agent_prompt_shape_test.mjs`: focused overlay-agent prompt-shaping coverage for attachment block splitting and the example-to-live-history reset boundary
- `onscreen_agent_turn_boundary_test.mjs`: focused overlay send-loop coverage for queued follow-up boundary handling around pending assistant `_____javascript` execution
- `huggingface_prompt_shape_test.mjs`: focused local-LLM prompt-shaping coverage for the Hugging Face API-style fallback prompt format and the onscreen local-client folded-transport message contract
- `router_cache_headers_test.mjs`: focused server-router coverage for no-store cache headers on `/mod/...`, page shells, and public page resources so runtime code updates replace stale origin-scoped module caches after reload
- `router_api_logging_test.mjs`: focused server-router coverage for API handler logging so expected client-error statuses such as 404 are returned without backend error-log noise while 5xx failures keep one backend diagnostic log
- shared expectations for test config, fixtures, scripted execution, and saved evaluation results
- Direct child DOX docs listed below own their narrower subtrees.

## Local Contracts

### Local Contracts

- keep harnesses runnable from the CLI with explicit file paths or config-driven defaults
- keep provider config local to each harness and load secrets from environment or repo `.env`, never hardcode them
- when a harness supports multiple models, keep model selection explicit in config or CLI and make saved results carry the model id
- keep prompts, histories, cases, and results as separate files so evaluation remains reusable
- when a harness compares prompt variants, prefer a small active generation over a large always-on backlog
- when a harness uses prompt triads, keep the spread intentional:
  - conservative = surgical edits to the current best prompt
  - moderate = meaningful conceptual experiments without full reset
  - wild = truly fresh redesign that may discard the current narrative, keywords, structure, and length
- do not let a wild branch collapse into a slightly stronger restatement of the same prompt
- keep a short human-readable progress surface for long-running harness work so a human can inspect status without reading raw result artifacts
  - if the newest generation regresses, that progress surface should still mention the overall best prompt
  - if one-shot and repeat-stable leaders differ, that progress surface should mention both
- keep a short human-readable summary surface for the current best overall results so a human can inspect the leaderboard without reading raw artifacts
- keep a human-readable case-coverage surface for harnesses where problem-family balance matters
- keep archived comparison history outside the always-read surfaces; full long-term archives are fine when they live in dedicated history outputs
- when framework or tool output text itself can confuse the model, add synthetic fixtures for those outputs instead of waiting for only organic failures
- prefer deterministic scoring rules first; if an LLM judge is added later, keep it secondary and clearly separated
- when a harness needs to allow a small explicit set of acceptable next moves, prefer deterministic alternative-match assertions over weakening the case until any vague reply passes
- treat automated passes as provisional when behavioral quality still needs human judgment; a winning prompt or harness change should be manually reviewed before it is treated as validated
- do not mutate app or server runtime state from prompt-evaluation harnesses unless the harness explicitly exists to test those mutations
- when a new long-lived harness lands under `tests/`, add a child `AGENTS.md` before the harness grows
- performance harnesses should prefer CLI parameters over hardcoded constants, should report latency plus CPU separately, and should avoid machine-specific pass or fail thresholds unless the repo explicitly adopts a stable benchmark budget
- keep standalone browser harness helpers outside the real desktop host; tests should launch the dedicated browser-component harness rather than wiring test-driver logic into `packaging/desktop/main.js`
- the standalone browser CLI keeps a hard 10-second operator timeout per request, so harness-side `open`, `reload`, `back`, `forward`, and navigation-causing actions should wait for the next page to become usable again when possible and otherwise return the settled page state instead of failing spuriously after the visual navigation already completed
- standalone browser-harness lifecycle waits should follow the latest guest document and should not let late same-document navigation events clear a bridge that remains usable for subsequent `content(...)` or `detail(...)` reads
- standalone browser-harness ref-targeted actions should match the real browser contract closely enough to return `{ action, state }`, including action status flags such as `reacted` and `noObservedEffect` plus visible-effect hints such as validation text or semantic cues, so loop-prevention and actionability regressions stay testable outside the full app shell

## Work Guidance

### Local Work Rules

- keep fixtures hand-authored and readable
- keep fixtures independent and side-effect-free so harnesses can parallelize them safely
- keep harness outputs easy to diff and resume next session
- prune stale result commentary and keep only durable signal in the always-read summaries; full history can live in dedicated archive outputs
- when iterating generations, expand the search space on purpose instead of writing three near-duplicate prompts
- update the root `AGENTS.md` when the top-level test workflow or ownership map changes

## Verification



## Child DOX Index

- `/tests/agent_llm_performance/AGENTS.md` - tests/agent_llm_performance/ owns prompt-performance evaluation for the onscreen agent LLM
- `/tests/browser_component_harness/AGENTS.md` - tests/browser_component_harness/ owns the standalone Electron browser-component harness used to debug the desktop browser bridge without booting the full app shell.
