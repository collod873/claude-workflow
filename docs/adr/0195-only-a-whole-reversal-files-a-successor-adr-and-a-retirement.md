---
status: constraint
date: 2026-09-16
reversal: Reverting brings back an `amends:` edge that the back-stamp reads as retirement, removes the `drift` slot from the push venue, and leaves every retired ruling and deleted file free to go on being taught by the documents that named it.
---

# Only a whole reversal files a successor ADR, and a retirement or a deletion lands with every live line that names it

A change to part of a ruling is an edit to that ADR. A successor declares `supersedes:` only when the ruling reverses whole ([ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md)), because the one machine that reads the edge retires what it names: the #571 audit found eleven live rulings retired by notes that only amended them.

A retirement is not finished at the stamp. `npm run drift` refuses the push while a live document cites a retired ADR, or names a file the change deleted. A document that restates a rule outlives the rule; one that must be rewritten when the rule goes cannot.

**Rejected: a periodic audit of citers.** It is a ritual, and C4 says rituals die; this one found seventeen stale restatements only because someone asked.

**Rejected: checking every path any document names.** Measured at 59 hits, nearly all example paths and other repos.
