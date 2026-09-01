---
status: note
date: 2026-08-29
amends: ADR-0096
reversal: The refusal list already lives in `validateCriteriaShape`; permitting or re-refusing `gh`/`curl` inside a spec's closing check is an edit to that checker and the spec-check tests, and ADR-0096 still carries the ticket-side rule this only names the other half of.
---

# A ticket's check reads the tree while a spec's check reads the world

Re-admitted 2026-08-31 as a **note**: this records an amendment that should have been an edit to the ADR it changes, not a constraint
that binds later work.

It changes ADR-0096, which is where the change belonged.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
