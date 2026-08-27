# The shaper routes every item, so the short path is not defects-only

Recorded 2026-08-23.

Status: superseded by ADR-0029

The shaper ends every sheet with a route recommendation — long or short — for features as well as
defects, and the owner's one-word override on the accept sends it the other way. The short path may
still never skip the gauntlet or review.

`DESIGN.md` §01a originally reserved the short path for defects, reasoning that a small-looking
feature is exactly where the ceremony earns its keep. Nothing in the record supports that. C1 says
no era was ever replaced for producing bad output; every one was replaced when per-unit overhead
stopped being worth it, and era 4 died spending ~7 plan steps on ~3 edits in 1 file. Sending every
feature long rebuilds that as policy.

## Considered options

- **Defects only** — rejected. Reconstructs era 4's cause of death and makes it a rule.
- **The owner sizes it** — rejected outright. That is the sizing quiz commit `68b071f` deleted, and
  C2 forbids asking a senior-dev question the owner cannot answer better than the author.
- **The shaper routes, the owner overrides** — chosen. C2's shape: machine judgement with a
  reviewable checkpoint. The route sits on a sheet he is already reading.

## Consequences

The two errors are not symmetric, which is the whole argument. A wrong *short* route sends a feature
to the gauntlet without a spec — visible, because lanes 06–07 still run, and recoverable by
re-shaping. A wrong *long* route costs the overhead that killed era 4 and leaves no trace anywhere,
because nothing records the ceremony a small item did not need.

More than ~3 load-bearing assumption marks already forces the long path — the shaper that does not
understand an idea cannot route it short.
