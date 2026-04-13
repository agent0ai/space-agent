# AGENTS

## Purpose

`tests/` owns repo-level verification harnesses and evaluation fixtures

Keep test workflows explicit scriptable and isolated from app runtime behavior unless a test explicitly targets that runtime

## Documentation Hierarchy

`tests/AGENTS.md` owns the top-level test tree and the contract for deeper test harness docs

Current deeper docs:

- `tests/agent_llm_performance/AGENTS.md`
- `tests/agent_llm_performance_structured/AGENTS.md`
- `tests/agent_llm_turn_flags/AGENTS.md`

Parent vs child split:

- this file owns the top-level test layout and shared test-workflow boundaries
- `agent_llm_performance/AGENTS.md` owns the LLM prompt-performance harness, its config, cases, prompts, and scoring rules
- `agent_llm_performance_structured/AGENTS.md` owns the structured-output LLM prompt-performance harness, its schema contract, cases, prompts, and scoring rules
  - this harness is currently an experimental comparison track, not the default replacement for the free-text harness
- `agent_llm_turn_flags/AGENTS.md` owns the flagged-turn LLM prompt-performance harness, its config, cases, prompts, and scoring rules

Child doc section pattern:

- `Purpose`
- `Ownership`
- `Local Contracts`
- `Development Guidance`

## Ownership

This scope owns:

- repo-level test harnesses under `tests/`
- `customware_git_history_test.mjs`: focused server-side harness for optional writable-layer Git history, adaptive debounce rules, repository discovery, pagination, nested filename filters with full file metadata, diff reads, operation previews, revert, ignore rules, and rollback or forward-travel preservation
- `file_api_request_context_test.mjs`: live HTTP regression coverage for file endpoints that depend on router-supplied `headers` and `requestUrl` request-context fields
- `github_auth_test.mjs`: focused coverage for GitHub token resolution via `SPACE_GITHUB_TOKEN`, no-auth behavior when the token is absent, and supervisor Git command auth-header injection
- `module_discovery_state_test.mjs`: focused coverage for state-backed module inheritance, extension lookup, and module-management visibility across firmware `L0`, group `L1`, self `L2`, and admin cross-user `L2` access
- `server_cluster_test.mjs`: clustered-runtime smoke and stress coverage for cross-worker file-write visibility, version fencing, guest creation, login challenge, login completion, cookie validation, and 8-worker index-parity checks through the temporary debug path-index endpoint
- `set_command_test.mjs`: focused coverage for `space set` `KEY=VALUE` parsing, rejection of non-assignment arguments, and ordered multi-assignment application
- `supervise_command_test.mjs`: focused coverage for `supervise` argument partitioning, opaque child `space serve` arg forwarding, child `HOST` and `PORT` rewriting, `CUSTOMWARE_PATH` resolution, and the default project-root `supervisor/` state directory
- `state_system_test.mjs`: focused coverage for the unified primary-owned state system, delta pruning, TTL behavior, and named lock semantics
- `update_remote_test.mjs`: focused coverage for shared update-repository URL resolution from explicit config, runtime `GIT_URL`, environment, and local git origin fallback
- `user_folder_quota_test.mjs`: focused server-side harness for `USER_FOLDER_SIZE_LIMIT_BYTES`, cached per-user `L2` size accounting, write growth rejection, size-reducing writes, deletes, batch aggregation, and copy checks
- standalone repo-level verification scripts such as `yaml_lite_test.mjs`
- `project_version_test.mjs`: focused helper coverage for package-version display tags and project-version fallback behavior used by the CLI and page shells
- shared expectations for test config, fixtures, scripted execution, and saved evaluation results

## Local Contracts

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

## Development Guidance

- keep fixtures hand-authored and readable
- keep fixtures independent and side-effect-free so harnesses can parallelize them safely
- keep harness outputs easy to diff and resume next session
- prune stale result commentary and keep only durable signal in the always-read summaries; full history can live in dedicated archive outputs
- when iterating generations, expand the search space on purpose instead of writing three near-duplicate prompts
- update the root `AGENTS.md` when the top-level test workflow or ownership map changes
