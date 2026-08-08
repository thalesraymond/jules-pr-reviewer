# Graph Report - .  (2026-08-08)

## Corpus Check
- Corpus is ~39,577 words - fits in a single context window. You may not need a graph.

## Summary
- 333 nodes · 510 edges · 34 communities (18 shown, 16 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Error Handling & Filtering
- GitHub Actions & SDK
- Linting & Commit Tooling
- Architecture Docs & ADRs
- Jules Review & Sessions
- Agentic Diff Mode
- Logging & Prompt Builder
- Module Design Concepts
- Action Config & Security
- Configuration Module
- TypeScript Build Config
- Suggested Changes Feature
- Agent Workflow Docs
- Checks API & Examples
- TypeScript Strict ESM
- NCC Bundling Decision
- Structured Logging Decision
- Vitest Coverage Thresholds
- Changelog
- Label-Gated Workflow
- Extra Instructions Workflow
- Agent Metrics Tracking
- Dependabot Config
- Auto PR Workflow
- CI Workflow
- Release Please Workflow
- Action Logs OpenSpec
- Suggested Changes OpenSpec
- Agentic Diff Mode OpenSpec
- pnpm Workspace Config

## God Nodes (most connected - your core abstractions)
1. `run()` - 22 edges
2. `getErrorMessage()` - 18 edges
3. `Context Documentation` - 14 edges
4. `loadConfig()` - 12 edges
5. `compilerOptions` - 12 edges
6. `scripts` - 11 edges
7. `Agentic Diff Mode Tasks` - 11 edges
8. `runSession()` - 10 edges
9. `runAgenticReview()` - 8 edges
10. `Agentic Diff Mode` - 8 edges

## Surprising Connections (you probably didn't know these)
- `ADR-003: Prompt injection defense` --semantically_similar_to--> `UNTRUSTED Content Fencing`  [INFERRED] [semantically similar]
  docs/adr/ADR-003-prompt-injection-defense.md → README.md
- `ADR-007: Multi-agent architecture` --semantically_similar_to--> `Multi-Agent Handoff Workflow`  [INFERRED] [semantically similar]
  docs/adr/ADR-007-multi-agent-architecture.md → AGENTS.md
- `ADR-009: Jules retry resilience` --semantically_similar_to--> `Three-Tier Fallback Ladder`  [INFERRED] [semantically similar]
  docs/adr/ADR-009-jules-retry-resilience.md → CONTEXT.md
- `ADR-010: Split utils into domain modules` --conceptually_related_to--> `Errors Module`  [EXTRACTED]
  docs/adr/ADR-010-split-utils-into-domain-modules.md → CONTEXT.md
- `ADR-010: Split utils into domain modules` --conceptually_related_to--> `Filtering Module`  [EXTRACTED]
  docs/adr/ADR-010-split-utils-into-domain-modules.md → CONTEXT.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Multi-Agent Handoff Workflow Cycle** — multi_agent_workflow_concept, docs_adr_adr_007_multi_agent_architecture_rationale, agents_md_document [EXTRACTED 1.00]
- **Prompt Injection Defense Layer** — prompt_injection_defense_concept, untrusted_fencing_concept, docs_adr_adr_003_prompt_injection_defense_rationale, action_inputs_concept [EXTRACTED 1.00]
- **Domain Modules from utils.ts Split** — resilience_module_concept, validation_module_concept, filtering_module_concept, errors_module_concept, docs_adr_adr_010_split_utils_into_domain_modules_rationale [EXTRACTED 1.00]
- **GitHub API Interaction Surface** — docs_adr_adr_011_split_github_into_domain_modules_md, docs_adr_adr_013_github_checks_api_md, openspec_changes_archive_2026_07_25_one_click_suggested_changes_design_md [INFERRED 0.75]
- **Review Pipeline Error Handling Patterns** — openspec_changes_archive_2026_07_25_one_click_suggested_changes_design_md_three_tier_fallback_ladder, openspec_changes_archive_2026_07_26_jules_retry_resilience_design_md_retry_loop_pattern, openspec_changes_archive_2026_07_25_add_action_logs_and_outputs_design_md_structured_logging_helper [INFERRED 0.75]
- **Agent Workflow Surface** — docs_agents_domain_md, docs_agents_issue_tracker_md, docs_agents_triage_labels_md [EXTRACTED 1.00]
- **Agentic Diff Mode Pipeline Components** — agentic_prompt_builder, agentic_review_pipeline, archive_session_helper, mode_branching_in_index, fallback_state_machine, changedfiles_verification [INFERRED 0.85]
- **Prompt Injection Defense Layer** — prompt_injection_defense, read_only_prohibition, sha_based_diff_instruction, suggestion_security_guardrail [INFERRED 0.85]
- **Agentic Security and Resilience** — read_only_prohibition, ignored_paths_mechanism, session_archiving, fallback_state_machine [INFERRED 0.75]

## Communities (34 total, 16 thin omitted)

### Community 0 - "Error Handling & Filtering"
Cohesion: 0.13
Nodes (28): getErrorMessage(), extractChangedFilePaths(), filterDiff(), parseIgnoredPaths(), shouldIgnorePath(), CheckRunOutput, createCheckRun(), fetchDiff() (+20 more)

### Community 1 - "GitHub Actions & SDK"
Cohesion: 0.05
Nodes (36): @actions/core, @actions/github, @google/jules-sdk, minimatch, author, bugs, url, path (+28 more)

### Community 2 - "Linting & Commit Tooling"
Cohesion: 0.06
Nodes (31): commitizen, @commitlint/cli, @commitlint/config-conventional, cz-conventional-changelog, eslint, eslint-config-prettier, @eslint/js, husky (+23 more)

### Community 3 - "Architecture Docs & ADRs"
Cohesion: 0.07
Nodes (30): ADR-011: Split github.ts into domain modules, Deep Module Principle, Domain Concept Naming, Shallow Module, ADR-012: Config module deepens the input gateway, ConfigResult, Input Injection Pattern, InputReader (structural type) (+22 more)

### Community 4 - "Jules Review & Sessions"
Cohesion: 0.13
Nodes (23): AgenticReviewResult, runAgenticReview(), runJulesReview(), verifyChangedFiles(), archiveSession(), isAuthError(), PARSE_FAILURE_REVIEW, PollableSession (+15 more)

### Community 5 - "Agentic Diff Mode"
Cohesion: 0.13
Nodes (27): Agentic Diff Mode, buildAgenticPrompt Function, runAgenticReview Function, AgenticPromptArgs Interface, archiveSession Helper, changedFiles Field in ReviewResult, changedFiles Verification, DiffMode Type (+19 more)

### Community 6 - "Logging & Prompt Builder"
Cohesion: 0.16
Nodes (17): logStructured(), scrubSecrets(), setReviewOutputs(), buildAgenticDiffSection(), buildDiffSection(), buildInlineDiffSection(), buildReviewPrompt(), buildThreadsContext() (+9 more)

### Community 7 - "Module Design Concepts"
Cohesion: 0.14
Nodes (20): Config Module, Context Documentation, ADR-005: Review submission fallback, ADR-005: Three-tier review submission fallback, ADR-009: Jules retry resilience, ADR-009: Jules retry resilience, ADR-010: Split utils into domain modules, ADR-010: Split utils into domain modules (+12 more)

### Community 8 - "Action Config & Security"
Cohesion: 0.12
Nodes (18): Action Inputs, Action Outputs, action.yml — Action Definition, Agent Guidelines, ADR-003: Prompt injection defense, ADR-003: Prompt injection defense, ADR-004: Incremental diffing, ADR-004: Incremental diffing (+10 more)

### Community 9 - "Configuration Module"
Cohesion: 0.20
Nodes (11): Config, ConfigResult, InputReader, isDiffMode(), isFailOn(), loadConfig(), normalizeOptional(), VALID_DIFF_MODES (+3 more)

### Community 10 - "TypeScript Build Config"
Cohesion: 0.13
Nodes (14): src/**/*, compilerOptions, allowImportingTsExtensions, esModuleInterop, module, moduleResolution, noEmit, outDir (+6 more)

### Community 11 - "Suggested Changes Feature"
Cohesion: 0.31
Nodes (9): OpenSpec Config, Suggested Changes Spec, Prompt Injection Defense, Read-Only Prohibition, Suggested Changes Feature, Suggestion Prompt Security Guardrail, Suggestion Pre-Submission Validation, Suggestion Output Schema (+1 more)

### Community 12 - "Agent Workflow Docs"
Cohesion: 0.40
Nodes (6): Issue Tracker: GitHub, Native Issue Dependencies (blocking), Ticket Map (wayfinder), Wayfinding Operations, Triage Labels, Triage Role Mapping

### Community 13 - "Checks API & Examples"
Cohesion: 0.40
Nodes (5): ADR-013: Adopt GitHub Checks API for review status, Severity-to-Annotation Mapping, Check Run Lifecycle, Permission Migration (statuses to checks), Basic Workflow Example

## Knowledge Gaps
- **111 isolated node(s):** `name`, `version`, `private`, `description`, `build` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Linting & Commit Tooling` to `GitHub Actions & SDK`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `getErrorMessage()` connect `Error Handling & Filtering` to `Configuration Module`, `Jules Review & Sessions`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _111 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Error Handling & Filtering` be split into smaller, more focused modules?**
  _Cohesion score 0.13076923076923078 - nodes in this community are weakly interconnected._
- **Should `GitHub Actions & SDK` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `Linting & Commit Tooling` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Architecture Docs & ADRs` be split into smaller, more focused modules?**
  _Cohesion score 0.0735632183908046 - nodes in this community are weakly interconnected._