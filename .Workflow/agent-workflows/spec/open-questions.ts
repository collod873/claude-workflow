import { requestDispatch } from "../shared/dispatch-request";
import type { GhExec } from "../shared/gh";
import { markLane, QUESTIONS_OPEN_LABEL, readIssueLabels, SLICEABLE_LABEL, unlabel } from "../shared/labels";

export { SLICEABLE_LABEL };

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

export const SPEC_DISPATCH_EVENT_TYPE = "prd-sliceable";

export type GateOutcome = "dispatched";

export function applyGate(gh: GhExec, issueNumber: number, count = 0): GateOutcome {
  if (count > 0) markLane(gh, issueNumber, QUESTIONS_OPEN_LABEL);
  else if (readIssueLabels(gh, issueNumber).includes(QUESTIONS_OPEN_LABEL)) unlabel(gh, issueNumber, QUESTIONS_OPEN_LABEL);

  markLane(gh, issueNumber, SLICEABLE_LABEL);
  requestDispatch(gh, {
    event_type: SPEC_DISPATCH_EVENT_TYPE,
    client_payload: { issue: issueNumber },
  });

  return "dispatched";
}
