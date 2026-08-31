# The owner signs by not reverting, and a revert writes declined memory

Recorded 2026-08-31.

Amends: ADR-0006

A ratified standard lands as a merged pull request the owner did not have to touch. To decline one,
he reverts it — or deletes the entry or the rule in any later commit — and a push-triggered detector
turns that into a `declined` record, which suppresses the finding until it grows a site the decision
never covered. There is no checkbox, no approval step and no surface for review anywhere in the
lane. Ruled by the owner in [#296](https://github.com/collod873/claude-workflow/issues/296).

## Why a revert is a stronger signature than a checkbox

ADR-0006 restated W5 as *agents draft, the owner signs*, and the whole of its own Consequences
section is a warning about what a signature is worth: across 81 menu-style questions the owner took
the recommended first option 73 times, and the ADR called the sheet's override rate "a prediction,
and the thing to measure."

The release-PR checklist was that prediction, measured. Eighteen pull requests in five days, ten
merged in fifteen minutes at ninety-second intervals, and no box ever changed a finding's fate
because the mechanised half behind it was empty. **An unticked box is indistinguishable from a pull
request nobody read.** Not-reading and declining produce byte-identical evidence, which means the
checkbox never carried a signal at all — it carried a click.

A revert cannot be produced by inaction. It costs a deliberate act, in GitHub, where the owner
already reviews everything after the fact. So the signature moves to the side of the decision where
silence means *yes* rather than *unread*, and the expensive act is reserved for the rare case.

**ADR-0006's prediction becomes measurable in a way it was not before.** Revert rate is a real
number over a real denominator — every standard that landed — where "override rate on sheets" was a
rate over questions the owner had already said he did not have the context to answer.

## Why the detector is tree-versus-memory and nothing else

It lists the entry names and enabled rule ids present in the tree, compares them against every
`ratified` record's `landedAs`, and writes a `declined` record for anything the record says landed
that the tree no longer carries. No revert-message parsing, no trailer archaeology, no queue.

That shape makes it a **back-stamp** rather than a counter
([ADR-0044](0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md) /
[ADR-0046](0046-the-backwards-question-writes-rather-than-reports-so-it-need.md)): the output is a
committed write recomputed from state on every run and never stored, so it needs no reader, no
`DESIGN.md` §6 row and no [ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md) admission.
Idempotence falls out of it — a finding already carrying a `declined` record derives nothing new.

The trigger is a push to `main` touching `CODING_STANDARDS.md` or `eslint.config.js`, which is the
only moment the answer can have changed; every other push is silent by construction rather than by a
filter. And it cannot loop itself: lane 08 merges with the built-in `GITHUB_TOKEN`, whose pushes
start no workflow runs, so the ratifier's own landings never fire the detector and a human's push
does — exactly the event it exists for.

## Consequences

**A rule switched off counts as reverted.** Deleting a rule and setting it to `off` are the same
decision expressed two ways, and one mechanical rule covers both rather than two that can disagree.

**The owner can decline without writing anything down.** The reason recorded is
`reverted by owner at <sha>`, which is all the memory needs: `filterByRatificationMemory` matches on
the finding and its site list, never on prose. If he wants to say more, the revert commit's own
message is where it goes, and nothing here parses it.
