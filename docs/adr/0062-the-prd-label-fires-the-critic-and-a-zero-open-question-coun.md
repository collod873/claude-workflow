# The prd label fires the critic, and a zero open-question count dispatches the slicer

Recorded 2026-08-26.

`~/bin/file-issue spec` applies `prd`, and `to-tickets.yml` fires on `prd` — so a published spec
slices itself **immediately**, before the critic has read it and before a single open question has
been answered. §02 budgets 5–15 owner minutes at exactly that point and the venue gives them nowhere
to happen.

`prd` keeps meaning **this is a spec** and stops meaning **slice it**:

1. The author publishes. The spec carries `prd`, as it does today.
2. The critic runs **in the same chain**, before publication, and its findings become more numbered
   open questions ([ADR-0061](0061-everything-lane-02-cannot-settle-becomes-a-numbered-open-que.md)).
   It proposes no fixes — §02: *proposing lets it paper over the ambiguity it exists to surface.*
3. **The gate is a count.** Zero unanswered open questions → the job applies `sliceable` and sends a
   `repository_dispatch`. Lane 03 fires on that dispatch, never on a label.
4. A non-zero count is the only thing that reaches the owner. His answer re-runs the chain, which
   recomputes the count.

## Why the trigger had to move rather than the label

Exactly one thing reads `prd` as *slice it*: `.github/workflows/to-tickets.yml:53`. Everything else
reads it as *this is a spec* — `release-on-prd-close.yml`'s `PRD_LABEL`, `/triage`'s skip-branch for
sub-issues of a `prd`-labelled spec, `docs/agents/triage-labels.md`, `CONTEXT.md`'s **Spec** entry,
and `~/bin/file-issue`, which lives in another repo. Moving the slicer's trigger is one line in one
workflow. Renaming the label is an estate-wide edit for the same effect.

## Why the critic is a stage and not a PR reviewer

§02 fires the critic *"on PR open"* against an output that is an issue, and there is no PR anywhere in
this lane — ADR-0051 and ADR-0053 have each ruled that a pull request nobody's judgement sits behind
is ceremony.

The forcing fact is one level below that: **an event caused by the built-in `GITHUB_TOKEN` starts no
workflow run** ([ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)). A
job that publishes the spec and applies `prd` triggers nothing, so a critic waiting on that label
never runs. The same fact is why step 3 above is a dispatch: `sliceable` applied by a job is inert.

So the critic is a stage in the chain, reading the author's output in process — which is exactly how
lane 01's refuter reads the shaper's (`runRefuter(deps, shaped)`), three stages in one `npx tsx` call.
It is also strictly better: the critic's questions land **before** publication, so the published spec
carries the complete list and there is one count rather than two versions of one.

## The gate spends no judgement

A model writes the questions; a deterministic rule counts them. That is
[ADR-0014](0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md)'s seam — *the model
translates; the grammar decides* — and it is what makes an automatic dispatch safe here. Nothing
decides that a spec is good enough; something counts whether anything is still unanswered.

**The common case has no owner in it.** A spec with no invented intent, no disputed ruling and no
unfiled mark, whose critic found nothing, counts zero and slices. §0's five owner points are
unchanged in number — lane 02's is still there — but it is now **conditional**: it fires when the
machine has a question it cannot answer, and is silent otherwise.

## Considered options

- **Reuse `approved` as the go-label.** Rejected by the owner, and the reason is sound: `approved`
  already fires `shape-accept.yml`, which would comment *"Approved, but there is no sheet on this
  issue"* on every spec, and one label meaning two things across two lanes is a guard away from
  firing the wrong one.
- **No label — dispatch alone.** Rejected. The dispatch is *"a thing that can silently stop
  arriving"* (ADR-0054), which is [#41](https://github.com/collod873/claude-workflow/issues/41)'s
  whole failure class. `sliceable` written **before** the dispatch is the durable trace that one was
  owed, so a spec carrying it with no sub-issues and no completed run is a lost dispatch and is
  countable. That is what stops the label being a note in ADR-0034's sense.
- **The critic applies the go-label on its own verdict.** Rejected against ADR-0014: it makes a model
  the gate. The count does the same job with no model in it.
- **The owner applies the go-label after answering.** Rejected on ADR-0051's argument: a click after
  the decision has already been made is *"the worst kind… pure ceremony sitting on the one owner point
  this lane has."*

## Consequences

**The answering rounds are uncapped, and that is a deliberate departure from §01.** Lane 01 caps
change requests at 2 because the owner is asking the shaper to try again. Here the machine asked and
the owner is answering, and a cap would park a spec he is actively working on — the drain-onto-the-owner
outcome ADR-0011 rules against, arriving from the other direction.

**A spec that never reaches zero never slices.** That is the correct behaviour and it is visible: the
issue sits carrying `prd` without `sliceable`, and it is the same shape as any other open decision in
his queue.

**Two workflow comments go stale, and are corrected by the edit that moves the trigger — move 6, not
this ruling.** `to-tickets.yml` says *"that label is the whole trigger"*, and
`release-on-prd-close.yml` calls `prd` *"`to-tickets.yml`'s own trigger label."* Neither survives the
move, and `release-on-prd-close.yml`'s own `if` is unaffected: it reads `prd` in the surviving sense,
as what makes an issue a spec at all.
