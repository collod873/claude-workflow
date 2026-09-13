---
status: constraint
date: 2026-09-13
reversal: Restoring a TypeScript warnings half means re-implementing branches the Python already decides and re-hiring the example-based guards that missed 16dbf0e; inlining the rules source returns the ceiling and four refusal strings to two copies a reviewer must diff by eye.
---

# One rules source spells the ticket shape both validators enforce, and the TypeScript warnings half is gone

`validateTicket` had no production caller — every door reads `assertTicketShape` or
`overWideClaim` — and its branches were a drifted subset of the Python's. It is deleted:
`bin/ticket_shape.py` alone renders a ticket warning. Both runtimes stay; only one holds an opinion.

The shape rules have callers on both sides, so they tabulate into
`shared/ticket-shape.rules.json`, as `immutable-set.json` already did: the ceiling, the four
refusal strings, and the regex sources whose classes are ASCII-explicit and so mean one thing to
both engines.

What stays in two copies: the evidence grammar (`PATH_LINE_RE`, `BACKTICK_RE`, `FILE_PATH_RE`,
`BASENAME_RE`), since `\w` and `\d` are Unicode-wide in Python and ASCII in JavaScript and its
copies now answer different questions; compile flags, which are not rules; and every branch the
Python decides alone.

**Rejected: a rules source alone, keeping `validateTicket`.** Warnings are control flow, not
constants: a table collapses the cheap half and leaves what drifted in two languages.
