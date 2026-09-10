---
status: constraint
date: 2026-09-04
reversal: Reversing means putting the criterion back in a comment and teaching `shared/affected-tests.ts` to grep test source again, which restores the drift the prose gate exists to refuse — a comment quoting a criterion verbatim is exactly what `prose-gate.test.ts` holds at zero.
amends: ADR-0128
---

# The acceptance author names its criterion in the test title, not a comment above it

Lane 04's author writes `test.fails("#<issue>.<index>: <what the criterion claims>", …)`,
`<index>` being the criterion's 1-based position in `extractCriteria`'s list. `shared/affected-tests.ts`
matches that title by regex, and no comment above the test carries the criterion at all.

ADR-0128's reason — `verify.yml` selecting tests by `String.includes` over test source — was
stale: it runs the whole gauntlet and never grepped by criterion. What is real: the prose gate
(ADR-0151) refuses a comment quoting a criterion as prose with no machine reader, and
`close-ticket` already matches `#<issue>\b`, accepting `#N.i` unchanged.

The index is positional: reordering or removing criteria after tests are authored re-keys them
silently. `file-issue ticketify --replace` and a hand edit are where titles get fixed; a title
written before the issue has a number carries `#?.<index>:` until rewritten.

**Rejected:** keeping the comment alongside the title, giving the criterion two homes that can
drift from each other and from the ticket.
