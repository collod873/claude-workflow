---
status: constraint
date: 2026-10-22
supersedes: ADR-0002
reversal: Stages would run fenced again, without the owner's own rules and tools, and each guard would cut access for a failure that never happened.
---

# Every stage runs as the owner's own session does

A stage loads what the owner's interactive session loads: his global CLAUDE.md, hooks and skills,
and the target repo's own rules. It runs with full access, on the model the owner names for it,
given with no version so it takes the newest, and takes defaults where a session would ask him
(ADR-0005). It may write to any repo through `bin/land` and that repo's full check, the machine's
own code included. A guard is added only against a stall, such as a stage answering while work it
started still runs (0b95278b).

**Rejected: a fence, allowlist or deny list per stage.** It cut what a stage could do and stopped no
failure, and stages missed every rule the owner keeps outside the repo.

**Rejected: a gate on edits to the machine's own instructions.** It would hold the owner up before
any failure showed it was needed (ADR-0006).
