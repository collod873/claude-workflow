# Decision records

Every architectural decision this repo makes, one file each, oldest first. A reader who wants to
know *why* something is the way it is should find the answer here without asking anyone.

## Writing one

```
bin/new-adr "the ruling as a sentence"          # → docs/adr/draft-<slug>.md
bin/new-adr --land docs/adr/draft-<slug>.md     # → docs/adr/NNNN-<slug>.md
```

Drafting slugifies the title, stamps the date and opens the file. It claims **no number** — a draft
is not yet part of the record, so it sits in your working tree without staling the corpus fixture or
tripping the gauntlet.

Landing is what claims the number, against a freshly fetched `origin/main`, and regenerates the
corpus fixture in the same breath. Both halves matter: `docs/adr/` has two authors now — you and the
accept lane on a runner — and neither can see the other's uncommitted work, so a number taken when
the file is *created* is taken against a corpus the other author may already be past. See
[ADR-0080](0080-an-adr-number-is-claimed-when-the-adr-lands-not-when-it-is-d.md).

Writing one by hand still works — `NNNN-slug.md`, four digits, next in sequence — but you then owe
the fixture yourself: `node .Workflow/agent-workflows/shared/generate-corpus-fixture.ts .`

## Format

A title and one to three sentences. That's the whole requirement.

```md
# Event-driven triggers only, never a clock

Recorded 2026-08-21.

A periodic cadence is still work nobody asked for, only less often. Anything that fires must name
a real event, and must be silent when there is nothing to say.
```

The title is the **ruling stated as a sentence**, not a topic. "Event-driven triggers only" — not
"Trigger strategy". A reader scanning the directory should be able to read the decisions off the
filenames.

### Optional sections

Only when they earn their place. Most ADRs won't need any of them.

- **Status** (`proposed` / `accepted` / `deprecated` / `superseded by ADR-NNNN`) — when a decision
  gets revisited
- **Considered options** — when the rejected alternatives are worth remembering, because otherwise
  someone proposes them again in six months
- **Consequences** — when a downstream effect is non-obvious

### Amending

Don't edit an old ADR to reflect a new decision. Write a new one and have it say what it amends:
*"Amends [ADR-0004](0004-slug.md)."* The point of the record is that you can see the mind change.

The back-pointer on the *old* one is a **back-stamp**, and it is not written by hand. This section
used to say "add a `superseded by ADR-NNNN` status line to the old one" and **zero of 43 ADRs ever
carried one** — `GOAL.md` C4's adoption law demonstrated in this repo's own record. So supersession
is declared in a machine-readable `Amends:` trailer that `bin/new-adr --amends NNNN` writes, and the
stamp is derived from it. See
[ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md); the trailer and the
derivation are unbuilt until their move lands.

## When something deserves an ADR

All three, or skip it:

1. **Hard to reverse** — changing your mind later costs something real
2. **Surprising without context** — a future reader will wonder why on earth it was done this way
3. **A genuine trade-off** — there were real alternatives and one got picked for stated reasons

If it's easy to reverse, you'll just reverse it. If it's not surprising, nobody will wonder. If
there was no alternative, there's nothing to record beyond "we did the obvious thing."
