---
status: constraint
date: 2026-09-01
amends: ADR-0120
reversal: Reversing re-admits the collision this removed — lane 04's author is required to quote its criterion verbatim and forbidden to name an immovable path, so a criterion whose own check marker names a workflow file makes both rules unsatisfiable at once, the batch is refused, the run dies, and no wording of the prompt can rescue it.
---

# The immutable-set refusal reads an acceptance test's code, not its comments

ADR-0120's refusal matched the whole source text of a freshly authored acceptance test, reasoning
that a path such a test does not read has no business being written in it. A criterion is the
counter-example, and not a rare one: an acceptance test names the criterion it proves verbatim —
that string is what `shared/affected-tests.ts` greps for — and a criterion's trailing `check:`
marker routinely names a workflow file. Thirteen of the seventy-four files already under
`tests/acceptance/` carry `.github/` or `vitest.config.ts` for exactly that reason, and every one
would have been refused. That is ADR-0102's corner one level along: two rules the author cannot
obey at once.

Comments cannot open a file, so whole-line comments are cut before the match. What an assertion may
turn on is unchanged.

**Rejected:** a TypeScript-aware reader, which must be right about every route a path takes to
`readFileSync`.
