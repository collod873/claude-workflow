---
status: constraint
date: 2026-08-23
reversal: Reversing it pulls ADR authorship out of `shape/accept.ts`, `sheet-schema.ts` and `bin/gh_support.py`, and every spec written since then cites an ADR instead of restating its ruling, so those specs become citations to records that would no longer exist when the spec is written.
---

# Accepting a shaped idea is what files its ADRs

Lane 01 hands the owner a decision sheet: the idea restated as work, each decision with a recommended answer and the alternatives rejected. That is already an ADR's shape, so nobody authors ADRs — decisions on an accepted sheet that pass README's three-part bar are written as ADRs **at accept, before the spec**, and the spec cites them.

**Rejected:** agents writing ADRs directly when confident — the drafting is expensive, the signature cheap. The owner writing them — what `GOAL.md` claimed, and it has never once happened. Retrospective ADRs, today's habit — better informed, but the ruling arrives too late for the spec to cite, so follow-up work re-decides it.

**Accepted cost.** Rulings precede the work, so more will be contradicted by reality. At work-merge the implementer is asked whether anything contradicted its ruling; only a yes drafts an amendment, so the rate means reality pushed back.
