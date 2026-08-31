import { requestDispatch } from "../shared/dispatch-request";
import type { GhExec } from "../shared/gh";
import type { Plan } from "../shared/plan-schema";
import { readySlices, type SliceState } from "../shared/ready-set";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { validateClaimsAreMutable, validateCriteriaShape, validatePathsAreRooted } from "../shared/render-body";
import { validatePlan } from "../shared/validate-graph";

/**
 * The `repository_dispatch` action lane 04 (`acceptance.yml`) is told by, once per published
 * slice — the first-authoring request lane 04 never had a sender for (#201). Before this, lane 04
 * had only its `issues: edited` re-fire (`refireAcceptance` in `acceptance.ts`), which re-authors a
 * slice's test after a spec edit but never authors it the first time, so `tests/acceptance/` had
 * never existed on `main` and lane 06/08's immutability check ran against a directory that had
 * never been written (#193 merged that way).
 *
 * `client_payload.ready` rides along rather than being recomputed by lane 04: it is exactly the
 * fact `readySlices` establishes right here (below), and a second read of the same graph downstream
 * would answer a question this dispatch has already settled. It is `1`/`0`, never a boolean —
 * `shared/dispatch-request.ts`'s `client_payload` is `string | number`.
 */
export const ACCEPTANCE_WANTED_DISPATCH_ACTION = "acceptance-wanted";

function dispatchAcceptanceWanted(gh: GhExec, issueNumber: number, ready: boolean): void {
  requestDispatch(gh, {
    event_type: ACCEPTANCE_WANTED_DISPATCH_ACTION,
    client_payload: { issue: issueNumber, ready: ready ? 1 : 0 },
  });
}

/**
 * Sends one `acceptance-wanted` dispatch per slice this publish creates, naming which of them are
 * ready — the send `acceptance.yml`'s new `author` job fires on.
 *
 * Nothing sent it until #145's seam audit. #167 built and tested `implement.yml`'s receiving end
 * and recorded that wiring its send "belongs to whichever ticket owns
 * `to-tickets/slice-and-publish.ts`" — and no slice in the PRD ever claimed that file, so lane 03
 * published 26 tickets that lane 05 could never be told about. #201 rewires the send again: lane 03
 * no longer tells lane 05 directly. **Order matters, and it is the one design point #201 names**:
 * lane 03 has to land a slice's tests on `main` *before* lane 05 claims the slice, or the
 * implementer's first push-gate run sees no tests for its ticket. The cheapest true ordering is for
 * lane 04 to be the one that tells lane 05, after that slice's tests are on `main` — so this
 * function no longer calls `dispatchTicketReady` (`shared/ready-set.ts`) itself; it asks for
 * acceptance authoring instead, and `acceptance.yml`'s `land` job sends `ticket-ready` once that
 * authoring has landed, for exactly the slices this function marked `ready`.
 *
 * **This asks `readySlices`; it does not answer readiness itself** (#179). It used to filter on
 * `dependsOn.length === 0` and explain that at publish time every edge is unresolved by
 * construction, so no tracker read was needed to make the test. That was true, and it was a
 * constant folded into a predicate — the real question is *every blocker delivered*, which merely
 * equals "zero declared edges" at t=0. Folded, it could only be answered once, and nothing sent the
 * second wave. Unfolded, this is one caller of the predicate rather than a second implementation of
 * it, and `dispatch/reconcile.ts` is the other.
 *
 * The state it hands over is the state a publish is in by construction: every issue open, nothing
 * merged, nothing started. So the answer here is unchanged — the slices with no declared edges —
 * and it is now the same answer, from the same function, that the reconciler will give tomorrow.
 *
 * Runs after `verifyBlockedByGraph`, so no slice is ever handed to lane 04 against a graph that
 * failed its read-back. A dispatch that throws stops the rest: a partially dispatched wave is
 * visible (the issues exist, some runs started) where a swallowed error would leave a slice
 * looking published-and-started when nothing was ever told to author its tests.
 */
export function dispatchReadySlices(plan: Plan, published: PublishedIssue[], gh: GhExec): PublishedIssue[] {
  const states: SliceState[] = published.map((issue, index) => ({
    number: issue.number,
    blockedBy: plan[index].dependsOn.map((dep) => published[dep - 1].number),
    delivery: "open",
    started: false,
  }));

  const readyNumbers = new Set(readySlices(states).map((state) => state.number));
  for (const issue of published) {
    dispatchAcceptanceWanted(gh, issue.number, readyNumbers.has(issue.number));
  }
  return published.filter((issue) => readyNumbers.has(issue.number));
}

/**
 * The one seam the deterministic half of this pipeline is tested through. A
 * plan goes in; published, attached, edged, and verified sub-issues come out.
 * Validate → render → create → attach → wire blocked-by → verify read-back,
 * in that order — validation happens before any write, so a malformed graph
 * costs zero `gh` calls to reject, and edges are only wired once every issue
 * in the plan exists to be pointed at.
 *
 * **It takes a plan, not a transcript.** It used to be handed the auditor's
 * whole raw response and re-run the `<output>` extraction over it — the
 * second parse of the same text, in a second place that could reject it.
 * The stage now hands over a `Plan` that the API and zod have both already
 * accepted, so what is left here is graph shape, which is this module's own
 * question rather than a re-check of somebody else's.
 *
 * Read-back verification runs last and throws on the first missing edge it
 * finds, so a publish that looks complete but wired incompletely fails
 * loudly instead of silently — and only then does `dispatchReadySlices`
 * start lane 05 on the slices that have nothing to wait for.
 *
 * **Four validations, not one** (#215, then #272, then #278). `validatePlan` asks whether the graph
 * is buildable; `validateCriteriaShape` asks whether the tickets it is about
 * to publish can ever be *verified* — whether `bin/close-ticket` can parse a
 * command out of each acceptance criterion, or will close them on nothing the
 * way it closed all 26 of PRD #145's; `validateClaimsAreMutable` asks whether they can ever be
 * *merged*, since a slice claiming a file in the immutable set is one lane 06 will refuse however
 * well it is built; `validatePathsAreRooted` asks whether the ticket means one thing, since a path
 * it leaves relative is a decision handed to lane 04 and lane 05 separately, and they answer it
 * separately. All four run before the first `gh` write,
 * so any refusal costs one re-fired slicer run and no tracker litter.
 */
export function sliceAndPublish(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  validatePlan(plan);
  validateCriteriaShape(plan);
  validateClaimsAreMutable(plan);
  validatePathsAreRooted(plan);
  const published = publishSubIssues(plan, prdNumber, gh);
  wireBlockedByEdges(plan, published, gh);
  verifyBlockedByGraph(plan, published, gh);
  dispatchReadySlices(plan, published, gh);
  return published;
}
