# The close gate judges only a close marked completed

Recorded 2026-08-25.

Lane 09 fires on every `issues.closed` event but judges only a close whose `state_reason` is
`completed`. A close marked *not planned* or *duplicate* asserts that no work was delivered, so
there is nothing for a delivery record to be about, and reversing one would be the gate refusing a
decision rather than verifying a claim.

## Considered options

- **Judge every close**, which is what era 6's PreToolUse hook effectively did. Rejected. On a
  workstation the closer was always an agent that could be told to write a record first. On the
  tracker the closer is often the owner, dropping an idea from his phone, and this reading reopens
  every one of those until he posts a `No diff.` record. That is a queue draining onto him, which
  is the outcome the whole design exists to avoid.
- **Judge only issues carrying `## Acceptance criteria`.** Rejected as a hole rather than a scope:
  it hands any agent a way past the gate — ship a ticket without criteria and its close is never
  read. `missing-acceptance-criteria` was 8 of era 6's 125 refusals, and those 8 are exactly the
  cases this option would stop catching.
- **Scope on `state_reason`.** Chosen. It is native to the venue, costs nothing, and draws the
  line where the claim is rather than where the paperwork is.

## Consequences

**The gate stays absolute about what it does judge.** Because a non-delivery close has its own
door, nothing has to be softened for the closes that remain: an issue closed as completed with no
acceptance criteria and no record is still refused, exactly as era 6 refused it.

**"Close as not planned" becomes load-bearing UI.** It is one click either way in the web UI, but
it is now a statement with a consequence, and an agent that closes a delivered ticket as *not
planned* routes around the gate entirely. That is a narrower hole than the one being closed — it
requires deliberately mislabelling the close rather than merely forgetting a comment — and the
counter for it is a lens, not a gate: `not_planned` closes on issues that carry acceptance criteria
are worth reading. Nothing watches that yet.

**The rule is spelled twice on purpose.** `close-gate.yml`'s job-level `if` skips the runner
entirely, because the estate is over its 2,000-minute cap and a job that would decide "nothing to
do" should not start; `close-gate.ts` holds the same constant for a local run. No compiler sees
across that boundary, so `close-gate.test.ts` asserts the two still agree — the same shape
`CODING_STANDARDS.md` already requires of a stage and its workflow step.
