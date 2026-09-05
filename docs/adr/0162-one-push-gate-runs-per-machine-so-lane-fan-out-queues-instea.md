---
status: constraint
date: 2026-09-05
reversal: Reversing it means a lane fan-out again runs N full gates at once, the shape of 2026-09-05, when six sessions' push gates put 4,061 earlyoom kills, load 537 and 3,102 forks/s on a 24 GB VM until `wsl --shutdown`.
---

# One push gate runs per machine, so lane fan-out queues instead of forking

The push venue is ten node processes plus half the machine's cores in vitest workers. One is
sized for the box; six at once are not, and a lane queue refills faster than earlyoom can kill.
The cap and the killer both worked on 2026-09-05; the VM still stalled for ninety-seven minutes.

So `bin/gauntlet push` takes one machine-wide `flock` first. N lanes are one running and N−1
waiting; the wait is wall-clock only, and timing is recorded, never judged
([ADR-0148](0148-timing-is-recorded-never-judged.md)). One file covers every target, because the
box is what is shared. A gate inside a held gate runs through, so the suite's scratch
gauntlets cannot deadlock on their parent, and `turn` never takes it, because an in-session venue
must not wedge.

**Rejected: capping vitest workers for lane-spawned runs.** It shrinks each gate and leaves N of
them; the incident is the count, not the size.
