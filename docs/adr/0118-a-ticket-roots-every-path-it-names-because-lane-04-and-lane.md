---
status: constraint
date: 2026-08-31
reversal: Reversing deletes `validatePathsAreRooted` from `shared/render-body.ts` along with the four-ticket regression corpus and the `prompt-skeleton.test.ts` run that keeps both plan prompts' worked examples honest, and returns the ticket format to one where lane 04 and lane 05 — which never see each other — root the same relative path differently, at a paid model run per non-converging retry.
---

# A ticket roots every path it names, because lane 04 and lane 05 root a relative one separately

Every path a published ticket names must be resolvable from the ticket alone: `filesClaimed` carries the full path from the repository root, and prose may abbreviate only a path the same slice claims in full. `validatePathsAreRooted` refuses the plan before the first `gh` write.

Lane 04 and lane 05 never see each other, and neither runs first. The ticket body is their entire coordination mechanism, so a relative path is a decision handed to two blind readers not obliged to answer it alike — #272's `checkpoints/` was rooted two different ways, and a red acceptance test cannot say the two read one sentence differently, so the retry loop re-fires the lane that was not wrong.

**Rejected:** refusing every unrooted path — measured, it bounces three tickets that merged cleanly. Saying it in the prompt and gating nothing — the prompt's own worked examples were the defect.
