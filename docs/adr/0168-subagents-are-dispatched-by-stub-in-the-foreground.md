---
status: constraint
date: 2026-09-09
reversal: A lint rule is named for this ruling and forbids skill files from restating it, so retiring the ADR leaves the rule enforcing a decision that no longer exists.
---

# Subagents are dispatched by stub, in the foreground

A dispatching skill hands its subagent a stub and waits: the verdict cannot be written without
the report, so the dispatch is foreground by construction rather than by instruction.

The rationale lives here and nowhere else. A dispatch site says "by stub, in the foreground
(ADR-0168)" and no more; `bin/lint`'s `subagent-dispatch-convention-restated` rule fails any
markdown outside `docs/adr/` that re-explains it. A new dispatching skill cites this ADR instead
of copying.

**Rejected: restating the convention per skill.** Copies drift, and the drift is invisible until
two skills dispatch differently.

Imported from collod873/agent-skills ADR-0026 on 2026-09-09; that repo no longer carries the
ruling.
