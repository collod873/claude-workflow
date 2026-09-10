---
status: constraint
date: 2026-09-09
reversal: The `stop` slot is hardcoded so no later contract edit can re-impose the test tax on every turn-end; reversing it means teaching `bin/gauntlet` to read a general-purpose slot for `stop` again.
---

# Turn-end gates run fast checks only; CI owns the project suite

A turn-end gate exists to stop the conversation claiming done on a file it broke. It is not a
second CI, so any check taking more than a few seconds is disqualified by definition: it is paid
at every stop, including the runs that changed nothing.

The check contract carries a `stop` slot, hardcoded rather than assembled from the others, with
`{"cmd": null, "why": "..."}` as the sanctioned opt-out.

**Rejected: borrowing the `lint` slot.** Other callers read it too, so a project quieting the
turn-end gate would have had to lose its linter everywhere `lint` is read.

Imported from collod873/agent-skills ADR-0022 on 2026-09-09; that repo no longer carries the
ruling.
