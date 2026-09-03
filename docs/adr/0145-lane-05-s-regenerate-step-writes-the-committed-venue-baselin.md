---
status: constraint
date: 2026-09-03
amends: ADR-0142, ADR-0140
reversal: Lane 05 goes back to writing the committed file from a solo suite measurement, `record`'s runner-write seam reverts to nobody, and `venues.push` returns to permanently empty — the state `main` carries today, for every repository this pipeline installs into.
---

# Lane 05's regenerate step writes the committed venue baseline by running the push venue itself, on the runner

ADR-0140 named lane 05's regenerate step the committed timing baseline's one writer. ADR-0142
named `record`, from a venue run, the only writer of a `venues` entry — but `record` only ever
persists off a runner, so a runner's own venue run always judges the committed baseline and
discards it. The two rules together named a writer that could never fire: `venues.push` stayed
`{}` through every enrolled repository's first green run, Lumaria's included.

Lane 05's regenerate step now **is** a venue run. It spawns `bin/gauntlet push` against the target
on the runner, under a seam (`TIMING_BASELINE_WRITE`) that only that spawn sets, and `record`
persists the committed file when it sees that seam even on a runner. A plain `bin/gauntlet push` —
Verify's own push, the same command, the same runner — never carries the seam, so it still judges
the committed baseline and discards it exactly as ADR-0142 left it. Only the one call that owns
the commit may write it.

**Rejected:** having `record` persist on every runner, which is the rule ADR-0142 exists to forbid
— a workstation-shaped push's own contention would refuse a push whose every check passed.

**Accepted cost.** One push-venue run per implementation, on the runner — the same cost ADR-0140
already accepted, now actually paid where the number lands.
