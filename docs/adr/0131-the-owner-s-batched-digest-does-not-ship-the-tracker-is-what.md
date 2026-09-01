---
status: constraint
date: 2026-09-01
reversal: Reviving the digest means building the push notification, the one mechanism in the design capable of making C7's own test score worse than the zero it holds today, and it re-opens a reader that ADR-0039 already emptied of every other Foundry mechanism.
---

# The owner's batched digest does not ship: the tracker is what reaches him

The Foundry gave C7 four mechanisms. ADR-0039 struck three on measurement — the queue cap, the
five-day expiry, the governor. The digest is the last; the same history strikes it.

Its halves fail separately. The push is the only thing in the design that could make C7's own test —
*how many times a day does this interrupt?* — score worse than the zero a tracker read at leisure
scores. The batching half is what a tracker already is: 72 issues closed at a 1.5 h median, a peak
of 23 open against a ~7 cap with no stall.

**C7 stands** — the constraint is bounded human, not this interface. No counter, lens or lane may
name the digest as its reader.

**Rejected:** the batching half alone, which buys a second copy of the tracker.

`brief` in ADR-0043 and ADR-0069 is the *implementer's* brief, a different object.
