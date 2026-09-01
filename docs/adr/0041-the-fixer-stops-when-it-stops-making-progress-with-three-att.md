---
status: note
date: 2026-08-26
reversal: The progress test and the three-attempt ceiling are exit conditions inside the fixer loop; changing either changes how many red PRs reach `blocked`, which the label already counts, and ADR-0011's gating of move 10 turns on the fixer existing rather than on its cap.
---

# The fixer stops when it stops making progress, with three attempts as the ceiling

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
