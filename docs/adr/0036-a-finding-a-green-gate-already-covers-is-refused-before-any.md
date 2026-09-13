---
status: note
date: 2026-08-26
reversal: Re-wiring greenGateChecks would restore the same dead path this note now records as deleted; wire it only alongside something in the tree that actually produces check names.
---

# A finding a green gate already covers is refused before any refuter reads it

The half described here as the green-gate refusal was never wired: `review.ts` read the check
names from `process.argv.slice(4)`, and `.github/workflows/review.yml` has only ever passed the
two arguments before it, so the value was always `[]` in production. Deleted 2026-09-13, once
that was re-verified across three separate edits to `review.ts` that all left it `[]` regardless.

What remains, and what this note now describes, is the diff-citation filter: a finding is refused
before the refuter reads it when it names no `path:line` that the diff actually touches. That
filter is `citesLocationInDiff` in `structural-refusal.ts`, and it is the whole of
`isStructurallyRefused` now that the green-gate half is gone.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
