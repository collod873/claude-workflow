# The accept dispatches lane 02 rather than lane 02 firing on the approved label, because the collector reads what the accept writes

Recorded 2026-08-27.

Amends: [ADR-0058](0058-lane-02-is-one-prompt-with-a-collector-per-trigger-and-a-pay.md).

Lane 02's sheet trigger is a `repository_dispatch` that `accept.ts` sends after it has posted the
accept comment. It is **not** the `approved` label, which is what ADR-0058's trigger table says and
what `accept.ts`'s own closing line promised ("it fires on this same label").

## The hole this closes

ADR-0058 gave the sheet collector its input: "the idea body verbatim; the latest `decision-sheet:v1`
marker; **the accept's marker**". The accept's marker is written by `shape-accept.yml`, which fires
on `approved`. If lane 02 also fires on `approved`, the two runs start from the same event and race,
and the thing being raced for is the thing the collector cannot proceed without —
`collectSheetContext` throws when no accept payload is present, and it is right to, because ADR-0058
built that payload precisely so nothing would fall back to parsing the rendered comment.

The race is not a rare interleaving. Lane 01's accept files ADRs, commits them, and pushes to `main`
before it comments; lane 02 would be several seconds into an Opus stage by then. The common case is
the broken one.

ADR-0058 did not get this wrong so much as write the trigger row before the lane it depends on had
shipped. `accept.ts` landed afterwards, and its closing line — "**Not dispatched.** Lane 02 does not
run on a runner yet" — is the note of an author who knew the wiring was still owed.

## Why a dispatch is available here at all

[ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)'s forcing fact cuts
the other way for once. An event caused by the built-in `GITHUB_TOKEN` starts no workflow run, which
is why the accept cannot simply apply a second label and have lane 02 fire on that — the label would
be applied by the accept's own token and would create nothing.
`repository_dispatch` is the documented exception, and this repo already runs five workflows off one.

So the same mechanism that forced lane 05's verification onto a dispatch forces lane 02's sheet
trigger onto one, for the mirror-image reason: there, a run had to be started by something the token
could cause; here, a run has to be started **after** something the token did.

## Considered options

- **Keep the `approved` label as the trigger and have the collector retry until the marker appears.**
  Rejected. It spends an Opus stage's startup on a poll, it has no correct timeout — a genuinely
  sheet-less idea looks identical to one whose accept is slow — and `CONTEXT.md`'s **Fail-open** rule
  is against a gate whose failure mode is proceeding with less context than it was promised.
- **One workflow that accepts and then specs, in sequence.** Rejected. It welds lane 01 and lane 02
  into a single job with a single failure surface, so a spec-author failure re-runs the ADR filing —
  which is the one step in this estate that must never run twice (`accept.ts`'s own
  `already-accepted` guard exists for exactly that).
- **`workflow_dispatch` against `main` from the accept.** Works, and rejected for
  [ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)'s reason: it runs
  the workflow file on whatever ref it is given, so it holds only if every caller passes `--ref main`.
- **`repository_dispatch` from the accept, after the comment.** Chosen.

## Consequences

**The accept's send is ordered last, after the comment that carries the marker.** That ordering is
the whole ruling, and it is the same shape `applyGate` and `openPrAndDispatch` already hold to: write
the durable trace, then dispatch. A dispatch that fails to send leaves an accepted idea carrying its
marker and no spec — visible, and re-runnable by hand — where the reverse order would leave lane 02
reading an issue the accept had not finished writing.

**`accept.ts`'s "Not dispatched" note goes away**, because it is now false.

**The `to-spec` label survives as the map trigger only**
([ADR-0059](0059-a-closed-map-reaches-lane-02-by-its-to-spec-label-never-by-b.md) is undisturbed), and
the owner-gate on it stays: a label trigger is a human's click and is gated on
`github.event.sender.login == github.repository_owner`. The dispatch carries no sender gate, for
ADR-0073's reason — `POST /dispatches` needs write access, so the send *is* the gate.

**A second sender of this dispatch is a second way into lane 02**, and there is exactly one today.
If a third trigger is ever added, it belongs in the same collector table ADR-0058 owns rather than in
a new workflow.
