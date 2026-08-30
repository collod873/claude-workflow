# Everything lane 02 cannot settle becomes a numbered open question

Recorded 2026-08-26.

Status: superseded by ADR-0112

The numbered open question is lane 02's **only** output for anything it cannot settle. §02 already
made one thing take that form — *every place it had to invent intent becomes a numbered open question
rather than a silent assumption* — and two more join it rather than getting mechanisms of their own:

| What the author hit | Becomes |
|---|---|
| It had to invent intent | A numbered open question. §02, unchanged |
| A ruling it was handed is wrong, or two conflict | A numbered open question **naming the ADRs**. Answering it is what files the amendment |
| The sheet marked a decision and the accept filed no ADR for it | A numbered open question **carrying the mark's target verbatim** |

Extends [ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md) and
[ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md). Both stand.

## A disputed ruling had no path that fired before work-merge

ADR-0005 handles a ruling reality contradicts: *at work-merge the implementer is asked whether
anything it hit contradicted the ruling it was given, and **only a yes drafts an amendment.*** That is
lanes 05 and 08 — three lanes after the spec cites the ruling, and after acceptance tests have been
written from it.

The author is the first reader that holds the rulings and the work together, so it is the first place
a contradiction is visible. It gets no new label and no new venue: **it is a question, because it is
precisely a place the author cannot invent intent.** And the extension ADR-0005 needs is one
sentence: *accepting a shaped idea files its ADRs*, and **answering a spec's ADR-conflict question
files the amending one** — the same act, one lane later, by the same owner signature ADR-0006 rules
is what a ruling takes.

ADR-0005's amendment path at work-merge is untouched. It answers a different question — *did reality
push back* — and it stays the only thing that can.

## A mark that got no ADR had nowhere to go at all

The sheet's schema makes this exactly three cases, with no judgement anywhere in it. `accept.ts`
files an ADR only for a decision carrying **both** a `mark` and an `adrTitle`:

- **mark + title** → an ADR exists, and the spec cites it. Already ADR-0005's whole point.
- **no mark** → an ordinary recommendation the owner could override in place. Nothing owed.
- **mark, no title** → the shaper said *I guessed at something load-bearing* and named what moves,
  and then nothing wrote it down anywhere. **That is the gap**, and it is the one case where the
  sheet knew more than any downstream artifact.

So the mark's target rides into the spec verbatim. ADR-0028 widened a mark to point at an ADR, a
lane's contract or a file precisely so *the lone irreversible decision is caught* — this is that
pointer surviving one lane further, to the place the work is actually described.

## It makes "zero open questions is suspect" arithmetic

§02 says *a spec that ships with zero open questions is treated as suspect — it guessed silently*,
and nothing could act on that. For the sheet trigger it is now a count the critic checks with no
judgement:

> the sheet's decisions carrying a mark and no `adrTitle`, minus the open questions naming a mark,
> is zero.

The map and in-session triggers carry no marks, so suspicion stays a heuristic there — and it stays
the critic's job, which is what
[ADR-0062](0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md) arms it for.

## Considered options

- **A `ruling/conflict` label routed somewhere.** Rejected. ADR-0034 already ruled what a label with
  no reader is: *a label with no event behind it is a note.* The reader here would be the owner, and
  he is already reading the open questions.
- **The author drafts the amending ADR itself.** Rejected against ADR-0005 and ADR-0006: an amendment
  means reality pushed back, and an author that has built nothing has not met reality. It also puts a
  ruling on `main` that nobody signed.
- **Marks die at accept.** Rejected — it is the status quo, and it throws away the only record that a
  decision was a guess at exactly the moment something is written that depends on it.
- **Every marked decision becomes a question, filed or not.** Rejected as a nag. Where an ADR was
  filed the ruling *is* the record, and re-asking the owner about a decision he accepted two lanes ago
  is C4's shape.

## Consequences

**This depends on a flag that does not exist yet.**
[ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md) ruled that
supersession is declared by an `Amends:` trailer written by `bin/new-adr --amends NNNN`, and that is
unbuilt until [move 8c](https://github.com/collod873/claude-workflow/issues/104) lands. An amendment
filed before then carries the prose and not the trailer, which the back-stamp counter is designed to
catch as its first finding.

**The open-question count is now load-bearing twice** — it is what the owner answers, and it is what
dispatches the slicer (ADR-0062). A feeder added later adds work to the gate as well as to him, which
is the right pressure: a fourth kind of question has to earn both.
