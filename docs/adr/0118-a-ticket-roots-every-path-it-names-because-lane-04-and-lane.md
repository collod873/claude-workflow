# A ticket roots every path it names, because lane 04 and lane 05 root a relative one separately

Recorded 2026-08-31.

Every path a published ticket names has to be resolvable from the ticket alone: `filesClaimed`
carries the full path from the repository root, and the prose may only abbreviate a path the same
slice claims in full. `validatePathsAreRooted` (`shared/render-body.ts`) refuses the plan before the
first `gh` write, beside the three validations already there.

## Why

Lane 04 and lane 05 never see each other. Neither reads the other's diff, neither can ask a
question, and neither runs first in a way that would let it discover a disagreement. The ticket body
is the entire coordination mechanism between them, so a path it leaves relative is not an
imprecision — it is a decision handed to two blind readers at once, and they are not obliged to
answer it the same way.

#272's `What to build` said the checkpoint is written as `<stage>.json` **under `checkpoints/`**, and
never said rooted where. Lane 04 read `join(dirname(handoffPath()), "checkpoints")` and probed
`<tmp>/checkpoints`. Lane 05 wrote `.Workflow/agent-workflows/checkpoints`. Both readings are
faithful to the sentence; the two never meet, and three acceptance tests went red.

What makes that expensive rather than merely wrong is the presentation. A red acceptance test in
lane 06 looks identical whatever caused it — *the implementation does not satisfy the test* — so the
retry loop re-fires lane 05, the one lane that was not wrong, against a reading it was never given.
Nothing in the pipeline can say "these two read the same sentence differently"; there is only a red
check, and it costs a model run per attempt without converging.

## Resolvable from the ticket, not absolute

The rule that shipped is narrower than "spell every path absolutely," and the narrowing is what
makes it usable. A path passes when its first segment is a real top-level entry of the repository,
**or** when `filesClaimed` spells it in full and the prose abbreviates it — `shared/stage.ts` beside
a claim of `.Workflow/agent-workflows/shared/stage.ts` names one file and only one. `filesClaimed`
itself is held to the rooted half alone, because it is what the prose anchors *to*.

Measured against PRD #271's four tickets exactly as lane 03 published them: #274, #275 and #276 pass
untouched, and #272 is refused on `checkpoints/` and nothing else. Those four are the whole corpus
this rule has, and they are pinned as the gate's own regression test. A rule that refused #272's
`shared/handoff-path.ts` too would have bounced all four, which is the version of this gate that
would have been switched off within a week.

## Considered options

- **Refuse every unrooted path, including abbreviations of a claimed file.** Rejected on the
  measurement above: it refuses three tickets that built and merged cleanly, and lane 03 pays a
  re-fired model run for each. A ticket that says `stage.ts` while claiming
  `.Workflow/agent-workflows/shared/stage.ts` has already decided; there is nothing for a reader to
  guess.
- **Teach lane 04 and lane 05 to compare notes.** Rejected here as the wrong venue rather than the
  wrong idea. It is the ADR-0010 argument: the ambiguity is visible in the slicer's own output,
  before either lane exists, and a gate placed there costs nothing where the same gate placed
  downstream costs a paid run to discover and another to repair. Making a lane 04 / lane 05
  disagreement legible *as* a disagreement is real and still unbuilt — `spec/gap` (ADR-0034) has
  exactly one writer, lane 07's conformance reviewer, and nothing in lanes 04–06 can raise it (#278).
- **Say it in the slice prompt and gate nothing.** Rejected. Both plan prompts' own worked examples
  showed `shared/gh.ts` and `shared/publish-sub-issues.test.ts` — the skeleton a model copies was
  itself the defect. Prose that a mechanism does not hold to drifts; the examples are now run
  through the real gate in `prompt-skeleton.test.ts`, so they cannot drift away from the rule
  without failing.

## Consequences

**Lane 03 has four validations, and every one of them was added after something was paid for.**
`validateCriteriaShape` after 26 tickets closed on `0 of N criteria verified`; `REMOTE_TRACKER_RE`
after #201 checked the tracker instead of the tree; `validateClaimsAreMutable` after #272 claimed an
immutable file; this after the same ticket left a directory unrooted. That is the pattern #278 names
and this ruling does not break: all four ask a shape question, none asks whether the ticket means one
thing, and the next unknown downstream constraint will arrive the same way.

**The anchor is the real repository tree**, read once from `shared/`'s own position in it. A slice
that genuinely introduces a new top-level directory has to spell it in `filesClaimed` before the
prose may abbreviate it, which is a refusal worth taking: a brand-new root is exactly the case a
reader cannot resolve from context.
