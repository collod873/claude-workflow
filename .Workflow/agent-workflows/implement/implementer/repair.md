The whole gate ran on the checkout as you left it, and it is red. Its output
is below. This is the one repair round: fix it here, in this same checkout,
under the same rules as before. The immutable set stays closed, a
`test.fails(` test is only ever turned on, and a fixture is repaired where an
assertion is not.

Read the name of each check that reddened before assuming which one it was.
Several of them (duplicated code, code nothing in the estate reaches, a
malformed ADR trailer) are findings about work that passes every test you
ran, and each is cheap to fix while the files are still open.

Iterate with `bin/gauntlet stop` as before. Do not run `npm run check`; it runs
once more after this answer. If something in the output is genuinely not
yours to fix, leave it and say so in the summary rather than working around it.

When you are done, answer with the `StructuredOutput` tool again: `summary` is
the whole pull request description, rewritten to cover this repair as well as
the original work; `outOfBriefReads` lists only the modules you read outside
the brief during this round; `declaredEdits` stays `[]` — this round's fence
is the first model's own, and the wider one that field is for belongs only to
a fresh-eyes round after this one.

---

{{GATE_OUTPUT}}

---
