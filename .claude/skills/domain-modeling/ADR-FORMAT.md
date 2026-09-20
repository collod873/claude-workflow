# ADRs

An ADR records a **constraint**: something later work is bound by. The corpus is read
far more often than it is written, and every entry that is not a constraint is a
future agent's context spent on history it cannot act on.

## Filing one

Write `docs/adr/NNNN-<slug>.md` in the shape below, where `NNNN` is one past the
highest number already in the corpus and the slug is the title lowercased and
hyphenated. Add its line to `docs/adr/INDEX.md` in the same commit.

Take the number from a freshly fetched `origin/main`, not from your tree alone: two
authors write `docs/adr/` from separate trees and neither sees the other's
uncommitted files.

## The bar

**Would reading the code answer this?** If it would, the implementation already
carries the answer and the entry restates it. What earns a place is what *deciding*
produced and the code cannot show: the alternative that was weighed and rejected,
the boundary two contexts sit either side of, the lock-in a technology choice
bought, the deliberate deviation from the obvious path. Code records which way it
went, never what else was on the table. Someone who opens it sees what was built;
they open `docs/adr/` to learn what binds what they build next.

A reader applies that test by looking, so apply it before filing: name the next
piece of work the ruling binds. An entry with no answer to that is narrating the
change you just made, which is what `git log` already holds.

One part of that test is structural: the body carries a
`**Rejected: <the alternative>.** <what it would have cost.>` line naming the other
thing you could have built. The rest of the bar is judgement, and nothing enforces
any of it, so the author holds the line.

Rationale about how the code works goes in the commit message, where `git log` and
`git blame` keep it reachable and no later agent pays to read it. `CONTEXT.md` takes
it only where the thing to settle is a word. Evidence (measurements, worked
examples, the corpus you read) goes in `docs/research/`, which the ADR links.
`docs/adr/` carries the ruling alone.

`reversal:` is a required frontmatter field: one sentence on what undoing this
would cost, which tells a later reader what they would be dismantling. Admission is
the test above; an author grading their own reversal cost passes every time.

## The shape

The **title is the ruling**, as a sentence: *"Triage labels are positions, not
verdicts."* `docs/adr/INDEX.md` publishes titles, and that index is what most
readers ever see, so the title carries the decision on its own.

The **body is why it binds**, in 150 words or fewer. Evidence, measurements and
worked examples live in `docs/research/`, and the ADR links them.

An ADR stands alone: a reader who cannot reach the linked issue still understands
the constraint. The issue is provenance, never content.

## Living with them

**Correct a landed ADR in place.** A change to part of a ruling is an edit to that ADR.
File a new one only when the ruling reverses whole; set `supersedes:` on the successor,
then rewrite or delete every live line that cited the old one.

**Never rename or delete one.** Numbers and filenames are quoted in issue bodies and
permalinks that cannot be edited from here. Retire an entry by setting `status:
note`, which keeps its citations resolving and tells a reader not to propagate it.

Cite another repo's ADR as `<repo>/ADR-NNNN`, so it never resolves against this one.

Nothing validates the corpus. Before retiring a ruling, `grep -rn ADR-NNNN` for its
citers: how widely it spread is the honest reading of how hard it now is to reverse.
