# The in-session gauntlet stands down inside a stage, whose last word must be its output block

Recorded 2026-08-27.

The in-turn and turn-end venues exist to make Claude keep working: a block hands the failing checks
back and asks for another turn. A stage's contract is the opposite — `stream-json` carries only the
final turn's text, so its answer is whatever it said **last**, and any block at all spends that
answer on a reply to a hook. `execClaude` therefore marks every session it spawns with
`WORKFLOW_STAGE=1`, and `.claude/hooks/gauntlet-hook.mjs` stays silent when it sees it.

#134 is what this costs when it doesn't hold. The auditor had already written its grading notes and
its `<output>` block; the turn-end venue then reported a suite failure the auditor had not caused
and could not have fixed, the model spent its last turn establishing exactly that, and the stage
died on "response has no `<output>` block" — eight minutes and $1.15, with a finished plan
discarded.

## Considered options

- **Take the last `<output>` block across every turn rather than the last turn.** Rejected: it
  widens the seam [ADR-0012](0012-a-stage-s-output-block-is-the-outermost-span-and-the-payload.md)
  deliberately narrowed, and it would have a stage answer with a block written before it was told
  something new — the one case where an earlier answer is the wrong one.
- **Detect CI and stand down there.** Rejected: it is the wrong fact. A stage run locally for
  debugging has no human reading a hook either, and a CI job is not the thing that makes these
  venues unusable — the output contract is.
- **Leave the venues on and accept the loss when they fire.** Rejected: the price is a whole lane
  run per occurrence, paid at random by whatever unrelated thing is red that afternoon.

## Consequences

**A stage's checks are not skipped, they are relocated.** `verify.yml` runs the same gauntlet at the
venue that can fail a run, which is the venue that should be judging a stage's tree anyway — the
stage itself edits nothing.

**This is [ADR-0021](0021-one-gate-per-rule-the-workstation-close-hook-stands-down-whe.md)'s shape,
one gate per rule.** A hook stands down where another venue owns the same judgement, and it reads
the fact off its own environment rather than asking anything.

**The marker is set at one seam and read at one seam.** `execClaude` is the only place any lane
spawns a model, so a lane added later inherits the stand-down without knowing it exists — which is
the only version of this that survives a lane nobody has written yet.
