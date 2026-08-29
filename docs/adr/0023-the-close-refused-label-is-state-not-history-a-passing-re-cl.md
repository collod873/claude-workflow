# The close-refused label is state, not history — a passing re-close lifts it

Recorded 2026-08-25.

Status: superseded by ADR-0088

A refused close reopens the issue and applies `close-refused`. Until now nothing removed it, so
#55 wore the label after a *successful* repair — refused as `criteria-count-mismatch` in run
32916493809, then passed as `met` in run 32916632278, and still labelled. The gate now lifts the
label on any close it accepts.

The label is the one part of a refusal that a query can filter on, and anything that filters open
work by it — triage, a wayfinder sweep, a future dashboard — would have counted every repaired
close as an outstanding one. A label whose meaning nobody has decided is the same shape as an
uncounted gate.

## Considered options

**Declare it history and count refusals from it.** Defensible: a refusal did happen, and that is
true forever. Rejected because a label is read as present-tense by every tool and every human that
meets it, and the counting it would serve is served better by things that cannot be lifted — the
refusal comment stays on the issue, and the Actions run stays in the log. Nothing should ever count
refusals from this label.

## Consequences

A close marked `not planned` or `duplicate` does not lift the label, because `close-gate.yml`'s
job-level `if` spends no runner on one (ADR-0013) and the gate is therefore not present to lift
anything. Withdrawing a delivery claim leaves the refusal standing; only a re-close the gate
accepts ends it.
