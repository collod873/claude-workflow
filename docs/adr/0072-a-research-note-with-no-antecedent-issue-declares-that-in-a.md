# A research note with no antecedent issue declares that in a field, because a counter cannot tell silence from an answer

Recorded 2026-08-27.

Amends: [ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md), which ruled
that every research note carries *"a real `Resolves:` field"* and left no spelling for a note that
answers no issue.

A note written without an issue behind it carries **`Unprompted:`** and says what it was written
against. `bin/new-research none "<title>"` writes it, and the missing-trailer counter reads it as an
answered question rather than an absent one. A note that says nothing is still a finding.

## The two notes that forced it

[#132](https://github.com/collod873/claude-workflow/issues/132)'s backfill cleared 31 of its 33
lines and could not clear these:

- `session-prompts-2026-08.md` (`8a97b4b`) recovered four days of prompts because
  `cleanupPeriodDays: 30` was about to delete the transcripts. Nobody asked for it.
- `verification-boundaries-2026-08.md` (`24cb5cc`) recorded that nothing in the pipeline gates code
  on tests, and says outright *"the four decisions it sets up are still open."* It is cited by
  [ADR-0010](0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md) as evidence — the
  reverse direction from the one a `Resolves:` field points.

Both are the shape the record is supposed to want: a document written because someone noticed
something, ahead of anyone filing a ticket about it. ADR-0045's field has no way to say so, so the
counter names both of them on every run, forever.

## Considered options

- **File an issue for each after the fact and point at it.** Rejected. The issue would exist only to
  give the note a pointer, which is the ceremony `docs/adr/README.md`'s back-stamp convention died
  of and the reason ADR-0045 made supersession *declared* rather than remembered. It also makes the
  tracker lie about what was asked for.
- **Leave both as standing false positives.** Rejected. ADR-0045 accepts a false positive as *"an
  expected outcome, not a bug"* — for a **heuristic over prose**, where the reader's judgement is
  the point. This is not that: the counter is asking a question the note is allowed to answer, and a
  permanent unanswerable line trains the reader to skip the list, which is exactly what
  [ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md) calls a counter
  spending the owner's attention for nothing.
- **Write `Resolves: none`.** Rejected, and it is the one that already works: the counter's
  `RESEARCH_POINTER_RE` tests for the *field*, not for what it resolves to, so `Resolves: none`
  passes today with no code change. That is the trapdoor — it makes a declared absence
  indistinguishable from a real pointer to anything reading the corpus, including the next person
  who greps it. A separate field name keeps the two states separable.
- **`Unprompted:`, read by the counter.** Chosen.

## Consequences

**The counter's question changes from "does it name an issue" to "has it said which it is".** That
is a weaker check and it is the honest one: the strong version was never enforceable, since nothing
verifies that a cited issue is the right issue either.

**The tool writes it, so nobody has to remember.** `bin/new-research none "<title>"` is the whole
compliance path, the same way `bin/new-adr --amends` is for the trailer — ADR-0045's own diagnosis
of why the flag mattered (*"the tool that was supposed to make the trailer free was never built"*,
[ADR-0067](0067-the-missing-trailer-check-is-a-counter-because-it-files-wher.md)).

**A note can still lie about itself**, by declaring `Unprompted:` where an issue exists. Nothing
catches that and nothing was going to: the same hole ADR-0045 accepts for a trailer that names the
wrong predecessor.
