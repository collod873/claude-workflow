---
status: constraint
date: 2026-09-06
amends: ADR-0114
reversal: Putting a per-lane recovery door back makes every way a run can die one `if:` in YAML again that has to fire for the ticket to move, the state #384 measured on 2026-09-02 as ten Implement runs cancelled in a minute and no Recover run after any, and moves the strike count off the tracker into a lane's own artifacts.
---

# Reconcile is the only connector that starts work, and it fires on every ending, so a dead run is a strike the ladder climbs rather than a ring that has to arrive

Five of the six holes in #384 were one defect: a lane died and the event saying so never reached
a reader. Recover listened for Implement alone, through a step a cancellation skips. The
reconciler already reads the whole tracker; it fired on the wrong events and read "started" from
leftover branches.

Every caller stub's completion and every push to main now wake it. A ticket is in flight when a
live run carries its number or its branch holds a pull request; a bare branch is released. Each
dead Implement or Mechanic run is one strike comment on the ticket, and the count picks the rung:
implementer, fresh eyes, mechanic, then the owner's decision. No lane rings another.

**Rejected: a mechanic lane woken by a `stop` ring from every lane.** A model paid to notice a
missing ring, and one more lane whose stops need a reader.
