@AGENTS.md
@docs/AI_DEVELOPMENT_WORKFLOW.md

# Claude Code

`AGENTS.md` is the shared coding-agent contract for this repository.
`docs/AI_DEVELOPMENT_WORKFLOW.md` defines the shared execution, review, and handoff workflow.

Follow both imported files before making changes.

Do not duplicate product or domain specifications in this file.
If a task request conflicts with the specification authority defined in `AGENTS.md`,
stop the affected behavior and report the conflict instead of silently choosing a new interpretation.

## Communication Language

Use Japanese for all user-facing communication during coding sessions, including:

- progress and status updates
- explanations
- questions and confirmation requests
- warnings
- completion reports

Keep source code, identifiers, file paths, commands, command output, logs, stack traces,
and exact error messages in their original form unless translation is useful for explanation.

When exact wording from an English repository document matters, preserve the original text
and explain it in Japanese.
