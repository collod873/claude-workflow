import type { Refutations, Sheet, ShaperSheet } from "../shared/sheet-schema";

export const DECISION_CAP = 5;

export const PRIOR_ART_CAP = 3;

export const SURVIVOR_CAP = 3;

export const CHANGE_REQUEST_CAP = 2;

export interface TooManyDecisions {
  count: number;
}

export function capDecisions(shaped: ShaperSheet): TooManyDecisions | undefined {
  return shaped.decisions.length > DECISION_CAP
    ? { count: shaped.decisions.length }
    : undefined;
}

export function marksForceLong(decisions: Sheet["decisions"]): boolean {
  const marked = decisions.filter((decision) => decision.mark !== "").length;
  return marked * 2 > decisions.length;
}

export function applyGrammar(shaped: ShaperSheet, refuted: Refutations, round: number): Sheet {
  const decisions = shaped.decisions.map((decision) => ({
    ...decision,
    mark: decision.mark.trim(),
    adrTitle: decision.adrTitle.trim(),
    adrReversal: decision.adrReversal.trim(),
  }));

  const forcedLong = marksForceLong(decisions);

  return {
    restatement: shaped.restatement,
    priorArt: shaped.priorArt.slice(0, PRIOR_ART_CAP),
    decisions,
    survivors: refuted.survivors.slice(0, SURVIVOR_CAP),
    route: forcedLong ? "long" : shaped.route,
    routeReason: forcedLong ? longByMarks(decisions) : shaped.routeReason,
    newTerms: shaped.newTerms,
    round,
  };
}

function longByMarks(decisions: Sheet["decisions"]): string {
  const marked = decisions.filter((decision) => decision.mark !== "").length;
  return `Long — ${marked} of ${decisions.length} decisions carry an assumption mark, which is more than half.`;
}
