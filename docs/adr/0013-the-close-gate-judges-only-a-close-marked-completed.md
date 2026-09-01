---
status: constraint
date: 2026-08-25
reversal: Reversing it puts every `not planned` and `duplicate` close back under the gate, reopening the owner's own closes until he posts a record, and the `state_reason` scope is spelled twice on purpose — `close-gate.yml`'s job-level `if`, `close-gate.ts`, `prd-close.ts` and an acceptance fixture that asserts the two copies still agree.
---

# The close gate judges only a close marked completed

Lane 09 fires on every `issues.closed` event but judges only a close whose `state_reason` is `completed`. A *not planned* or *duplicate* close asserts no work was delivered, so there is nothing for a record to be about; refusing one would overrule a decision, not verify a claim.

**Rejected:** judging every close. On a workstation the closer was always an agent that could be told to write a record first; on the tracker it is often the owner, and every such close reopens until he posts a record — a queue draining onto him. Also rejected: scoping to issues carrying `## Acceptance criteria` — a hole, not a scope: ship a ticket without criteria and its close is never read.

**Accepted cost.** *Close as not planned* is now load-bearing UI; an agent that mislabels a delivered close routes around the gate; the counter is a lens nothing watches yet.
