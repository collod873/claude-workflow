# Buckets

The machine's failures, grouped by cause. A change to the machine names its row here and moves
that row's state in the same change. A row's evidence is a measured Spec, segmented by the
machine version it ran under; a row with no measured member gets no change. A session that
finds a failure no row holds adds the row with its evidence, not a fix.

Last measured: Lumaria#902 up to Wave 11, 2026-10-08 (probe #1267), before the machine was frozen for
the rest of the Spec. Measure again at its done check.

| Bucket | Evidence | Prevention | State |
|---|---|---|---|
| A held state nothing wakes: a ticket parked on the owner, a failed closer or branch update, a conflicting PR | two thirds of a Spec's wall time (#1232); 44 of 70 min in the probed Wave (#1267) | every held state has an event or a clock; the builder never parks on the owner (ADR-0005) | #1276, #1281, #1283 built; #1293 open |
| The Wave barrier: a ticket nothing depends on waits for the slowest | 9 h 40 min of tail over seven Waves (#1249); the slicer writes the dependencies it knows as prose | the slicer writes dependencies as edges; a ticket with none starts at once; the wave check stays a cadence | unruled; first ruling after #902 |
| One tree judged more than once | 1.7 full checks per ticket (#1267); machine CI re-ran tests (#1290) | receipts; one full check in the builder; CI covered | built; checks under a fifth of wall time |
| Structure drift: code written twice, a shared piece never cut first | 21 findings, 0 bugs (#1229, #1230, #1231) | the slicer cuts the shared piece first; the reviewer loads `codebase-design` | ruled (#1234); cost unproven, no gate |
| A fix spanning two repos carried by the owner | 8 of 14 by hand in a week (#1233) | one owning repo per kind of fix; agent-hooks reachable from a machine session | unruled (#1237) |
| Spot fixes outrun measurement | 97 machine PRs in a week, no Spec measured on one version (#1226) | the machine holds still while a Spec runs; the machine measures each Spec at its done check | CLAUDE.md rule; measurement unbuilt |
