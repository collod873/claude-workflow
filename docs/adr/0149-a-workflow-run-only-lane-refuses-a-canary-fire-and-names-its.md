---
status: constraint
date: 2026-09-03
amends: ADR-0146
reversal: Reversing it means bin/canary provisions a second caller stub (the upstream lane's) into
  every canary target just to reach a workflow_run-only one — a stub whose `with:` merge and job
  `if:` both have to be replayed correctly, and a summary that now has to say which of two runs'
  verdicts is the one being proven. Getting back to one stub per canary means deleting that.
---

# A workflow_run-only lane refuses a canary fire and names its upstream lane, rather than bin/canary firing that upstream itself

`bin/canary prove --lane <name>` now derives its fire from that lane's own caller YAML rather than
one push for every lane. Two lanes — Bypass counter, Review — carry no door but
`workflow_run: workflows: ["Verify"]`: no push, no dispatch, no label. Firing one run means also
firing Verify and letting its completion carry the event forward.

That would work, but it stops answering the question ADR-0146 asked: one lane's real code at one
ref, one checkout SHA, one runner label. Reaching Review through Verify means two stubs, two runs,
and a verdict that has to pick one — `bin/canary-graph`'s job (every lane stubbed), not this one's.

So a workflow_run-only lane refuses outright, naming the upstream workflow and, where a caller stub
here carries that name, the `--lane` to prove instead. Reaching Review or Bypass counter means
`bin/canary-graph`, or proving Verify and reading its downstream trigger by hand.
