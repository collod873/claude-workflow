---
status: note
date: 2026-08-28
reversal: Putting `bin/clone-gate` back into the test slot and pointing `.husky/pre-push` at `bin/gauntlet push` again is a scheduling change confined to the gauntlet wrapper, the husky hook and one CI step; what it buys back is a two-second token scan on the end of every turn.
---

# The clone gate runs beside the gauntlet, not inside it, so the turn-end venue never pays for it

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
