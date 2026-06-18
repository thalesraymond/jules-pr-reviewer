2025-01-29
Vulnerability: Prompt Injection via Unescaped PR Data
Learning: When feeding untrusted, attacker-controlled text inputs (like PR titles, descriptions, and diffs) into Large Language Model prompts, the data MUST be wrapped inside explicit XML-like tags (e.g., `<pr_title>`, `<pr_description>`) to provide explicit boundary context to the model.
Prevention: Ensure all user-submitted text inputs passed to prompt builder functions are explicitly framed with XML delimiter tags.
