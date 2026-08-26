# Lane 08 merges without a model, and the semantic-conflict class goes to the proposed lens

Recorded 2026-08-26.

Lane 08 spends no model. The merge warden becomes deterministic code — rebase, re-run the full
gauntlet against current trunk, merge, deploy preview — and never holds a merge for a semantic
conflict. The class it was built to catch is handed to the proposed lens's two-site gate, which
already detects it, is already measured, and is already being built.

## What this amends

`DESIGN.md` §08, which said the warden *"files a coherence issue instead of merging"* and assigned it
one Sonnet per merge. It files nothing and spends nothing. §11's unfiled question 7 — *what a
semantic-conflict finding looks like, and what the warden does instead of merging* — is retired
rather than answered: there is no such finding and no such warden.

## The argument

The warden's job was the conflict git cannot see: two pull requests that touch different files, both
green, that together give the product two ways to do one thing. `formatDate()` lands in one,
`dateToString()` in the other; neither reviewer catches it, because each saw one diff.

**The proposed lens already detects exactly that shape.** Its two-site gate
([ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)) records a finding
naming one site and releases it when a second appears — *the same thing at two places* is its whole
trigger. It is measured at 55% valuable across 27 graded findings, it costs nothing beyond the
transcript audit already running at session end, and it ships in move 8b.

So the warden's only unique contribution was **timing**: the proposed lens deliberately waits for the
second site, and therefore always fires once the duplicate is already in trunk, whereas a warden
could fire one moment earlier, while the second PR is still stoppable.

That leaves exactly two coherent designs, and the middle option is incoherent:

- **Hold and file** — genuinely earlier than the proposed lens, and worth a model per merge.
- **Merge and file** — fires at the identical moment the proposed lens does, produces the same
  finding, and adds a model call the lens does not need. Strictly dominated; there is no version of
  this worth shipping.

## Considered options

- **Hold and file** — rejected on
  [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md). Nothing clears a
  semantic-conflict finding except the owner, so a held merge is parked work, and parked work drains
  onto him. That is the outcome this design exists to prevent, and the ruling that deleted the
  governor was made on the same grounds the same day.
- **Merge and file** — rejected as dominated, above.
- **No warden model** — chosen, by the owner: *"I'd rather the items ship faster… then if it's
  actually worth doing the two lenses finds it anyway."* Work reaches trunk without waiting on a
  model, and the class is caught one merge later by a mechanism already measured.

## Consequences

**Lane 08 keeps its refusal and loses its lens.** It still refuses a merge whose gauntlet has not
been re-run against current trunk — that is deterministic and clears itself by re-running. It is
serialised for the same reason it always was: rebase-then-merge races otherwise.

**The bet is that the proposed lens catches what the warden would have, slower.** Findings reach the
owner at release rather than at merge. **If duplicated work starts landing in trunk and the lens is
not surfacing it, this is the decision to revisit** — and the evidence will be in the release
batches, which are already stored.

**Model assignment loses a role.** `DESIGN.md` §3 lists the merge warden under Sonnet; it comes off.
