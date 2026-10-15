# Buckets

The machine's failures, grouped by cause. A change to the machine names its row here and moves
that row's state in the same change. A row's evidence is a measured Spec, segmented by the
machine version it ran under; a row with no measured member gets no change. A session that
finds a failure no row holds adds the row with its evidence, not a fix.
A check that refuses a machine change naming no row waits to see whether `CLAUDE.md`'s steps
(#1322) get sessions here alone (Collin, 2026-10-14).

Last measured: Lumaria#1086 from filing to its done check, 2026-10-14
([spec-1086-2026-10.md](research/spec-1086-2026-10.md)): 1339 min for 9 tickets, 1142 of them
stalled, 998 on one ticket. Before it: Lumaria#902 Waves 12 to 16
([waves-12-16-2026-10.md](research/waves-12-16-2026-10.md)), 289 min, 169 rework, 53 stalled.

| Bucket | Evidence | Prevention | State |
|---|---|---|---|
| A held state nothing wakes: a ticket parked on the owner, a failed closer or branch update, a conflicting PR, a required check that never starts | two thirds of a Spec's wall time (#1232); 44 of 70 min in the probed Wave (#1267); 47 min on #1018, green behind a `tickets / review` its caller could not start (Waves 12-16); 998 of 1339 min of #1086 on #1108, marked `checking` after a refused push with its review red, until the owner re-ran it by hand; 19 min on #1090 behind a fault the machine refused; the owner found both by asking; the closer's speed report made five timing reads before it closed, so one failed read left a merged ticket open and the run red (agent-skills#216); `bin/land` never brings a behind PR up to date (`bin/land:106-148`), so Lumaria#1046 and #1048 sat green and `BEHIND` about 35 min until a session updated them by hand (2026-10-09) | every held state has an event that wakes it, a clock only as a last resort; the builder never parks on the owner (ADR-0005) | #1276, #1281, #1283, #1293 built; a wake re-runs an open PR's failed checks (`d6f6de0d`); a required check that never starts is pending forever, a refused push still marks `checking` (`src/builder.ts:360`), and nothing wakes `checking` on a clock; the speed report is cut, so the closer reads nothing but the ticket before it closes (2026-10-14) |
| The Wave barrier: a ticket nothing depends on waits for the slowest | 9 h 40 min of tail over seven Waves (#1249); the slicer writes the dependencies it knows as prose; 11 to 20 min held on three tickets in Waves 14-15, costing the Spec nothing since each next Wave needed the slowest; #1086's Wave 4 held 6.5 min for reviewer follow-up #1106 | the slicer writes dependencies as edges; a ticket with none starts at once; the wave check stays a cadence | unruled; first ruling after #902 |
| One tree judged more than once | 1.7 full checks per ticket (#1267); machine CI re-ran tests (#1290); 1.6 per ticket in Waves 12-16, every repeat a branch-updated PR; in #1086 four branch-updated trees re-ran CI (589 s) and review, two after the owner's mid-Wave merges, and a meter write keeps the reviewer from reusing its own verdict (`src/reviewer.ts:322`); landing #1326, two `.md` files, ran the whole vitest suite (274 s) in its Check, then started over on the rebased tree, against Collin's target of seconds for a docs landing (2026-10-14) | receipts; one full check in the builder; CI covered | receipts built; a branch update still re-executes the tree |
| Structure drift: code written twice, a shared piece never cut first | 21 findings, 0 bugs (#1229, #1230, #1231); #1023, #1029, #1035 in Waves 12-16, and an unbounded read neither reviewer nor meters caught; in #1086 the tenant time zone written three times before #1098 merged them | the slicer cuts the shared piece first; the reviewer loads `codebase-design` | ruled (#1234); every stage, slicer and reviewer included, is handed `codebase-design` since 2026-10-14 (until then this row read ruled while only `testing` reached any stage); cost unproven, no gate |
| A held sentence is never tried again until the done check | all three done-check misses had held earlier and broke unseen, one for 58 h; 169 of 289 min of Waves 12-16 were the rework | every wave check also tries every sentence that held at an earlier wave or done check, and a wave that moves none still gets one | ruled by Collin 2026-10-15; built 2026-10-15, unmeasured |
| A fix wave sliced without the done check's findings | Wave 14 fixed the wrong cause of sentence 11, so Wave 15 (72 min) fixed what the done check had named; `slice --fix` runs before the findings post (`src/done-checker.ts:245`) | the done check posts its findings and hands them to `slice --fix` | built 2026-10-15: the findings post first, the fix-wave slicer is told to start from the cause they name, and the fix wave mark is added to that comment once the slice files; unmeasured |
| A gate that ends green without judging | 5 of 12 reviews in Waves 12-16 stood down as "moved" when the meters wrote the PR body; #1033 and #1035 merged on dropped drift verdicts, #1035 with a money-path regression; in #1086, 8 of 17 reviews stood down, 6 of 9 Spec PRs merged with no verdict, #1096's dropped drift was the gap sentence 9 then failed on (a 22 min fix wave), and #1099's UTC "today" is still on Lumaria main; the meter reviewer's untrimmed body read adds a newline each write (`src/meter-reviewer.ts:73`) | the reviewer never ends green without a verdict on the head it read | built 2026-10-14 for the meters' race: the fingerprint drops blank lines as well as meter lines, so a meter write no longer reads as the PR moving; a real move still ends green unjudged, since no newer run comes on an App edit; unmeasured |
| Each check writes its own browser driver | wave and done checks took 106 of 289 min and 39% of model spend in Waves 12-16; one wave check spent 39 of 42 min on its driver; #1086's five checks wrote five drivers, setup 26% of check time, and each built today's visits by hand since Lumaria's seed has none | the check stages carry one browser driver | ruled by Collin 2026-10-14: `~/bin/ui-check` from agent-skills on `playwright-core` and the runner's Chrome, every bin tool in `~/bin`, and a check prompt that settles a sentence at the server before a page and tries sentences side by side; built 2026-10-14, unmeasured |
| Jobs on the PC share Docker, /tmp and processes | Waves 12-16: a wave check reset and lost another job's Postgres twice (about 8 min); a builder's `kill` matched the owner's Next servers; on 2026-10-13 three repos each had a runner named `desktop-7vv7k71-1` and the Postgres was named after the runner alone, so a PW-Onboarding or workout-tracker job deleted Lumaria #1090's twice and parked it behind a fault; #1086's checks killed their own shell with `pkill -f` five times and one ran `docker exec` on the owner's worktree database | each job gets its own Postgres, ports and paths | unruled; the Postgres is named per repo and runner since 2026-10-13 |
| A fix spanning two repos carried by the owner | 8 of 14 by hand in a week (#1233); #1081, a Spec the agent-hooks reader filed as a ticket because its copied kinds list had no `spec`, cost 84 min and $4.65 before #1086 existed (fixed in `c33be58f`, `b6e0f039`) | one owning repo per kind of fix; agent-hooks reachable from a machine session | unruled (#1237) |
| Spot fixes outrun measurement | 97 machine PRs in a week, no Spec measured on one version (#1226); eight machine merges during Waves 12-16 and one 55 min before them, which shipped the review hold without Lumaria's caller; nine jobs ran one commit's workflow with another's code; eight machine merges and five agent-hooks releases during #1086, `e225700c` built and merged by the machine from a fault with no row, and the owner's rerun replayed `b1243401`'s workflow with `575bb9ae`'s code | the machine measures each Spec at its done check | measured by hand at #1086's done check (2026-10-14); measurement unbuilt; holding the machine still while a Spec runs is ruled out (2026-10-14), since a broken Spec needs its fixes landed to finish |
| Green work thrown away | in #1086, a `machine` answer ended #1090's job before commit and push (`src/builder.ts:287`), and its wake rebuilt the Day clock from main; a split closed PR #1109 and deleted its branch (`src/builder.ts:266`), so #1108's fix was written a third time; #1082 and #1083 built in full for a Spec filed as a ticket; $8.6 of $33.88 builder spend | none yet: brought to Collin 2026-10-14 | unruled |
| The memory guard kills runner jobs first | earlyoom killed builders #1082 and #1083 (86 MiB) and their repairs' checks, then the owner's 3.4 GB vitest that filled memory; the machine writes that order (`src/runner.ts:33`) and GitHub's runner sets `oom_score_adj 500` on every job | none yet: brought to Collin 2026-10-14 | unruled |
| No gate runs the app | #1104 sent a $0 callback to Collect; the reviewer and meters read code only (`src/reviewer.ts:13`), so Wave 4's check caught it and it became #1086's Wave 5; the Slicer's #1108 Decision claimed Collect took what issued invoices owe, and nothing checked it against main (#1110) | none yet: brought to Collin 2026-10-14 | unruled |

## Next

The order to work the rows in, kept here so no issue has to carry it. A row leaves this list when
its state moves.

Waiting on Collin's ruling:
1. A held state nothing wakes, the refused push behind #1108's 998 min. Timers only as a last
   resort (2026-10-15). Proposed and not approved: when a ticket's PR is open, its build starts from that
   PR's branch; after a green save the job re-runs what is red on the commit it pushed; the
   moved-commit test, `ranAs` and #1321's re-run block go. The bigger idea, one builder holding its
   ticket to merge, is #1331.
2. Green work thrown away, the memory guard killing runner jobs first, and no gate running the
   app: each needs a prevention.
3. Jobs on the PC share Docker, /tmp and processes; the Wave barrier; a fix spanning two repos.

Open under a named prevention:
4. A held state nothing wakes: a required check that never starts; `bin/land` and a behind PR.
5. One tree judged more than once: a branch update, or a docs landing, re-executes the tree.
6. Spot fixes outrun measurement: the measurement, and jobs that run one commit's workflow with
   another's code.
7. The lone failures in [waves-12-16-2026-10.md](research/waves-12-16-2026-10.md) and
   [spec-1086-2026-10.md](research/spec-1086-2026-10.md), as one sweep.

Built and unmeasured until the next Lumaria Spec's done check: a held sentence, the fix wave, the
gate that ends green, the browser driver.
