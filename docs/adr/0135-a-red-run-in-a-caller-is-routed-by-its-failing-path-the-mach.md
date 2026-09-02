---
status: superseded
date: 2026-09-01
superseded_by: ADR-0141
reversal: Every enrolled repository would need either its own editable copy of the machinery, which ADR-0009 forbids, or a human triaging each red run by hand to decide whose defect it is — and the tickets already filed here under this rule would belong to nobody, since the repository that reported the failure is not the one that can fix it.
---

# A red run in a caller is routed by its failing path: the machine checkout files a ticket here, the caller's own tree keeps it

Under ADR-0055 a caller runs machinery it does not own and may not edit in place (ADR-0009), so a
red run there has two possible authors and only the run can tell them apart. The failing path is
the answer: inside the machine checkout it is this repository's defect, inside the caller's own
tree it is the caller's.

A machine-side failure files a ticket-shaped issue **here**, through the `to-build` door, carrying
the machine SHA, the run URL and the log tail. This repository's implementer fixes it and every
`@main` stub picks the fix up on its next run. A caller-side failure goes to the caller's own
tracker and fixer.

The routing is a string comparison and spends no model. The alternative weighed — a model reading
the log to classify the failure — buys judgement where the path is exact, and pays for it on every
red run everywhere.
