# Decision records

An ADR records a **constraint**: something later work is bound by. The corpus is read far more
often than it is written, and every entry that is not a constraint is a future reader's attention
spent on history they cannot act on.

**[`INDEX.md`](INDEX.md) is the corpus** — every ruling as one line, newest last. The title is the
ruling, so the index answers *what was decided* on its own. Open a body only for *why*.

## Writing one

```
bin/new-adr "the ruling as a sentence"          # → docs/adr/draft-<slug>.md
bin/new-adr --land docs/adr/draft-<slug>.md     # → docs/adr/NNNN-<slug>.md
```

A draft claims **no number**, so it is invisible to everything that reads the corpus by filename
shape — it sits in a working tree without staling the fixture or tripping the gauntlet. Landing
claims the number, against a freshly fetched `origin/main`, and regenerates the corpus fixture in
the same breath. Both halves matter: `docs/adr/` has two authors, you and the accept lane on a
runner, and neither sees the other's uncommitted work
([ADR-0080](0080-an-adr-number-is-claimed-when-the-adr-lands-not-when-it-is-d.md)).

## The bar

**Write `reversal:` first.** It says, in a sentence, what undoing this would cost. That sentence is
the admission test: if the answer is one edit, this is an implementation note — it belongs in the
code that does it, or in `docs/research/` if it carries evidence. Landing refuses an empty one.

A constraint also earns its place by being **surprising** — a future reader would otherwise
re-decide it — and by having had a **real alternative** that was weighed and rejected.

## The shape

```yaml
---
status: constraint          # or `note`, or `superseded`
date: 2026-08-31
amends: ADR-0056            # optional; the successor declares the edge
superseded_by: ADR-0087     # derived by the back-stamp, never hand-written
reversal: what undoing this would cost, in a sentence
---
```

The **title is the ruling**, as a sentence — *"Event-driven triggers only, never a clock"*, never
*"Trigger strategy"*. The **body is why it binds**, in 150 words; landing refuses more. Evidence,
measurement tables and worked examples live in `docs/research/`, and the ADR links them.

An ADR stands alone: a reader who cannot reach the linked issue still understands the constraint.
The issue is provenance, never content.

## Living with them

**Correct a landed ADR in place.** File a new one only when the constraint itself reverses, and set
`amends:` on the successor when it does — `missing-trailer.ts` reads that key, and `back-stamp.ts`
derives the predecessor's `superseded_by:` from it. Neither is hand-written, because three
hand-written trailers once shipped without their colon and left three predecessors unstamped for
months.

**Never rename or delete one.** Numbers and filenames are quoted in issue bodies and permalinks
that cannot be edited from here. Retire an entry by setting `status: note`, which keeps its
citations resolving and tells a reader not to propagate it.

`~/bin/adr-check` validates the corpus, regenerates `INDEX.md`, and reports dead citations; the
push venue runs it, along with a guard that refuses the retired prose grammar.
