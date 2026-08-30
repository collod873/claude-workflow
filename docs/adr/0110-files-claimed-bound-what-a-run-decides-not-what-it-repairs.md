# Files claimed bound what a run decides, not what it repairs

Recorded 2026-08-29.

Amends: [ADR-0107](0107-a-stage-runs-the-gate-its-output-will-be-judged-by-before-it.md), which told the
stage to run the gate and stopped there — see "What this amends".

A ticket's "Files claimed" is the boundary on what a run may *choose*. It is not the boundary on
what a run may *repair*. Two repairs sit outside it and are part of the change rather than separate
work:

- **A generated artifact the change made stale.** The wrapper regenerates it, after the answer and
  before the commit. The implementer is not told about it and does not return it.
- **A test the change itself turned red, where the fixture is wrong and the assertion is right.**
  The implementer fixes it and names the file in its summary. Never anything under
  `tests/acceptance/`, and never by changing what a test asserts.

## What this amends

[ADR-0107](0107-a-stage-runs-the-gate-its-output-will-be-judged-by-before-it.md) ruled that a stage
runs the gate its output will be judged by, before it answers. It works — and it is only half a
mechanism, because it gave the stage sight of a red gate without the authority to act on what it
saw. This is the other half. ADR-0107 is otherwise unchanged.

## The evidence

Both runs of the wave on 2026-08-30 died at the push gate, on the same shape, having built the
right thing.

[Run 33284271618](https://github.com/collod873/claude-workflow/actions/runs/33284271618) (#240)
tightened `validatePlan` to exactly one unblocked root, correctly. Three fixtures in
`to-tickets/slice-and-publish.test.ts` and `to-tickets/to-tickets.test.ts` built multi-root plans
that were legal before it and are not after. Its summary said so, precisely: *"I could not touch
those files since they weren't in this ticket's Files claimed, so a sibling ticket/PR will need to
update those fixtures."*

[Run 33284271370](https://github.com/collod873/claude-workflow/actions/runs/33284271370) (#242)
wrote its ADR correctly. Landing any ADR makes `watchdog/adr-corpus.evidence.json` stale — the push
venue's `corpus` check is `regenerate && diff` (ADR-0056) — and the fixture is not in
`docs/adr/*.md`. Its summary named the exact command the next person should run.

Both were honest, both were right about what was wrong, and both lost the whole run. The work was
recovered by hand from the ADR-0103 artifacts and landed for the cost of running the generator and
editing three fixtures — minutes of deterministic work, against roughly $6 of model time each,
thrown away because a boundary meant for one thing was doing another.

## Why the two repairs are different, and handled differently

**A generated artifact is not a decision.** Its content is a function of the tree. The implementer
does not get a say in what it says, so there is nothing for a claim to protect, and no judgement to
spend a model on. It is also, in one case, 472 KB — not a thing to ask a structured answer to
reproduce byte-for-byte even if it were free. So the wrapper runs the generator, and the prompt
tells the implementer not to think about it at all. `implement.ts` already owns every write to disk
and every write to GitHub for exactly this reason; this is one more.

**A red test is a decision, and a dangerous one.** "Make the test pass" is the instruction that
produces a weakened test, which is the failure mode this whole pipeline is arranged against — the
implementer prompt's first non-negotiable already says a test that still fails honestly is worth
more than one you talked yourself past. So it stays with the model, under two limits: nothing under
`tests/acceptance/` (those are the spec, restored from trunk before anyone runs them, so an edit
there changes nothing but what the implementer believed), and the fixture only, never the
assertion. Every widened file is named in the summary, so it lands as a decision on the record
rather than a file the run appears to have wandered into.

## Considered options

- **Widen the tickets instead** — rejected as the general answer, though it is what unblocked #240
  and #242 by hand. Lane 03 writes "Files claimed" from what a slice looks like it touches; it
  cannot know which fixtures elsewhere encode the rule being tightened, and asking it to would mean
  giving the slicer a repo-wide read it does not have and should not want (ADR-0069: the graph is
  lane 03's output, not its research project).
- **Let the run report and let a sibling ticket fix it** — rejected. That is what happened, and it
  costs a whole run per occurrence to discover something the run already knew. It also files a
  ticket whose only content is "finish the previous ticket".
- **Drop the claim boundary entirely** — rejected. It is doing real work: it is why a slice cannot
  quietly rewrite a neighbour's module, and (with the chain-shape ladder) why two ready slices are
  file-disjoint, which is what [ADR-0108](0108-implementer-concurrency-is-keyed-per-ticket-because-a-fixed.md)
  rests on. The boundary is right; it was being asked to mean two things.

## Consequences

**A run's commit can now contain files its ticket does not name**, and the summary is where that is
accounted for. A reviewer who sees an unclaimed file with no explanation in the PR body is looking
at a defect.

**The generated-artifact list is now a thing that can drift.** `bin/gauntlet` names these in bash
and `regenerate-artifacts.ts` names them in TypeScript, and no compiler sees across that. A test
holds them level, the same way the dispatch-action tests do.

**The wiring baseline is deliberately excluded**, and that exclusion is itself pinned by a test. It
is the one `regenerate && diff` artifact that encodes standing debt rather than a snapshot: it only
ever shrinks, so regenerating it would swallow exactly the finding it exists to raise (ADR-0086).

**A failing generator does not fail the run.** It is refreshing something nobody asked for, so the
worst case is the tree the run was already going to push, and the push gate then names the stale
artifact — a legible failure, and better than dying here with nothing to say about the ticket.
