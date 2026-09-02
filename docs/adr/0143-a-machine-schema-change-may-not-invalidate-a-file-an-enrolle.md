---
status: constraint
date: 2026-09-02
reversal: Every enrolled repository would again have to be swept and regenerated whenever a schema here gains a field, and until that sweep landed its gauntlet would refuse to run any check at all — a machine-wide outage produced by a one-line schema edit, arriving in a caller that had changed nothing.
---

# A machine schema change may not invalidate a file an enrolled repository has already committed

A caller runs machinery it does not own (ADR-0009) but commits files the machinery reads,
`.claude/contract.json` first among them. A required field added here therefore breaks every
repository that committed the file before it existed, and breaks it at the worst place:
`bin/gauntlet` resolves the contract before running anything, so an unparseable one means *no check
runs* rather than one check failing.

Not hypothetical. #335 added a `test_related` slot on its own criterion that a contract omitting it
degrades to no turn-venue test run, then made it required — and Lumaria's first Verify run under it
died in 62 seconds having measured nothing.

So a new field is optional, defaulting to the degradation the change already promised.
**Rejected:** the enrol lane writing every caller's contract, which buys the same compatibility by
making this repository the author of a file the caller owns.
