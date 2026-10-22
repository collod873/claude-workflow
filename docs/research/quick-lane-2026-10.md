# What the quick lane needs: memory and runner count

Researches: [#1428](https://github.com/collod873/claude-workflow/issues/1428)

Recorded 2026-10-22. Facts behind `QUICK_RUNNERS` and `QUICK_RUNNER_MEMORY_GB` in
`src/runner.ts`. Times are UTC.

Sources: every Lumaria Actions run created 2026-10-22 (769 runs, every attempt, from the runs and
jobs APIs, pulled at about 14:30), of which 474 quick-lane jobs ran between 02:04 and 13:56; and
the memory of the processes a quick job starts, read on the GitHub runner that built #1428.

## Memory

A quick job runs one of three things at a time, so its peak is the largest, not their sum.

| What | Peak | How read |
|---|---|---|
| `npm ci` of the machine checkout (`review`, `meters`) | 388 MiB | `/usr/bin/time` max RSS |
| a stage's model session and its node driver (`review`, `meters`) | 327 + 90 = 417 MiB | `VmHWM` of `claude` and of the driver, read in a builder session after three rounds, longer than any review |
| a machine script and `gh` (`which`, `close`, `strip`, the rest) | about 50 to 90 MiB | `/usr/bin/time` max RSS of `bin/close` and `bin/which` |

The reviewer and the meters are handed Read, Grep and Glob, no shell, so nothing they do builds or
tests. The heaviest quick job peaks near 420 MiB. Each quick runner gets **1 GB**, over twice that,
and the slice holds **8 GB**, exactly its runners' caps added up, so the slice never picks who is
killed.

## Time

| Job | Ran | p50 | p95 | Max |
|---|---|---|---|---|
| `review` | 51 | 1.5 min | 2.0 min | 2.2 min |
| `meters` | 51 | 1.4 min | 1.9 min | 2.1 min |
| `close` | 123 | 0.2 min | 2.2 min | 4.3 min |
| `which` | 23 | 0.1 min | 0.2 min | 2.2 min |
| `strip`, `rerun`, `dispatch-rerun`, `ended`, `resumed`, `asked` | 226 | 0.2 min or less | 0.3 min | 0.3 min |

The 22 `close` runs over 30 s brought a PR up to date with a full check, which now runs in the
`update` job on the build runners.

## How many runners

The day's quick jobs replayed in queue order, each starting on the first free quick runner and
running as long as it did:

| Quick runners | `which` and `close` wait, p95 | Max | Over a minute |
|---|---|---|---|
| 4 | 154 s | 193 s | 26 of 146 |
| 6 | 82 s | 98 s | 14 of 146 |
| 8 | 42 s | 53 s | 0 of 146 |

The waits come from bursts: at 13:37:35 to 13:37:37, 25 jobs were queued in three seconds. Replayed
with every `close` cut to 30 s, as moving its update out does, 4 runners still leave 23 over a
minute and 6 and 8 do not move, since the bursts are short jobs. **Eight** quick runners
start every `which` and `close` of the day within a minute; at 1 GB each they fit the 8 GB slice.
