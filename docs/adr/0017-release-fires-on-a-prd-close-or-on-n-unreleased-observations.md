# Release fires on a PRD close or on N unreleased observations, whichever comes first

Recorded 2026-08-25.

Observations accumulate silently and are released as one decision on a work-volume event: a PRD
closing, **or** N unreleased observations having piled up, whichever arrives first. N starts at 20
and is a number to be measured, not a constant to be defended. Ruled in
[#36](https://github.com/collod873/claude-workflow/issues/36) §Solution 4 and ratified by the owner
on 2026-08-23.

## Why both halves are required

**PRD-close alone silently drops all ad-hoc work.** Roughly half of everything that closed in
Lumaria closed with nobody running anything around it; `/standards-pass` computes its scope from a
SHA range for exactly this reason — a solo `/implement` session lands commits with no drain run
around them, and those must be read too.

**Volume alone would fire mid-flight**, releasing findings about a spec that is still being built,
which is the queue-draining-onto-the-owner shape the whole design exists to avoid.

## Why this is the answer to the wiki's failure

Knowledge-Base commit `6c86bb8` killed session capture in May 2026 because an audit found the wiki's
biggest customer was the wiki. Any capture mechanism that cannot answer *"what stops this becoming
its own biggest customer"* repeats that. This trigger is that answer: nothing here fires on a
schedule, so a quiet fortnight produces silence and a burst of work produces exactly one decision.
There is no clock anywhere in it, so [ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md)
holds — both triggers are work-volume events, and the clock is not one of them.

## Consequences

**N = 20 is the first thing the mechanism should be asked to report on.** Nobody has measured how
many observations a week of work produces, so the number is a guess with a rationale, and it is
[#36](https://github.com/collod873/claude-workflow/issues/36)'s own open question 1.

**The machinery's own commits are excluded from release scope.** agent-skills ADR-0029 measured what
happens without that filter — machinery share of file touches went 63% in July to 82% in August, and
20 of 92 commits in one batch were ratify verdicts against the harness that exists to enforce the
standards. A chain that reads its own output is guaranteed a supply of it.

**A release must never trigger another pass.** Explicitly ruled 2026-08-22, and it is what makes the
cycle terminate.
