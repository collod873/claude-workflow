---
status: constraint
date: 2026-09-11
reversal: Reversing it means re-authoring from the body alone again, which cannot tell a criterion the owner just deleted from one the spec never carried, so every edit pays a model call per slice; the edit-aware comparison also has to be unwired from `acceptance.yml`'s `PRD_BODY_BEFORE` and `affected-tests.ts`.
amends: ADR-0079
---

# A spec edit re-fires acceptance only for what the edit removed, never for every slice

ADR-0033's grep asked whether the spec still carries a slice's criterion verbatim. That
assumed the slicer copies the spec's wording; it writes its own, so the answer was no for
every slice carrying a test, whatever changed. One owner edit to PRD #491 — a
one-character fix to a check command — would have re-authored ten slices' tests, nine of
them already merged (#518). The comparison is now between the body before the edit and the
body after, both of which GitHub sends on `issues: edited`: a criterion the edit itself took
out re-fires its slice, and nothing else does. Closed slices are never re-authored; their
work is on main. No earlier body re-authors nothing rather than
everything: the failure spends nothing.

**Rejected:** storing each slice's authored-from spec text as provenance. It buys the same
answer and adds state to keep true across re-slices.
