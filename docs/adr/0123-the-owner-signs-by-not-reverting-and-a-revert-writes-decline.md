---
status: constraint
date: 2026-08-31
amends: ADR-0006
reversal: Putting a signature surface back means re-adding an approval step no lane now has and replacing the tree-versus-memory detector that writes `declined` records, and abandoning revert rate as the measurement ADR-0006 promised — while every standard landed under this model has already merged with no one asked to approve it.
---

# The owner signs by not reverting, and a revert writes declined memory

A ratified standard lands as a merged pull request the owner did not have to touch. To decline one he reverts it — or deletes the rule in any later commit — and a push-triggered detector writes a `declined` record, suppressing the finding until it grows a site the decision never covered. There is no checkbox, no approval step and no review surface anywhere in the lane.

An unticked box is indistinguishable from a pull request nobody read: not-reading and declining produce byte-identical evidence, so the checkbox carried a click, not a signal. A revert cannot be produced by inaction. Silence now means yes rather than unread, and revert rate is a real number over a real denominator, which is the measurement ADR-0006 asked for.

The detector compares tree against memory: entry names and enabled rule ids against each `ratified` record's `landedAs`, no revert-message parsing and no queue.
