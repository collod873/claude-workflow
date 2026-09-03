---
status: constraint
date: 2026-09-03
amends: ADR-0140, ADR-0142
reversal: Reversing it means lane 05's regenerate step goes back to a solo `writeSuiteTiming` measurement or to nothing at all, and the committed `venues` half stays `{}` forever — every push venue on every runner refusing on a number that was never written, exactly the state this closes.
---

# The committed venue half is written by lane 05's push-venue run on the runner

ADR-0140 and ADR-0142 agreed where a `venues` entry may come from — a venue run, on the runner —
but neither wired a caller that was both. Lane 05's regenerate step called only
`writeSuiteTiming`, which ADR-0142 forbids from writing `venues`; every other push runs `record`
on a runner, where ADR-0142's gate keeps it from writing. So `venues` stayed `{}`: 137 suite files
measured, zero venue entries.

So: lane 05's regenerate step now runs `bin/gauntlet push` against the target, on the runner,
under a seam (`GAUNTLET_TIMING_WRITE_VENUE`) that lets that one caller's `record` write there.
Set only there: a plain `bin/gauntlet push`, including the Verify run judging this pull request,
still judges the committed baseline and discards, because a Verify checkout is thrown
away and a write there would leave a dirty tree under a commit nobody owns.

**Accepted cost.** One push-venue run per implementation, replacing the solo suite measurement
ADR-0140 priced.
