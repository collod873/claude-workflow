# Decision records

An ADR records a **constraint**: something later work is bound by. The corpus is read far more
often than it is written, and every entry that is not a constraint is a future reader's attention
spent on history they cannot act on.

**[`INDEX.md`](INDEX.md) is the corpus**: every ruling as one line, newest last. The title is the
ruling, so the index answers *what was decided* on its own. Open a body only for *why*. It is
maintained by hand: a new entry adds its own line, and nothing regenerates it.

## Writing one

Write `NNNN-<slug>.md`, where `NNNN` is one past the highest number in the corpus and the slug is
the title lowercased and hyphenated, in [the shape below](#the-shape). Add its line to `INDEX.md`
in the same commit. Take the number from a freshly fetched `origin/main`, not from your tree alone.

## The bar

**Write `reversal:` first.** It says, in a sentence, what undoing this would cost. That sentence is
the admission test: if the answer is one edit, this is an implementation note; it belongs in the
code that does it, or in `docs/research/` if it carries evidence.

A constraint also earns its place by being **surprising** (a future reader would otherwise
re-decide it) and by having had a **real alternative** that was weighed and rejected.

## The shape

```yaml
---
status: constraint          # or `note`, or `superseded`
date: 2026-08-31
supersedes: ADR-0056        # optional; only when this ruling reverses that one whole
superseded_by: ADR-0087     # set on the predecessor when a successor supersedes it
reversal: what undoing this would cost, in a sentence
---
```

The **title is the ruling**, as a sentence: *"Event-driven triggers only, never a clock"*, never
*"Trigger strategy"*. The **body is why it binds**, in 150 words or fewer. Evidence, measurement
tables and worked examples live in `docs/research/`, and the ADR links them.

An ADR stands alone: a reader who cannot reach the linked issue still understands the constraint.
The issue is provenance, never content.

## Living with them

**Correct a landed ADR in place.** A change to part of a ruling is an edit to that ADR. File a new
one only when the ruling reverses whole, and set `supersedes:` on the successor and
`superseded_by:` on the predecessor. There is no `amends:`: an edge that meant "changes part of"
retired whole rulings, because the only thing that reads an edge retires.

**A retirement lands with its citers.** Find them with `grep -rn ADR-NNNN` and rewrite or delete
each sentence; a restated rule repointed to the new number is still the old rule.

**Never rename or delete one.** Numbers and filenames are quoted in issue bodies and permalinks
that cannot be edited from here. Retire an entry by setting `status: note`, which keeps its
citations resolving and tells a reader not to propagate it.

Cite another repo's record as `<repo>/ADR-NNNN`, so it never resolves against this corpus.
