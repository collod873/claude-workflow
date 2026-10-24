# Root causes

The machine's symptoms, grouped by root cause, as the last audit Collin ran found them. Only an
audit edits this table, rewriting each cell rather than appending to it; what a row said before is
in `git log -p docs/root-causes.md` and `git log -p docs/buckets.md`.

- **Root cause**: why the symptoms happen, one line.
- **Symptoms**: the strongest measured symptoms of that root cause, with links; a newer
  measurement replaces an older one.
- **Countermeasure**: the change that stops the root cause recurring, as it stands now. A ruling
  later work must follow is an ADR Collin files; the row links it.
- **State**: `unruled`, `ruled`, `built` or `measured`, then the issues or ADRs that carry it in
  brackets, e.g. `built (#1462)`.

A root cause a measured Spec shows no recurrence of is deleted.

Last measured: Lumaria#1086 from filing to its done check, 2026-10-14
([spec-1086-2026-10.md](research/spec-1086-2026-10.md)): 1339 min for 9 tickets, 1142 of them
stalled, 998 on one ticket. Before it: Lumaria#902 Waves 12 to 16
([waves-12-16-2026-10.md](research/waves-12-16-2026-10.md)), 289 min, 169 rework, 53 stalled.

| Root cause | Symptoms | Countermeasure | State |
|---|---|---|---|
| A held state nothing wakes: a ticket parked on the owner, a failed closer or branch update, a conflicting PR, a required check that never starts | 998 of #1086's 1339 min on #1108, `checking` after a refused push until the owner re-ran it; two thirds of a Spec's wall time (#1232); Lumaria#1283's builder hit its 45 min cap running the full check itself (2026-10-23) | every held state has an event that wakes it, a clock only as a last resort (ADR-0009); the builder never parks on the owner (ADR-0005) | built (#1371, #1489) |
| The Wave barrier: a ticket nothing depends on waits for the slowest | 9 h 40 min of tail over seven Waves (#1249); #1086's Wave 4 held 6.5 min for #1106 | no waves: each slice is cut at its last responsible moment on the spec's integration branch and built once what blocks it merges, by `bin/schedule` (ADR-0013) | built (#1509) |
| One tree judged more than once | 1.7 full checks per ticket (#1267); in #1086 four branch-updated trees re-ran CI (589 s) and review; landing #1326, two `.md` files, ran the whole suite (274 s) | a test runs only when a file it read changed, in every repo | built (agent-hooks#105) |
| Structure drift: code written twice, a shared piece never cut first | 21 findings, 0 bugs (#1229, #1230, #1231); in #1086 the tenant time zone written three times before #1098 merged them | the slicer cuts the shared piece first; every stage loads `coding-standards` | built (#1234) |
| A held sentence is never tried again until the done check | all three done-check misses had held earlier and broke unseen, one for 58 h; 169 of 289 min of Waves 12-16 were the rework | every wave check also tries every sentence that held at an earlier wave or done check | built |
| A fix wave sliced without the done check's findings | Wave 14 fixed the wrong cause of sentence 11, so Wave 15 (72 min) fixed what the done check had named | the done check posts its findings first and hands their cause to `slice --fix` | built |
| A gate that ends green without judging | in #1086, 8 of 17 reviews stood down as "moved" and 6 of 9 Spec PRs merged with no verdict; #1096's dropped drift was sentence 9's 22 min fix wave | the reviewer never ends green without a verdict on the head it read; built for the meters' race only, an App edit's real move still ends green | built |
| A run that goes red without judging | `bin/land` handed back two green PRs GitHub refused only for racing main, "Base branch was modified": claude-workflow#1492 (2026-10-23) and PW-Zone2#165 (2026-10-21) | a run is red only when something it judged failed | built (#1503) |
| Each check writes its own browser driver | wave and done checks took 106 of 289 min and 39% of model spend in Waves 12-16; #1086's five checks wrote five drivers | the check stages carry one browser driver, `ui-check` | built |
| Jobs on the PC share Docker, /tmp and processes | Lumaria#1439 stuck twice on 2026-10-24: a slice temp dir too long for tsx's socket, then slice worktrees under .git where Vite loads no DOM test setup; on 2026-10-22 eight runners sat on four CPUs | each job gets its own Postgres, ports and short paths, a spec's slice worktrees and temp dirs under the job's short TMPDIR, an equal CPU share, and room for two full checks in a 28 GB slice | built (#1487) |
| A fix spanning two repos carried by the owner | Lumaria#1382 and #1393 sat stuck about 30 min until design-kit#191 and #193 were filed by hand; earlier 8 of 14 by hand in a week (#1233) | the ticket builder answers `owned`, files the first step in the owning repo and waits; admission follows the chain across repos; the closer wakes it. Third countermeasure: a recurrence means reshape or scrap | built (prompts-audit-fixes) |
| Spot fixes outrun measurement | 97 machine PRs in a week, no Spec measured on one version (#1226); eight machine merges during #1086 | the machine measures each Spec at its done check, counting one machine version (ADR-0010) | ruled (ADR-0010) |
| Green work thrown away | $8.6 of #1086's $33.88 builder spend; a split closed PR #1109, so #1108's fix was written a third time; #1467's work sat in a merge commit `bin/land`'s rebase drops | a builder that finds its work on main closes it completed; a branch with a merge commit past main goes back to the builder red | built (#1453, #1493) |
| The memory guard kills runner jobs first | earlyoom killed builders #1082 and #1083 (86 MiB) before the owner's 3.4 GB vitest | earlyoom kills the biggest process; runner jobs keep the score their memory earns | built (#1372) |
| Parallel work conflicts on one file | 22 `bin/land` refusals, 10 purely mechanical (kit/KIT.json syncs, drizzle migration numbers), about 61 min lost | `bin/land` rebases a `DIRTY` PR and closes only on a real conflict; a settle map rebuilding derived files on rebase waits on Collin | built (prompts-audit-fixes) |
| No gate runs the app | #1104 sent a $0 callback to Collect and only Wave 4's check caught it; the reviewer and meters read code only | none yet: brought to Collin 2026-10-14 | unruled |
| A review loop with no end: the same gap comes back each try and nothing stops it | #1382 went from try-2 to try-7 in 50 min, the reviewer naming the same gap four times | a gap the reviewer names on two tries in a row stops the ticket and brings it to Collin | built (#1402) |
| Jobs started for nothing hold the build lane: a job takes a build runner only to read its labels and skip | 62 Lumaria slice and research jobs took a `pc` runner to read labels and skip, about 25 runner-minutes (#1461) | one quick job on the quick runner reads the labels before any build-runner job starts | built (#1462) |
| A finding with nowhere to go: a judge sees a fault and its verdict carries it nowhere | about 24 of 43 risks lived only in PR comments, one a double charge (Lumaria#1332); 20 of 35 builder notes dropped | every risk ends `fixed`, `owner` or `nothing` in the answer and code files it, gathered across rounds; the builder's note goes to its reviewer; spec reviewers too | built (prompts-audit-fixes) |
| A stage's prompt carries dead, copied or missing text | a stale copy of the testing rule had lost isolation; 5 of 32 builders ran the full check; the red tail held passing tests in 4 of 5 | reshaped by Collin: no shared text, each prompt self-contained and pointing only at skills; the prompts step refuses an 8-word run two modules both say | built (prompts-audit-fixes) |
| A job outlives its App token: the one-run path mints one token, which GitHub ends after an hour | Lumaria#1332's run minted its token at 16:42 on 2026-10-23; at 17:42 `bin/land`'s push failed on credentials after a green 452 s full check, and the ticket landed 27 min later on a rerun | the machine mints a fresh App token right before `bin/land`, and the key never reaches the model's process | built (#1504) |
| Generated files flood diffs: Drizzle's per-migration schema snapshots read as code | Lumaria#1442 added 95k lines, 85k of them snapshots: its 2.86 MB diff, 481 KB without them, split spec Lumaria#1439's end review into 17 serial reviewers, about 80 min; reviewers hand-exclude `meta/NNNN_snapshot.json`; a false PR-size alarm on 2026-10-09 was 7,577 of 9,156 lines one snapshot | each Drizzle repo's `.gitattributes` marks `<meta dir>/*_snapshot.json` `-diff linguist-generated=true`: one Bin line in git diff, show and --stat, folded on GitHub, still merged as text; crewops waits, its own clones step red on main | built (Lumaria#1468, PW-Zone2#269, workout-tracker#333) |

## Next

Build what is ruled, then measure it all on one Spec, so the measurement covers one machine
version (#1377): file the Lumaria kit Spec, measure it at its done check as
[spec-1086-2026-10.md](research/spec-1086-2026-10.md) was, move each `built` row, then read #1335
against it. Waiting on Collin: no gate running the app.
