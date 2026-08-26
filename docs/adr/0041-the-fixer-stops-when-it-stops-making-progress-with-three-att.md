# The fixer stops when it stops making progress, with three attempts as the ceiling

Recorded 2026-08-26.

Lane 05's fixer exits when an attempt reproduces the **same failing test with the same error** as the
attempt before it, and in any case at **three attempts**, after which it labels `blocked`, writes
what it tried, and stops. The progress test is the primary exit; three is a ceiling, not the rule.

## What this amends

`DESIGN.md` §05, which capped the fixer at *"max 3 attempts"* and nothing else. The count survives as
a backstop; it stops being the whole mechanism.

## The argument

§05 justifies a cap by the failure it prevents — *"uncapped fixers are how you find out on Sunday
that something ground against a wall for eleven hours."* That failure is **grinding**, not counting.
A bare attempt count answers *how long do we let it run* but never asks *is it getting anywhere*, so
it pays for two wasted attempts in the common case and still cannot distinguish a fixer converging
from one stuck.

**Three could not have been derived, and cannot be yet.** This repo has opened **zero** pull requests
in its entire history, so there is no fix-attempt corpus to size against and no honest way to
manufacture one. The nearest evidence is Lumaria's CI failure rate — 24 red in 83 runs over 30 days
(29%), and 49% red across August — which says reds are common enough for the fixer to matter but says
nothing about how many attempts one takes.

The progress test needs no corpus. It is defined against the run's own output rather than against a
population, so it is correct on the first red PR the system ever sees.

## Considered options

- **A bare count of 3** — rejected. Not derived from anything, and blind to the failure it names.
- **Drop to 2** — rejected. Equally underived, and strictly less headroom for the case where attempt
  two makes real progress.
- **Progress test with 3 as ceiling** — chosen. Exits on attempt two in the common stuck case; the
  ceiling catches the fixer that keeps producing *different* failures without converging, which the
  progress test alone would let run.

## Consequences

**The number to watch is the share of red PRs that reach `blocked`.** It is free — the label is
already there — and it is what says whether the ceiling was generous or stingy. This is the shape
[ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) requires: a cap held
to a count, checkable, rather than to a judgement nobody revisits.

**Move 10's timing is unchanged.** [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md)
blocks branch protection on the fixer *existing*, not on what its cap is, so move 10 still lands after
move 7 whatever this ruling had said.
