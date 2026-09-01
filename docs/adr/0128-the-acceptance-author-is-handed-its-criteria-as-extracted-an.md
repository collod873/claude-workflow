---
status: constraint
date: 2026-09-01
amends: ADR-0098
reversal: Reversing means dropping the rendered criteria from lane 04's prompt assembly and letting the model re-derive each string from the ticket body by eye; a copy differing by one character selects no test in verify.yml's testsForCriteria grep, and the run then fails on the implementer's pull request rather than on the author that wrote the test.
---

# The acceptance author is handed its criteria as extracted, and quotes each into a comment

Lane 04's author is given its ticket's criteria as `extractCriteria` returns them — numbered,
fenced, one block each — and must copy each verbatim into a comment above the test that proves it.

A criterion string is an identifier, not prose. `implement.ts` sends the same `extractCriteria`
output on the verify dispatch, and `verify.yml` selects the slice's tests by `String.includes` over
test source. A copy differing by one character selects nothing, and the run fails on the
implementer's pull request — a defect in the test, charged to somebody who did not write it
(ADR-0034). Re-deriving that string by eye was reimplementing `extractCriteria`, down to the
trailing `check:` marker staying in it.

A comment, not the test's name: a name shortens to read well, and a marker's command often names
paths.

**Rejected:** matching criteria fuzzily downstream, which makes one grep's answer a judgement call
in three places.
