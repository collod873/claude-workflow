---
status: constraint
date: 2026-08-26
amends: ADR-0063
reversal: Reversing it buys branch protection, which forbids the direct pushes lanes 01 and 04 are built on, restores the immutability exemption ADR-0053 deleted and the credential question with it, and re-arms a counter now deliberately silent in `watchdog/bypass-counter.ts`.
---

# Branch protection is declined, so move 10 retires and its counter goes quiet

Branch protection is not being bought — not now, and not at a higher bypass count. Move 10 retires rather than defers, and the bypass counter, whose only proposal was to bring move 10 forward, stops proposing: a carrier issue closed `not planned` silences a counter at any count. The count survives, computed on every `verify.yml` completion, because the measurement is the only thing that could reopen the ruling. Decisions resting on move 10 — the accept's and lane 04's direct-to-`main` commits, immutability enforced by the actor rather than by protection, a repository secret readable by any workflow — become permanent scaffolding.

**Rejected:** deleting the counter, which deletes the only argument for reversing this; re-proposing once the count has grown, which is nagging on a settled question.

**Accepted cost.** `verify.yml` refuses nothing, the free venues are the whole gate, and four red trees have reached `main` that way.
