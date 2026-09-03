---
status: constraint
date: 2026-09-03
reversal: Undoing it means a `tests/acceptance/` directory red on `main` again, restored from trunk's tip by a Verify job of its own, with its own push gate, land gate, clone baseline and immutable-set entry — and a gate whose size is bounded by nothing but who owns each file.
---

# An acceptance test is colocated and marked test.fails, and the gate is fenced by size

Two rulings from one audit (#360). The gate had grown to ~5,600 lines and 13% of every commit:
five push checks passed silently on missing input, the stop venue fell back to the whole suite,
and seven acceptance tests spawned the suite from inside it — with an owner on every file.

**Acceptance tests live beside their subject and land green.** The author writes the test where
the subject is, imports it, and marks it `test.fails(` naming the ticket. The implementer may
change that line only by dropping `.fails`; `bin/close-ticket` refuses a ticket a surviving
`test.fails(` still names.

**The gate is a fixed file list under a line cap.** `.claude/gate-size.test.ts` sums the list and
fails above the total measured after the cleanup. A lane may null a slot, never add one.

**Rejected:** `tests/acceptance/` red on `main` (unshardable, uncacheable), and fencing the gate by
ownership — the shape that grew it.
