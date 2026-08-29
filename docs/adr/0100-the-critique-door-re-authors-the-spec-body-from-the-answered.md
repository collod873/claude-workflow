# The critique door re-authors the spec body from the answered thread before the gate applies sliceable

Recorded 2026-08-29.

Amends: ADR-0085

ADR-0085 gave the warm door a critic and no author, so the rounds it settles reach the owner's
comments and stop there — and lane 03 slices the draft those rounds argued down (#194, #189, #190).
When the count falls to zero on a spec that answered at least one round, one Opus stage rewrites the
issue body from the body plus the answering comments, and `applyGate` runs after it.

## The body is the ledger, not just the source lane 03 reads

The alternative was to leave the rulings in comments and teach lane 03 to read the thread. That
loses to one fact about a lane nobody was thinking about: `affectedSlices`
(`.Workflow/agent-workflows/shared/affected-tests.ts`) diffs a slice's test-named criteria against
the **spec body**, verbatim, by `String.prototype.includes`. A criterion that only ever existed in a
comment is a string the body will never contain, so lane 04's re-entry trigger reads every slice cut
from a ruling as a slice that lost its test — permanently, on every future edit to that spec. The
harder a spec was critiqued, the noisier its re-entry becomes.

The mirror of that fact is why the rewrite itself is free. Lane 02 writes with the built-in
`GITHUB_TOKEN`, which starts no workflow run (ADR-0062), so `acceptance.yml`'s `issues: edited`
never fires on it; its sender gate would refuse `github-actions[bot]` anyway; and the rewrite lands
before `sliceable`, when the spec has no slices for `affectedSlices` to name. Three independent
reasons the collision does not exist.

## Considered options

- **Append the answered rounds as a `## Rulings` section, with no model.** Rejected. #189 rewrote
  three criteria and added two, and appending cannot rewrite one — lane 03 and lane 04 both key off
  the criteria list, which would still carry the argued-down text with a contradiction below it. It
  is also actively worse for the grep: the body would contain both strings, so the edit that finally
  fixes the criterion re-fires acceptance for a slice whose test was right all along.
- **Keep the rulings in comments and teach lane 03 to read the thread.** Rejected on the ledger
  argument above, and because it makes three readers learn the thread — lane 03, lane 04's re-fire,
  and #159's amendment path — where re-authoring makes one writer keep a contract they already have.

## Consequences

**The rewritten body is not re-critiqued.** The count was taken against the text the owner answered;
re-running the critic over the rewrite could raise a fresh finding and re-hold a spec he has already
cleared, with no round left for him to answer. The gate stands on the count that already fell.

**A first-round clearance spends nothing.** `answeringComments` empty means no round was ever
answered, so there is nothing to fold in and no stage runs — the guard is the comment list, not a
model's judgement.

**ADR-0085's "one Opus stage where the cold doors cost two" now reads "one, or two when the owner
answered."** The second stage is paid once per cleared spec, not once per round.
