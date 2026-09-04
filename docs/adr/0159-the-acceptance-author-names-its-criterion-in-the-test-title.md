---
status: constraint
date: 2026-09-04
reversal: Reversing means putting the criterion back in a comment and teaching `shared/affected-tests.ts` to grep test source again, which restores the drift the prose gate exists to refuse — a comment quoting a criterion verbatim is exactly what `prose-gate.test.ts` holds at zero.
amends: ADR-0128
---

# The acceptance author names its criterion in the test title, not a comment above it

Lane 04's author now writes `test.fails("#<issue>.<index>: <what the criterion claims>", …)`,
where `<index>` is the criterion's 1-based position in `extractCriteria`'s list. `shared/affected-tests.ts`
matches that title by regex — `testsForTicket` for any criterion of a ticket, `testsForCriterion`
for one by index — and no comment above the test carries the criterion at all.

ADR-0128's reason was `verify.yml` selecting tests by `String.includes` over test source, but
`verify.yml` runs the whole gauntlet and has never grepped by criterion; that reason was stale
before this ruling. What is real: the prose gate (ADR-0151) refuses a comment quoting a criterion
verbatim as prose with no machine reader, and `bin/close-ticket`'s `surviving_fails_lines` already
matches `#<issue>\b`, accepting `#N.i` unchanged.

**Rejected:** keeping the comment alongside the title, which gives the criterion two homes that
can drift from each other and from the ticket.
