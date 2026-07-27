# ADR-007: Multi-agent architecture for AI-assisted development

## Status
Accepted

## Date
2026-07-25

## Context
This project is developed with AI coding agents (GitHub Copilot, OpenCode). We need a structured workflow that prevents agents from making un-reviewed changes, keeps planning separate from execution, and maintains quality gates. Single-agent "do everything" prompts lead to unbounded scope creep and quality issues.

## Decision
Define 4 specialized agent roles with a linear handoff workflow:
1. **codebase-explorer**: Read-only discovery. Scans code, traces dependencies, produces context summaries. Never edits.
2. **spec-planner**: Architectural planning. Consumes explorer context, produces bounded implementation plans. Never edits.
3. **code-builder**: Execution. Implements approved plans, runs verification commands, hands off for review.
4. **code-reviewer**: Audit. Checks uncommitted diffs for bugs, type safety, spec compliance. Routes failures back to planner or triggers archive.

Agents are defined in `.github/agents/` with model tiering (lighter models for exploration, heavier for planning/building). The workflow is enforced by agent definitions that restrict what each role can do.

## Alternatives Considered

### Single general-purpose agent
- Pros: Simple setup, no coordination overhead
- Cons: No separation of concerns, harder to control, more likely to make sweeping unauthorized changes
- Rejected: Lacks guardrails; "do everything" agents are prone to scope creep

### Omni-agent with internal reasoning
- Pros: Single agent with internal phase separation
- Cons: Costs more (always uses heavy model), no guardrails between planning and execution
- Rejected: No enforcement mechanism between phases; relies on prompt discipline

### Human-in-the-loop for all steps
- Pros: Maximum control
- Cons: Too slow for routine tasks like lint fixes and package updates
- Rejected: Defeats the purpose of automated AI-assisted development

## Consequences
- All changes go through plan→build→review→archive
- The reviewer is the quality gate
- Failed reviews loop back to planning
- This adds overhead for trivial changes but prevents quality regressions
