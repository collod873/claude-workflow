---
status: note
date: 2026-08-26
reversal: The sweep's trigger is the `on:` block of a single workflow, and the durable content — that `workflow_run`'s filter matches a `name:` a broken file does not have, and that actionlint refuses the unfiltered form — is a fact about GitHub that survives whatever this repo does with it.
---

# The run watchdog sweeps on session end, because workflow_run is keyed on a name the failure erases

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
