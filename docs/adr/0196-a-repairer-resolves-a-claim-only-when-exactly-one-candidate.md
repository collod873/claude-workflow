---
status: constraint
date: 2026-09-16
reversal: Dropping this lets a repairer fix silently, with no line at the venue that would have refused, or repair text an author signed - `whatToBuild`, an ADR body - the same way it repairs a machine-generated token, so a wrong fix leaves no thread to pull and an edited sentence stops meaning what its author wrote.
---

# A machine repairs a violation only where the fix is uniquely determined, reports it, and never touches prose a human signed

The test is cardinality, not capability. `repairUnrootedClaims` (`render-body.ts:180`) roots a `filesClaimed` entry only where exactly one top-level directory resolves it; zero or several candidates refuse instead, naming every one found. `bin/ticket_shape.py:436`'s `_similar_existing_path` computes the same singleton-or-nothing set for `whatToBuild` and only ever suggests there - it does not rewrite text a human is on record as having written. `sliceAndPublish` prints one line per repair, the path as written and as rooted, before any issue exists, so a wrong repair still leaves a line to find it from.

A candidate set of size one is arithmetic, not authorship. Zero or many is a decision only the claim's author can make, so it refuses rather than guessing.

**Rejected: repair `whatToBuild` or an ADR body the same way.** Silently edits words a person signed; a wrong repair would surface as someone else's sentence in their name, with no line reporting it happened.
