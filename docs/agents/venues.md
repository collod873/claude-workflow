# Venues

**A venue is a place a check can run: `turn`, `stop`, `push`, and Actions behind them. A check sits
at the earliest venue whose budget it fits ([ADR-0010](../adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)),
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

## Budgets are baselines, not numbers

**No venue budget is written down anywhere.** A venue's budget is *its own last green time plus a
25% margin*, recorded per check in the **timing baseline** and ratcheted on every green run
([ADR-0140](../adr/0140-a-venue-s-budget-is-its-own-last-green-time-plus-a-margin-ne.md)). It is the
same baseline-the-delta family as the wiring, clone and boundaries gates: the file is the measure,
and a number in a comment is not.

The margin cuts both ways. A run slower than baseline + 25% is over budget and names the slowest
check; a run faster than baseline − 25% rewrites the baseline; anything between leaves the file
alone. A check with no entry yet is recorded, never judged. Without the lower half, one lucky fast
run would set a bar the next honest run could not clear.

Two files, because a millisecond is only true where it was measured:

| File                                                          | Holds                    | Written by                                    |
| ------------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| `.Workflow/agent-workflows/shared/timing-baseline.json`        | the runner's numbers     | lane 05's regenerate step, which runs the **push venue** against the target on the runner and commits what it measured ([ADR-0145](../adr/0145-the-committed-venue-half-is-written-by-lane-05-s-push-venue.md)) |
| `.Workflow/agent-workflows/shared/timing-baseline.local.json`  | this machine's numbers   | every `bin/gauntlet` run off CI (gitignored)  |

The push venue is the only caller that may write the committed file: it runs under a seam that
lets its own `record` call write despite being on a runner, set nowhere else. A plain
`bin/gauntlet push` on a runner — including the Verify run that judges the same pull request —
still judges the committed file and discards, because a Verify checkout is thrown away and a
write there would only leave a dirty tree under a commit nobody owns.

A run is judged against the file for where it ran. Nothing merges them, and nothing keys them by
core count — this repo's public runners have 4 cores, Lumaria's private ones 2, and the workstation
32, and a key would have to mean the same thing in every enrolled repository. The core count is
recorded as a *field*, so a runner-class change is visible in a diff.

## How a file moves venue

It moves itself. A test file may run at `stop` when it costs **at most a fifth of the suite's own
wall clock**; anything more runs at `push`. That share is read from the timing baseline's `suite`
half, so the day a file grows past it, the next `measure` puts it at push — nobody keeps a list.

The candidates are read off the tree on every run, not out of the baseline, so **a test file with
no measurement yet runs** — the same "record rather than judge" rule the ratchet applies to a check
it has never seen. A selection drawn from the measured set would silently skip every test written
since the last measurement, which is a gate that goes quieter exactly as a repo gets busier.

What sits at push today is the handful of files that drive their subject as a real process — a
hook, a CLI, a `git` invocation. That is the honest way to test a thing whose contract *is* its
exit code, and it is also why they belong at the venue that can afford them.

To refresh the suite's file-share ratios by hand:

```
node .Workflow/agent-workflows/shared/timing-baseline.ts measure .
```

## Concurrency

Checks inside a venue run concurrently, so a venue's wall clock is its slowest check rather than
the sum of them — which is why the budget above is the slowest check's, not a total. With **fewer
cores than checks**, the test slot starts *after* the cheap ones instead of beside them: vitest
sizes its worker pool from the same cores (`vitest.config.ts`), and eleven concurrent checks on a
two-core runner is contention that manufactures failures rather than finding them.
