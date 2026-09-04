---
status: constraint
date: 2026-09-03
amends: ADR-0152
reversal: every guarded lane goes back to answering a canary fire with a skipped job, and a reader who sees that red has to re-derive, lane by lane, that the machine was never at fault.
---

# A canary fire satisfies the job guard the lane sits behind, including a guard that lives in the reusable workflow the caller uses

A lane is two files: a caller that owns `on:`, and the reusable workflow it `uses:`. Reading only
`on:` says which door to knock on, not what the lane accepts once the knock lands. One sweep
proved it: four lanes wanting a specific label, issue state, or pull-request title each answered a
generic fire by skipping the job. Four reds, none a defect in the code being proved.

The guard is not always in the caller. `ratify-on-prd-close-caller.yml` carries no `if:` at all;
its condition is a job guard in the reusable workflow, so the plan follows `uses:` into the called
file and reads the guards there too.

**Rejected: a per-lane table of what to seed.** The same knowledge written twice, drifting the
first time a guard changed, and drifting silently — as a red that looks like a machine fault.
The guard is the specification; the fire reads it.
