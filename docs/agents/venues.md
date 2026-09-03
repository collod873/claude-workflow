# Venues

**A venue is a place a check can run: `turn`, `stop`, `push`, and Actions behind them. A check sits
at the earliest venue that can afford it ([ADR-0010](../adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)),
because what "earliest" buys is the cost of the *repair* — a type error caught in the turn that
caused it is fixed with the context still hot.**

`bin/gauntlet <venue>` is the one runner for all three. What it runs is whatever
`.claude/contract.json` names ([ADR-0056](../adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)),
never a hardcoded `tsc`/`eslint`/`vitest`, so an enrolled repository is checked by the same machine
as this one ([ADR-0139](../adr/0139-an-enrolled-repository-is-checked-by-the-machine-s-gauntlet.md)).

## What each venue runs

| Venue  | Fires at            | Checks                                                                                             | On failure                       |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------- |
| `turn` | PostToolUse, per edit | `typecheck`, `lint` (`lint_one` where the contract has one), `test_related` — the tests importing that file | Hands the report back to Claude  |
| `stop` | Stop, per turn end  | `typecheck`, `lint`, and the test files whose measured cost fits here                               | Reports once, never holds the turn |
| `push` | pre-push            | The above plus the whole suite and eight repo-wide checks (contract, corpus, clones, wiring, workflows, trailers, adrs, boundaries) | **Refuses the push**             |

Only `push` fails closed. The two in-session venues cannot refuse and are not meant to: PostToolUse
fires after the edit has landed, and a venue that wedges every turn is worse than the defect it was
catching. `.claude/hooks/gauntlet-hook.mjs` owns that half.

## Timing is recorded, never judged

**No venue refuses on a duration.** Every `bin/gauntlet` run writes what it measured — the venue,
the wall clock, and each check's own time, alongside the core count it ran with — to
`.gauntlet-timings.json` at the target root. The file is gitignored, overwritten on every run, and
nothing here reads a verdict out of it: no run is compared against a number measured somewhere
else, and no run refuses because of one.

That used to not be true. A venue's number was once its own last green time plus a margin, recorded
in a committed baseline and ratcheted on every green run, and a run past the margin refused the
push. The reversal ([ADR-0148](../adr/0148-timing-is-recorded-never-judged.md)) is the record of
why: two Verify runs judging the same pull request agreed with each other within 1.2% while missing
the committed number by 53%, each naming a different check as the slowest offender. The split was
contextual — the number was measured inside one job and read cold in another — and nothing in a
single millisecond count said which. A gate that goes red on where it ran teaches its reader to
rerun until green, which is a runner cycle that teaches nothing.

CI uploads the artifact so a slow run is still legible after the fact; nothing in the gauntlet
itself reads it back.

## How a file moves venue

One thing still uses a measured number: which test files the stop venue may run. It admits files
**cheapest-first** from this workstation's own measurement
(`.Workflow/agent-workflows/shared/timing-baseline.local.json`, gitignored — a wall-clock number is
only ever true on the machine that measured it) until the next one would cross a **hard 5000 ms
wall**; everything past that runs at `push` instead. The wall never fails a check; it only decides
which files `stop` gets to run.

The candidates are read off the tree on every run, not out of the last measurement, so **a test
file with no measurement yet is treated as free and runs** — the same "record rather than judge"
rule the gauntlet applies everywhere else. A selection drawn from the measured set alone would
silently skip every file written since the last measurement, which is a gate that goes quieter
exactly as a repo gets busier.

What sits at push today is the handful of files that drive their subject as a real process — a
hook, a CLI, a `git` invocation. That is the honest way to test a thing whose contract *is* its
exit code, and it is also why they are too expensive for a 5000 ms wall.

To refresh this workstation's own file times by hand:

```
node .Workflow/agent-workflows/shared/timing-baseline.ts measure .
```

## Concurrency

Checks inside a venue run concurrently, so a venue's wall clock is its slowest check's rather than
the sum of them. With **fewer cores than checks**, the test slot starts *after* the cheap ones
instead of beside them: vitest sizes its worker pool from the same cores (`vitest.config.ts`), and
eleven concurrent checks on a two-core runner is contention that manufactures failures rather than
finding them.
