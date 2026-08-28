# A spec that arrives already written enters lane 02 at the critic, and the in-session collector is deleted

Recorded 2026-08-28.

Amends: ADR-0058, ADR-0062

Lane 02 has a second entrance. The owner's own hand putting `prd` on an issue — which is what
`bin/file-issue spec` does when `/to-spec` files a spec written in a live session — fires the
**critic** against that issue's own title and body, counts the findings with the same `gateCount`,
and hands the count to the same `applyGate`. **`runSpecAuthor` never runs on this path.** The
expensive half already happened in the session with the owner in it, so this door costs one Opus
stage where the cold doors cost two.

`collectInSessionContext` and ADR-0058's third trigger row go with it. The door survives; the
collector does not.

## The door was already open and nothing was listening at it

A spec written by `/to-spec` landed on the tracker carrying `prd` and stopped there forever. Nothing
was waiting for it, nothing was broken, and nothing anywhere knew it was stuck — no dispatch had
ever been owed, so even the lost-dispatch counter had nothing to say about it. [#180] sat in exactly
that state; [#145] sat in it before it was closed by hand. Four workflows woke on the label event
and all four skipped, correctly: none of them read `prd` on a `labeled` event.

ADR-0062's *"an event caused by the built-in `GITHUB_TOKEN` starts no workflow run"* is what forced
the runner's critic to be a stage rather than a label-fired job, and it does not bind here.
`file-issue` runs under the owner's own credentials, so his issue creation is a real event. Those
four skipped runs are the proof.

The stall was not even inert. A comment from the owner on such a spec *did* fire `spec.yml`, and
then died in `planSpecRun` on *"records no readable spec-source marker, so there is no decided
context to re-run it from"* — three red runs on 2026-08-28. That error is honest about the cold
path's constraint and wrong about this one: **a spec written in session is its own source.** The
trailer exists only because the collectors read the *idea* or the *map*, never the spec drafted from
them. This door has no such indirection, so an `answer` on a spec carrying no readable marker now
routes to the critic instead of throwing.

## Why firing on `prd` does not undo ADR-0062

ADR-0062 moved lane 03's trigger off `prd` so that **`prd` means *this is a spec*** and
**`sliceable` means *it has no unanswered questions***. Both survive unchanged. This adds a
different verb — *critique it* — on a label that already means *this is a spec*, and the slicer
still fires only on the dispatch that accompanies `sliceable`. What ADR-0062 killed was slicing
before a critic had read the spec, and that stays dead: here the critic is what the label fires, and
the count is still the only thing that dispatches.

Nor is the label a second implementation of the gate. `gateCount` and `applyGate` are reached
through one function, `gateSpec`, called by both doors.

**The sender gate is load-bearing.** This lane spends `CLAUDE_CODE_OAUTH_TOKEN` and the repository
is public (ADR-0073, ADR-0075). `prd` can be applied by anyone with write access, so the clause
carries `github.event.sender.login == github.repository_owner` — the same condition `shape.yml` and
the existing `to-spec` clause already carry, for the same reason. Remove-and-re-add of `prd` is the
re-run gesture, as it is in lane 01.

## The critic reads the answering comments

One thing does not transfer from the runner path. There, the owner's answer re-runs the **author**,
which redrafts the body, and the recount is taken against new text. Here there is no author, so
re-running the critic against an unchanged body would produce the same findings forever and the
count could never fall.

So this path passes **the owner's answering comments alongside the body** — a third variable on the
critic's prompt, so it can see a finding as answered. That is what keeps ADR-0062's *"his answer
re-runs the chain, which recomputes the count"* true for both doors: on this one the answer reaches
the only model there is.

## The in-session collector is deleted

A collector exists to hand a package to a model that is **not in the room**. The sheet and map
collectors fetch an issue and assemble a decided context for an author running on a runner. The
in-session collector was that shape for the terminal door — except there was nothing to fetch, and
every one of its five fields carried the same transcript. Under this ruling the skill writes the
spec directly, in a session that already holds the conversation, so no package is ever assembled and
nothing calls it. Dead code that documents a live-looking path is worse than no code: the next
reader wires it up.

## Considered options

- **Held is terminal; the owner re-runs `/to-spec`.** Cheaper to build and worse. It throws away the
  published issue and its number on every round, and it makes ADR-0062's re-run loop false for one
  of the two doors.
- **Move the critic into the `/to-spec` skill.** Rejected. The skill's whole value is that the spec
  is on the tracker in seconds and the terminal is free; a local Opus stage would spend it against a
  session the owner is trying to walk away from. The runner is the right caller precisely because
  the owner has left.
- **Keep the collector against a future runner-side in-session author.** Rejected: ADR-0058 already
  refused serialising a live conversation for a runner to read back (*"lossy compression that pays
  double tokens for less signal"*), so the caller it was waiting for is one that ruling forbids.

## Consequences

**ADR-0058's trigger table loses its third row.** One prompt with a collector per trigger still
holds — for the two triggers that reach an author. The third door reaches the critic, and a critic
needs no collector because the spec is the package.

**ADR-0062 gains the case it did not consider.** Its re-run loop holds for both doors, reaching the
critic on this one because there is no author to reach.

**Everything this job writes it writes with `GITHUB_TOKEN`,** which starts nothing. So `sliceable`
and the dispatch close no loop back onto this workflow, for free.

[#180]: https://github.com/collod873/claude-workflow/issues/180
[#145]: https://github.com/collod873/claude-workflow/issues/145
