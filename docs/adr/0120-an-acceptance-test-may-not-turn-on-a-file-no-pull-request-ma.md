# An acceptance test may not turn on a file no pull request may change

Recorded 2026-08-31.

`acceptance/push-gate.ts` refuses a freshly authored acceptance test whose source names a path in the
immutable set other than `tests/acceptance/` itself — `vitest.config.ts` or anything under
`.github/`. The Immutability job forbids every pull request from touching those, so an assertion
about their contents returns the same verdict before the ticket is built and after it merges.

## Why

Lane 04's output is the artifact everything downstream is judged by, and it had no gate on whether
that artifact is satisfiable. Lane 03 has four validations on what it publishes; lane 04 lands its
tests on `main` unreviewed and they become law (#278).

`push-gate.ts` classifies a failing test by error name: an `AssertionError` ran against the real
subject and found it wanting, which is what an acceptance test is *for*, and anything else — a
typo'd import, a missing module — proves nothing and is refused. #272's defect 2 is the case that
classifier cannot see. Its assertion sliced the text of `vitest.config.ts` with `indexOf`, landed on
the wrong array, and threw a clean `AssertionError` against every possible implementation including
a correct one. The gate as written would have pushed it, and it became the permanent contract for
that criterion.

## The decidable slice of an undecidable question

"Can any diff satisfy this test?" is undecidable, which is the honest reason lane 04 has had no
`validateCriteriaShape` of its own, and the reason not to reach for a model to guess at it.

One slice of it is decidable and needs no judgement at all: a test whose subject is a file **no
permitted diff may contain a change to** has its verdict fixed before the ticket starts. That is not
a heuristic about whether the assertion looks right — it is a statement about the set of diffs the
Immutability job allows, and it is exactly the slice #272 fell into.

The gate reads the same `IMMUTABLE_SET` that job reads, minus `tests/acceptance/`, which is dropped
because the test lives there and legitimately imports its own fixtures.

## Considered options

- **Have a model read each authored test against the ticket and judge satisfiability.** Rejected as
  the first move, not on cost — lane 04 already spends an Opus run, so ADR-0107's shape would put the
  check inside it for nothing — but because it answers an undecidable question with a guess, and a
  guess that refuses a good batch costs the whole run. The prompt now states the rule (both shapes of
  unsatisfiable test), which is the cheap half of that idea without the verdict.
- **Ban reading any file's text from an acceptance test.** Rejected. It is how a rule stated in a
  config, a prompt or an ADR gets tested at all, and the acceptance boundary already forbids
  importing the subject, so file-reading is often the only route to it.
- **Detect the specific `indexOf`-slicing shape #272 used.** Rejected — it fits one incident and
  nothing else, which is the reactive pattern #278 names.

## Consequences

**It only fires where lane 03 should already have refused.** `validateClaimsAreMutable` refuses a
ticket claiming an immutable file, so a well-formed ticket cannot ask for one of these tests. This
catches the case where lane 04 reaches for such a file on its own initiative, which is what #272 did
after being told to by a ticket that no longer publishes.

**The pipeline still cannot build tickets that edit its own workflows.** `.github/` being immutable
means work like #275 is landed by the owner by hand, and this gate does not change that — it makes
lane 04 stop authoring tests for the version of that work the pipeline cannot do.

**Matched against source text, not parsed.** A path an acceptance test does not read has no reason
to appear in it, so the false positives are a sentence to rewrite rather than a ticket to re-slice.
The alternative is a TypeScript-aware reader that has to be right about every way a path can reach
`readFileSync`, bought against one observation.
