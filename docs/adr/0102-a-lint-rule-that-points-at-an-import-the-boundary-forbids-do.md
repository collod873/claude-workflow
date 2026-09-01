---
status: constraint
date: 2026-08-29
amends: ADR-0032
reversal: Reversing means restoring the unsatisfiable eslint pair over `tests/acceptance/**`, so any acceptance test that catches an unknown error must violate one rule or the other; and withdrawing the immutability clause leaves no sanctioned way to remove a batch the landing gate should have refused, which is what left `eslint .` red repository-wide for a ticket nobody had started.
---

# A lint rule that points at an import the boundary forbids does not apply inside that boundary

Three rulings from one batch of acceptance tests no venue could accept:

1. `no-restricted-syntax`'s inline-`reason` selector is off inside `tests/acceptance/**`, the rule re-declared there carrying every other selector: a rule whose remedy is "import this helper" cannot bind a directory ADR-0032 forbids from importing it. The pair was unsatisfiable for any test that catches an error.
2. `acceptance/push-gate.ts` lints the batch it is about to land, before any git call. A red test is a statement about the ticket; a lint error is a statement about the file, and a file this repo refuses is not landable in any state.
3. Immutability attaches at a valid land, not at a `git push`: a batch the landing gate would refuse today may be removed and re-authored, since the criteria are unchanged.

`acceptance/author/prompt.md` no longer points the author across the boundary.
