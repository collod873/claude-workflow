import type { GhExec } from "../shared/gh";

/**
 * The open-question gate: ADR-0061's numbered form and ADR-0062's arithmetic
 * for what it gates.
 *
 * ADR-0061 turns "a spec that ships with zero open questions is treated as
 * suspect — it guessed silently" into arithmetic for the one trigger that
 * carries assumption marks (the sheet): *the sheet's decisions carrying a
 * mark and no adrTitle, minus the open questions naming a mark, is zero.*
 * That is `unfiledMarkGap` below — an independent check run beside the plain
 * open-question count, because nothing else verifies the author actually
 * asked about every load-bearing guess it was handed rather than missing it.
 * The map and in-session triggers carry no marks, so this contributes
 * nothing for them (`decisions` defaults to `[]`, whose gap is always zero)
 * — "suspicion stays a heuristic there" (ADR-0061).
 *
 * ADR-0062: *the gate is a count. Zero unanswered open questions → the job
 * applies `sliceable` and sends a `repository_dispatch`.* `gateCount` folds
 * both numbers into the one count `spec.ts` decides on, and `applyGate` is
 * the side effect zero drives — the label written *before* the dispatch, so
 * a lost dispatch stays a detectable durable trace rather than a silent
 * stop (ADR-0062's "Why the trigger had to move" option analysis).
 */

/** The two fields of a sheet's `Decision` (`shape/sheet-schema.ts`) this arithmetic needs — nothing else. */
export interface MarkedDecision {
  mark: string;
  adrTitle: string;
}

/**
 * ADR-0061's arithmetic, spelled exactly as the ADR states it: the sheet's
 * decisions carrying a mark and no adrTitle, minus the open questions naming
 * a mark. Zero when every marked-and-unfiled decision was named by some open
 * question (or there is no such decision at all); positive when the author
 * let a load-bearing guess through with no ADR and no question naming it —
 * the silent-guess case ADR-0061 exists to catch.
 */
export function unfiledMarkGap(decisions: MarkedDecision[], openQuestions: string[]): number {
  const unfiled = decisions.filter((decision) => decision.mark !== "" && decision.adrTitle === "");
  const namingAMark = openQuestions.filter((question) =>
    decisions.some((decision) => decision.mark !== "" && question.includes(decision.mark)),
  );
  return unfiled.length - namingAMark.length;
}

/**
 * ADR-0062's gate: the total count of what still blocks a dispatch. Every
 * explicit open question the chain produced (ADR-0061's numbered form —
 * invented intent, a disputed ruling, or an unfiled mark the author already
 * surfaced) plus `unfiledMarkGap`'s count of any mark the author never
 * surfaced at all. Zero only when nothing is left open by either measure.
 *
 * `openQuestions` is the already-folded result `spec.ts` produces — the
 * author's own questions plus the critic's findings (ADR-0062: "the critic
 * runs in the same chain … its findings become more numbered open
 * questions"). This function never talks to the critic or the author
 * itself; it only counts what they already produced.
 */
export function gateCount(openQuestions: string[], decisions: MarkedDecision[] = []): number {
  return openQuestions.length + unfiledMarkGap(decisions, openQuestions);
}

/** ADR-0061's numbered form: open questions rendered `1.`, `2.`, … in the order they arrived. */
export function numberedOpenQuestions(openQuestions: string[]): string {
  return openQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n");
}

/** The label a zero gate count applies before it dispatches (ADR-0062). */
export const SLICEABLE_LABEL = "sliceable";

/**
 * The `repository_dispatch` action name a zero gate count sends — the wire
 * name lane 03's trigger reads for instead of the `prd` label (ADR-0062:
 * "Lane 03 fires on that dispatch, never on a label").
 */
export const SPEC_DISPATCH_EVENT_TYPE = "prd-sliceable";

export type GateOutcome = "dispatched" | "held";

/**
 * Carries out what `gateCount` decided.
 *
 * At zero: labels the spec `sliceable` and *then* sends the dispatch — that
 * order is the point. ADR-0062 rules `sliceable` written before the
 * dispatch the durable trace that one was owed, so a spec carrying the label
 * with no sub-issues and no completed run is a lost dispatch and is
 * countable (`watchdog/lost-dispatch.ts`); reversing the order would let a
 * dispatch that failed to send leave no trace at all.
 *
 * At any other count: does nothing. ADR-0062 rules `sliceable` applied by a
 * job inert on its own — nothing here writes anything about a held spec.
 * Getting the open questions in front of the owner is `rounds.ts`'s job, not
 * this one's.
 */
export function applyGate(gh: GhExec, issueNumber: number, count: number): GateOutcome {
  if (count !== 0) return "held";

  gh(["issue", "edit", String(issueNumber), "--add-label", SLICEABLE_LABEL]);
  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${SPEC_DISPATCH_EVENT_TYPE}`,
    "-f",
    `client_payload[issue]=${issueNumber}`,
  ]);

  return "dispatched";
}
