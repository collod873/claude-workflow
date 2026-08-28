# The close gate fires in the agent's turn at both venues, so the tracker-side gate and its reconciler retire

Recorded 2026-08-28.

Amends: ADR-0021, ADR-0023, ADR-0048

The close gate is one file, `.claude/hooks/close-gate.py`, checked into this repo and registered as
a PreToolUse hook. It judges a close before the close runs — at this workstation and inside every
stage on a GitHub-hosted runner — and `.github/workflows/close-gate.yml`, its reconciler, and the
`close-refused` label go away.

[ADR-0010](0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md) says a gate fires at the
earliest venue that can run it, because what earliest buys is the cost of the *repair*: an error
caught in the turn that caused it is fixed with the context still hot. Lane 09 read "earliest" as a
question about machines and concluded the tracker, since the workstation could not see a runner. The
mistake was in the unit. The earliest venue is not a machine, it is **the agent's turn** — and a
runner has turns too.

## What was verified rather than assumed

A repo-checked-in `.claude/settings.json` PreToolUse hook fires under
`--dangerously-skip-permissions`, which is what `shared/stage.ts` passes for every stage, and its
`deny` is honoured there: the command does not run, and the agent gets the reason in-turn.

Run [33216452104](https://github.com/collod873/claude-workflow/actions/runs/33216452104) is the
drill. A stage on `ubuntu-latest` was told to close drill ticket #187 with a bare
`gh issue close 187 --comment "done"`. The gate's own log on the runner carries the row —
`22:21:36Z … 187 deny no-closing-record /usr/bin/gh` — and the stage's one-line report says what
happened next:

> `gh issue close 187 --comment "done"` was refused by the close-gate hook for lacking a
> `## Closing record`; I ran `bin/close-ticket 187 HEAD~1..HEAD …` instead, which verified the
> criterion and closed issue #187.

Refused and repaired inside one stage, in twelve seconds, with no second run and no cold context.
The tracker-side gate's repair for the identical mistake cost a whole session that had already
ended.

## Considered options

- **Keep both venues.** What ADR-0021 arranged, and the reason it stood the local hook down: two
  copies of one rule drift, and #55's drill found they already had. That argument was right about
  drift and wrong about the cure — the cure is one *file*, not one venue. The hook now stands down
  where a repo checks in a copy of itself, and refuses to stand down for the copy that is running,
  so exactly one of the two judges and there is no second rule to disagree with.
- **Teach the tracker gate to dispatch a fixer.** Keeps `issues.closed` and buys back the fast
  repair. Rejected on cost and on shape: it spends a runner and a model call per refusal to
  reconstruct what the closing agent knew for free, and it makes the repair another thing that can
  silently stop arriving.
- **Move the venue.** Chosen.

## Consequences

**A close that never passes through a Bash tool call is no longer judged.** A `Closes #704` merge
keyword, the web UI, a phone — `issues.closed` saw all of those and this cannot. That is a real
loss and the sharpest one here; it is accepted because those closes are the owner's own, made
deliberately, and because the closes this pipeline actually produces are agent closes, which all
go through a tool call. Nothing counts what slips past.

**A hook that crashes fails open and nothing counts that either.** The reconciler existed to find
closes the gate never judged, and there is no equivalent for a hook that died — the hole the venue
move was originally made to fix, traded back, deliberately, for same-turn repair.

**[ADR-0013](0013-the-close-gate-judges-only-a-close-marked-completed.md) survives its enforcer.**
The rule that only a `completed` close claims a delivery moved into the hook, which had never known
a close carries a reason at all — the one axis on which the two copies had genuinely drifted. It is
now held in one place instead of neither.

**[ADR-0023](0023-the-close-refused-label-is-state-not-history-a-passing-re-cl.md) retires with the
label.** `close-refused` meant "this gate reopened a close and has not since accepted one". A gate
that refuses before the close happens never reopens anything, so there is no state for a label to
carry. **[ADR-0048](0048-the-close-gate-s-reconciler-rides-session-end-because-a-cron.md) retires
with the reconciler** for the same reason: it asked "which completed closes have no gate run?", and
there are no gate runs to look for.

**The gate now lives in two repositories and must be copied between them by hand.** `close-gate.py`
and `_hook.py` are byte-identical to their originals in `collod873/agent-skills`, and nothing
enforces that. What is enforced is that the checked-in copy is alive: `.claude/hooks/close-gate.test.ts`
drives it on this repo's own layout, because the three ways a copy breaks without the original
breaking — a lost `bin/` on the import path, the copy standing down for itself, no interpreter —
all fail open and none of them would otherwise show up as a failure.
