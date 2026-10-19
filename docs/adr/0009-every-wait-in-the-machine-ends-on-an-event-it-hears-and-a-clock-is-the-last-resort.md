---
status: constraint
date: 2026-10-19
reversal: Every wait would be a sleep tuned by hand again, and a stopped ticket would sit until the owner asked about it.
---

# Every wait in the machine ends on an event it hears, and a clock is the last resort

Whatever the machine leaves waiting, a PR behind main, a required check that never started, a
push that was refused, a ticket parked on a fault, it also names the event that moves it on, and
that event does the work: a check completing, a PR merging, an issue closing, a dispatch. A clock
is taken only where no event exists, and then it wakes to look and waits again; it is never the
plan. A new wait with no event named is a failure, and goes to `docs/buckets.md` before it ships.

**Rejected: long sleeps and polling timers.** A sleep outlives the thing it waits for, and a timer
wakes for nothing or too late and ends up tuned per stage. Lumaria#1108 sat 998 of a spec's 1339
minutes in a state nothing watched, until the owner asked.

Evidence: `docs/research/owner-rules-2026-10.md`, N2; `docs/research/spec-1086-2026-10.md`; the
owner, 2026-10-15.
