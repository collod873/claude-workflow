import { requestDispatch } from "../shared/dispatch-request";
import type { GhExec } from "../shared/gh";

export interface MarkedDecision {
  mark: string;
  adrTitle: string;
}

export function unfiledMarks(decisions: MarkedDecision[], openQuestions: string[]): MarkedDecision[] {
  return decisions.filter(
    (decision) =>
      decision.mark !== "" &&
      decision.adrTitle === "" &&
      !openQuestions.some((question) => question.includes(decision.mark)),
  );
}

export function unfiledMarkGap(decisions: MarkedDecision[], openQuestions: string[]): number {
  return unfiledMarks(decisions, openQuestions).length;
}

export function gateCount(openQuestions: string[], decisions: MarkedDecision[] = []): number {
  return openQuestions.length + unfiledMarkGap(decisions, openQuestions);
}

export const SLICEABLE_LABEL = "sliceable";

export const SPEC_DISPATCH_EVENT_TYPE = "prd-sliceable";

export type GateOutcome = "dispatched";

export function applyGate(gh: GhExec, issueNumber: number, count?: number): GateOutcome {
  void count;

  gh(["issue", "edit", String(issueNumber), "--add-label", SLICEABLE_LABEL]);
  requestDispatch(gh, {
    event_type: SPEC_DISPATCH_EVENT_TYPE,
    client_payload: { issue: issueNumber },
  });

  return "dispatched";
}
