# A refusal ships only once something can clear it

Recorded 2026-08-23.

No venue is promoted to refusing until the thing that clears its red already exists. A gate with
nothing behind it does not stop work; it parks work, and parked work is a queue that drains onto the
owner — the one outcome the whole design is built to avoid.

`DESIGN.md` §10 originally opened with branch protection, on the reasoning that trunk must be able
to refuse before anything merges unattended. The reasoning is right and the position is wrong.
Refusal without repair converts a broken `main` into a stalled pull request. Both cost the owner;
the stall merely costs him later and more quietly. The fixer that clears a red — one Sonnet per red
pull request, three attempts, then `blocked` with its notes — is lane 05, and lane 05 is weeks
downstream of an afternoon's configuration.

The order is therefore **feedback, then repair, then refusal**. Feedback is free and immediate and
is where the throughput actually is (ADR-0010). Repair is what makes a red survivable without a
human. Refusal is the backstop for the case where an agent bypassed both, and it is the only rung
that costs money — GitHub protects no branch on a private repository under the Free plan, so this
one is a purchase rather than a setting.

## Considered options

- **Protection first, land work by hand until the fixer exists** — rejected. Every red pull request
  becomes an owner touch during exactly the weeks C1 says an era dies: overhead up, output
  unchanged.
- **Protection first, accept the stall** — rejected on the same grounds, one step later.
- **Protection last, behind feedback and repair** — chosen. It also reorders the spend: nothing is
  bought until something is measurably being caught.

## Consequences

**`DESIGN.md` §10 no longer claims to follow `GOAL.md` §4.** It never did — move 1 retired blocker
5, the last item on that list, while blocker 1 waited. The build order is ordered by what unblocks
what, and blocker 5 is now retired in two halves at opposite ends of it: the free venues early, the
refusal at trunk last.

**Blocker 5 is downgraded, not deferred.** The free venues catch the great majority of what reached
`main` in those five days — genuine `unit`/`build` breakage, all of it visible to a typecheck or a
suite that ran before the push. What protection adds on top is the guarantee against an agent that
routes around them, which is a narrower and later problem than the one measured.

**`--no-verify` becomes the thing worth watching.** Until the refusal rung exists, every free venue
is bypassable by an agent that decides to. That is a class the design has no counter for yet, and it
belongs in §6 rather than being assumed away.
