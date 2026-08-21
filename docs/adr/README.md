# Decision records

Every architectural decision this repo makes, one file each, oldest first. A reader who wants to
know *why* something is the way it is should find the answer here without asking anyone.

## Writing one

```
bin/new-adr "the ruling as a sentence"
```

That picks the next number, slugifies the title, stamps the date and opens the file. Or write it
by hand — `NNNN-slug.md`, four digits, next in sequence.

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
*"Amends [ADR-0004](0004-slug.md)."* Add a `superseded by ADR-NNNN` status line to the old one.
The point of the record is that you can see the mind change.

## When something deserves an ADR

All three, or skip it:

1. **Hard to reverse** — changing your mind later costs something real
2. **Surprising without context** — a future reader will wonder why on earth it was done this way
3. **A genuine trade-off** — there were real alternatives and one got picked for stated reasons

If it's easy to reverse, you'll just reverse it. If it's not surprising, nobody will wonder. If
there was no alternative, there's nothing to record beyond "we did the obvious thing."
