---
status: constraint
date: 2026-09-03
reversal: every file is free to grow paragraphs again, and the 18,000 lines cut to reach zero return as claims no check can keep true, in a corpus whose readers are agents paying for every one
---

# Code carries no prose; the why lives in docs/adr and CONTEXT.md

A comment is a claim about the code that nothing checks. It rots silently, it is read on
every pass an agent makes over the file, and the corpus already has two places whose job is
the why — the ADRs for a constraint, `CONTEXT.md` for the vocabulary. A third copy beside
the code is a second answer that will eventually disagree with the first.

The prose was also suppressing detection: with it gone, the clone gate immediately found
four real duplications the comments had been holding more than five lines apart.

`prose-gate.test.ts` holds the count at zero across every file `bin/gauntlet push` covers,
keeping only what a machine reads — knip's `@shell`/`@fixture` tags, capped at five lines so
an essay cannot hide behind one, `shellcheck` directives, eslint pragmas.

A percentage budget was the alternative, rejected because a budget is a negotiation every
future agent reopens and zero is not.
