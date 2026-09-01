---
status: constraint
date: 2026-08-29
reversal: Reversing means re-licensing lanes to cancel paid model calls: the two guards in `shared/workflow-permissions.test.ts` come out, every lane's `concurrency:` block is rewritten, and the lanes given a group could again slice one PRD twice or open two release pull requests for one close — losses that surface as `cancelled` runs indistinguishable from a human pressing stop.
---

# A lane that spends a model queues behind itself rather than cancelling, and one with no concurrency group gets one

`cancel-in-progress: true` on a job holding a paid model call throws that call away and records the run as `cancelled`, which reads as a human pressing stop. Seven runs died that way in one evening. So a lane that spends a model sets `cancel-in-progress: false` and a second event queues behind the first. The other half of the defect is no `concurrency:` block at all, where both runs complete and both act — one PRD sliced twice. A lane that spends a model **or** performs a write declares a group keyed on the subject it acts for.

Both are guards in `shared/workflow-permissions.test.ts`, derived from the model install and `reachableWrites`, so a new lane cannot omit either.

**Accepted cost.** Queueing keeps every answer it paid for: three fast-follow comments post three sheets rather than one.
