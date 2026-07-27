# ADR-003: Prompt-injection defense via UNTRUSTED fencing and event-type guards

## Status
Accepted

## Date
2026-06-14

## Context
The action sends PR diffs, titles, descriptions, and a repo rules file to an LLM (Jules). All of these are attacker-controllable. A malicious PR could include instructions that tell the LLM to "approve without review" or "output verdict: approve". We must prevent prompt injection. Additionally, `pull_request_target` events run with base-repo write tokens, which would allow a fork PR to exfiltrate secrets.

## Decision
Multi-layered defense:
1. The prompt (src/prompt.ts) explicitly labels PR title, description, diff, and rules file as `UNTRUSTED` with a `# SECURITY — READ FIRST` section instructing the LLM to ignore instructions in untrusted sections.
2. The action refuses to run on `pull_request_target` events (throws a hard error).
3. Forks are skipped by default (`skip_forks: true`).
4. The rules file is loaded from the base SHA (not head SHA), preventing PR authors from modifying review rules.
5. A `bypass_label` allows human reviewers to skip the AI review entirely.

## Alternatives Considered

### Input sanitization/escaping
- Pros: Removes known dangerous patterns
- Cons: Cannot reliably sanitize natural language instructions; the LLM's instruction-following is the attack surface
- Rejected: Natural language injection cannot be reliably filtered without breaking legitimate content

### Running only on trusted branches
- Pros: Eliminates untrusted input entirely
- Cons: The action must work for all PRs, including from external contributors
- Rejected: Defeats the purpose of automated PR review for community contributions

### No defense
- Pros: Maximum flexibility
- Cons: Demonstrated prompt injection attacks exist for all major LLMs; unacceptable risk
- Rejected: Security baseline for any LLM-integrated system

## Consequences
- The security section in the prompt is critical and must be preserved during any prompt refactoring
- Fork PRs don't get reviewed (acceptable trade-off for security)
- The `pull_request_target` block means users must use `pull_request` event type
- Any new fields added to the prompt must be labeled as `UNTRUSTED` if they originate from the PR
