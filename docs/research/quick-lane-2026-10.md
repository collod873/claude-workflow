# What the quick lane needs: memory and runner count

Researches: [#1428](https://github.com/collod873/claude-workflow/issues/1428)

Recorded 2026-10-22. Facts behind `QUICK_RUNNERS` and `QUICK_RUNNER_MEMORY_GB` in
`src/runner.ts`. Times are UTC.

Sources: every Lumaria Actions run created 2026-10-22 (769 runs, every attempt, from the runs and
jobs APIs, pulled at about 14:30), and the memory of what each quick job starts, read on the GitHub
runner that built #1428.

## Which jobs

Since ADR-0012 a ticket's one `build` run builds, reviews and lands it, so `review`, `which`,
`meters` and `fix` are gone. The jobs left that build nothing are `close`, `strip`, `enrol`,
`rerun` and `dispatch-rerun` in `tickets.yml`, and `ended`, `resumed`, `asked` and
`dispatch-rerun` in `specs.yml`. `research` hands its model an open shell, so it stays with the
builds.

## Memory

None of them hires a model. A job runs one thing at a time, so its peak is the largest.

| What | Peak | How read |
|---|---|---|
| `npm ci` of the machine checkout (`enrol`) | 388 MiB | `/usr/bin/time` max RSS |
| a machine script and `gh` (the rest) | about 50 to 90 MiB | `/usr/bin/time` max RSS of `bin/close`, and `VmHWM` of a stage's node driver |

Each quick runner gets **1 GB**, over twice the heaviest, and the slice holds **8 GB**, exactly
its runners' caps added up, so the slice never picks who is killed.

## How many runners

The 349 runs of those jobs on 2026-10-22 took 8 to 15 s at the median and 21 s at most,
all but `close`, whose 22 runs over 30 s brought a PR up to date, which ADR-0012 took out of it; each
`close` is cut to 30 s below. Replayed in queue order, each starting on the first free quick runner
and running as long as it did:

| Quick runners | `close` wait, p95 | Max | Over a minute |
|---|---|---|---|
| 2 | 390 s | 499 s | 33 of 123 |
| 4 | 161 s | 191 s | 22 of 123 |
| 6 | 87 s | 98 s | 13 of 123 |
| 8 | 42 s | 52 s | 0 of 123 |

The waits come from bursts: between 13:37 and 13:38, 39 of them were queued, 16 `close` and 15
`strip`. **Eight** quick runners start every `close` of the day within a minute.
