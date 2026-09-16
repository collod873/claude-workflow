---
status: constraint
date: 2026-09-09
reversal: `CODING_STANDARDS.md`'s preamble and the `rules` slot that runs `bin/lint` both assert this test; loosening it reopens the file to entries a lint rule could have caught instead.
---

# A ratified standard must be expressible as a sub-second grep

A ratified standard lands as a grep rule in `bin/lint`, run by the `rules` slot of
`.claude/contract.json` at the push venue, rather than as a `CODING_STANDARDS.md` entry.
`CODING_STANDARDS.md`'s own preamble asks, before ratifying: can a lint rule enforce this? If yes,
the rule replaces the entry, never both. That question is answerable only when the standard reduces
to something a grep decides in milliseconds.

A standard that needs a parse, or the whole tree read at once, is not grep-shaped and lands in the
suite beside `prose-gate.test.ts` instead. The test here decides which of the two, and #587 is why
it has to: `bin/lint` was for a year a script no slot named.

**Rejected: a second, slower linter behind the fast one.** Two linters is two vocabularies, and
the slow one goes unread.

Imported from collod873/agent-skills ADR-0041 on 2026-09-09; that repo no longer carries the
ruling.
