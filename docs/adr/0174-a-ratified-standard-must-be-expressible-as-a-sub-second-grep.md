---
status: constraint
date: 2026-09-09
reversal: `CODING_STANDARDS.md`'s preamble and `bin/lint`'s own rule comments both assert this test; loosening it reopens the file to entries a lint rule could have caught instead.
---

# A ratified standard must be expressible as a sub-second grep

`bin/lint` holds every standard this repo ratified as a lint rule rather than a
`CODING_STANDARDS.md` entry, one grep-based check per ratified finding. `CODING_STANDARDS.md`'s
own preamble asks, before ratifying: can a lint rule enforce this? If yes, the rule replaces the
entry, never both. That question is answerable only when the standard reduces to something a
grep decides in milliseconds.

The consequence is a real cost, already paid: a candidate has been declined as a
`CODING_STANDARDS.md` entry precisely because it *was* grep-expressible, which the preamble says
makes it a rule instead. Standards that need judgement stay unenforced prose, on purpose.

**Rejected: a second, slower linter behind the fast one.** Two linters is two vocabularies, and
the slow one goes unread.

Imported from collod873/agent-skills ADR-0041 on 2026-09-09; that repo no longer carries the
ruling.
