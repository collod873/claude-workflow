---
status: constraint
date: 2026-09-04
amends: ADR-0146
reversal: Reversing it means letting `prove` pick a candidate again and accepting that a canary can
  report green about a run it did not light. Getting back means noticing, from a lane that passed
  on somebody else's work, that a verdict was never tied to a fire.
---

# A canary that cannot tell which run its fire lit judges none of them

`prove` fired a lane, then took the oldest run newer than a repo-wide watermark. That is a guess.
Three acceptance runs on the canary share a creation second, and a queued stub can start after the
watermark without being ours, so the guess picks a stranger's run — and reads a verdict off it. A
canary can survive a false red; a false green is the one failure it cannot afford, because it is
the whole reason the canary exists.

So the watermark is now the newest run of that lane's own stub, and after a candidate appears
`prove` waits and looks again. Exactly one candidate is the fire. Anything else is a refusal
naming the runs it could not choose between, and the answer is to let them finish and prove again.
Refusing costs a re-run. Guessing costs the reason to trust any green.
