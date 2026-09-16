---
status: constraint
date: 2026-08-26
reversal: Inferring supersession from prose means removing `bin/new-adr --supersedes`, rebuilding `back-stamp.ts` on a verb heuristic with a known false positive, and losing the missing-trailer counter that makes a forgotten declaration the thing that gets detected.
---

# A superseded ADR is named by a trailer its successor writes, and the first thing the counter catches is a missing trailer

Supersession is declared, not inferred. A successor that reverses a ruling whole carries
`supersedes: ADR-NNNN` in its frontmatter, `bin/new-adr --supersedes` writes it, and `back-stamp.ts`
derives the predecessor's `superseded_by:` from those edges. A change to part of a ruling is an edit
to that ADR, never a successor.

Prose cannot carry the edge: the corpus spelled supersession five ways, and "extends" looked like
one and was not. A hand-written line survives here because the counter catches its absence:
`missing-trailer.ts` files any ADR carrying a supersession verb and a lower-numbered ADR link but no
`supersedes:` line.

A research note carries `Resolves: #N`, or `Unprompted:` when no issue preceded it, both written by
`bin/new-research`, so the counter can tell a declared absence from silence.

**Rejected: inferring edges from supersession verbs.** A heuristic with a known false positive on
the day it ships.
