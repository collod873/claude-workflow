# Buckets

The machine's failures, grouped by cause. A change to the machine names its row here and moves
that row's state in the same change. A row's evidence is a measured Spec, segmented by the
machine version it ran under; a row with no measured member gets no change. A session that
finds a failure no row holds adds the row with its evidence, not a fix.

Last measured: Lumaria#902 Waves 12 to 16 to its done check, 2026-10-09
([waves-12-16-2026-10.md](research/waves-12-16-2026-10.md)): 289 min for 8 tickets, 169 of them
rework after the done check, 53 stalled.

| Bucket | Evidence | Prevention | State |
|---|---|---|---|
| A held state nothing wakes: a ticket parked on the owner, a failed closer or branch update, a conflicting PR, a required check that never starts | two thirds of a Spec's wall time (#1232); 44 of 70 min in the probed Wave (#1267); 47 min on #1018, green behind a `tickets / review` its caller could not start (Waves 12-16) | every held state has an event or a clock; the builder never parks on the owner (ADR-0005) | #1276, #1281, #1283, #1293 built; a required check that never starts is pending forever |
| The Wave barrier: a ticket nothing depends on waits for the slowest | 9 h 40 min of tail over seven Waves (#1249); the slicer writes the dependencies it knows as prose; 11 to 20 min held on three tickets in Waves 14-15, costing the Spec nothing since each next Wave needed the slowest | the slicer writes dependencies as edges; a ticket with none starts at once; the wave check stays a cadence | unruled; first ruling after #902 |
| One tree judged more than once | 1.7 full checks per ticket (#1267); machine CI re-ran tests (#1290); 1.6 per ticket in Waves 12-16, every repeat a branch-updated PR | receipts; one full check in the builder; CI covered | receipts built; a branch update still re-executes the tree |
| Structure drift: code written twice, a shared piece never cut first | 21 findings, 0 bugs (#1229, #1230, #1231); #1023, #1029, #1035 in Waves 12-16, and an unbounded read neither reviewer nor meters caught | the slicer cuts the shared piece first; the reviewer loads `codebase-design` | ruled (#1234); cost unproven, no gate |
| A held sentence is never tried again until the done check | all three done-check misses had held earlier and broke unseen, one for 58 h; 169 of 289 min of Waves 12-16 were the rework | unruled: a wave check also tries the sentences that held | unruled |
| A fix wave sliced without the done check's findings | Wave 14 fixed the wrong cause of sentence 11, so Wave 15 (72 min) fixed what the done check had named; `slice --fix` runs before the findings post (`src/done-checker.ts:245`) | the done check posts its findings and hands them to `slice --fix` | unbuilt |
| A gate that ends green without judging | 5 of 12 reviews in Waves 12-16 stood down as "moved" when the meters wrote the PR body; #1033 and #1035 merged on dropped drift verdicts, #1035 with a money-path regression | the reviewer never ends green without a verdict on the head it read | unbuilt |
| Each check writes its own browser driver | wave and done checks took 106 of 289 min and 39% of model spend in Waves 12-16; one wave check spent 39 of 42 min on its driver | the check stages carry one browser driver | unruled |
| Jobs on the PC share Docker, /tmp and processes | Waves 12-16: a wave check reset and lost another job's Postgres twice (about 8 min); a builder's `kill` matched the owner's Next servers | each job gets its own Postgres, ports and paths | unruled |
| A fix spanning two repos carried by the owner | 8 of 14 by hand in a week (#1233) | one owning repo per kind of fix; agent-hooks reachable from a machine session | unruled (#1237) |
| Spot fixes outrun measurement | 97 machine PRs in a week, no Spec measured on one version (#1226); eight machine merges during Waves 12-16 and one 55 min before them, which shipped the review hold without Lumaria's caller; nine jobs ran one commit's workflow with another's code | the machine holds still while a Spec runs; the machine measures each Spec at its done check | CLAUDE.md rule broken in Waves 12-16; measurement unbuilt |
