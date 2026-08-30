import { requestDispatch } from "../shared/dispatch-request";
import type { GhExec } from "../shared/gh";

/**
 * #263's gate: every lane 02 run labels the spec `sliceable` and asks for the dispatch — the label
 * written first, so a lost dispatch stays a countable durable trace rather than a silent stop
 * (ADR-0062's ordering argument, kept after the count it used to gate on was retired). There is no
 * longer a "held" outcome: a run whose author or critic could not resolve everything dispatches
 * anyway, on the theory that a spec sitting unsliced while nobody reads its unresolved edges is
 * worse than one that ships with an edge still rough. Getting the owner in front of what a run
 * could not settle is `spec.ts`'s reconciler now (folded into the body as a stated assumption),
 * never this gate holding a dispatch back to ask him.
 *
 * `gateCount` still exists to say *how much* a run left unresolved — worth carrying in a log line —
 * but nothing downstream branches on it any more.
 */

/** The two fields of a sheet's `Decision` (`shape/sheet-schema.ts`) this arithmetic needs — nothing else. */
export interface MarkedDecision {
  mark: string;
  adrTitle: string;
}

/**
 * The set of a sheet's decisions that carry a mark, have no filed `adrTitle`, and are named by no
 * open question — the load-bearing guesses the author let through with nothing on the record for
 * them. `spec.ts`'s `runSpecAuthor` folds each of these into the draft as a stated assumption before
 * the gate is ever reached; this is the set that folding acts on, not a thing the gate itself reads.
 */
export function unfiledMarks(decisions: MarkedDecision[], openQuestions: string[]): MarkedDecision[] {
  return decisions.filter(
    (decision) =>
      decision.mark !== "" &&
      decision.adrTitle === "" &&
      !openQuestions.some((question) => question.includes(decision.mark)),
  );
}

/** The size of `unfiledMarks` — zero when every marked-and-unfiled decision was named by some open question. */
export function unfiledMarkGap(decisions: MarkedDecision[], openQuestions: string[]): number {
  return unfiledMarks(decisions, openQuestions).length;
}

/**
 * How much a run left unresolved: every open question the chain produced, plus `unfiledMarkGap`'s
 * count of any sheet mark the author never surfaced at all. Reported alongside the gate's own
 * outcome (`spec.ts`'s `gateSpec`) — nothing here or downstream of it holds a dispatch back on this
 * number any more.
 */
export function gateCount(openQuestions: string[], decisions: MarkedDecision[] = []): number {
  return openQuestions.length + unfiledMarkGap(decisions, openQuestions);
}

/** The label every lane 02 run applies before it dispatches. */
export const SLICEABLE_LABEL = "sliceable";

/**
 * The `repository_dispatch` action name a run sends — the wire name lane 03's trigger reads for
 * instead of the `prd` label.
 */
export const SPEC_DISPATCH_EVENT_TYPE = "prd-sliceable";

export type GateOutcome = "dispatched";

/**
 * Labels the spec `sliceable`, then asks for the dispatch — unconditionally (#263).
 *
 * The label first, dispatch second: that order is the point. A spec carrying the label with no
 * sub-issues and no completed run behind it is a lost dispatch and is countable
 * (`watchdog/lost-dispatch.ts`); reversing the order would let a dispatch that failed to send leave
 * no trace at all.
 *
 * `count` is accepted rather than required: `spec.ts` still passes `gateCount`'s number through for
 * the log line it reports, and a caller holding one costs nothing to pass here, but nothing in this
 * function reads it — there is no threshold left to compare it against.
 *
 * The send goes through `shared/dispatch-request.ts`, which on a runner records it for the
 * `contents: write` job that can actually make the call: this function runs inside a job that spends
 * a model, and that job holds `contents: read` on ADR-0053's grounds, so the dispatch it used to make
 * itself 403'd every time (#181).
 */
export function applyGate(gh: GhExec, issueNumber: number, count?: number): GateOutcome {
  void count;

  gh(["issue", "edit", String(issueNumber), "--add-label", SLICEABLE_LABEL]);
  requestDispatch(gh, {
    event_type: SPEC_DISPATCH_EVENT_TYPE,
    client_payload: { issue: issueNumber },
  });

  return "dispatched";
}
