import type { Refutations, Sheet, ShaperSheet } from "./sheet-schema";

/**
 * The sheet's grammar: the caps, the mark strip, and the route override.
 *
 * Everything here runs on the shaper's output *after* it has parsed and
 * before anything is posted, and none of it asks a model anything. That is
 * the point — `DESIGN.md` §01 and §01a hang three mechanical outcomes off the
 * sheet's own shape (a strip, a route, a refusal), and a mechanism that reads
 * its own inputs by judgement can be talked past.
 */

/** §01: five decisions, and the cap is a refusal rather than a cut. See `capDecisions`. */
export const DECISION_CAP = 5;

/** §01: three prior-art lines. `none found` is a legal line; a fourth link is not. */
export const PRIOR_ART_CAP = 3;

/** §01: three lines of surviving refutations, and **absent** rather than `none` when there are none. */
export const SURVIVOR_CAP = 3;

/**
 * §01: *a comment — a change request — re-runs the shaper, capped at 2
 * rounds, then it posts as-is and only `approved` / `parked` / `killed`
 * remain.* Round 0 is the first sheet, so three sheets is the ceiling.
 */
export const CHANGE_REQUEST_CAP = 2;

/**
 * The shaper refused to shape.
 * [ADR-0029](../../../docs/adr/0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md):
 * the five-decision cap is what refuses; there is no second number.
 */
export interface TooManyDecisions {
  count: number;
}

/**
 * §01's *"needs a live session"*, derived rather than declared.
 *
 * This is the one cap that does not cut. Truncating a seven-decision tree to
 * five would post a sheet that looks like every other sheet and hide the only
 * evidence that the idea does not close — which is the signal ADR-0029 spends
 * the cap to raise. So the overflow is returned and the caller refuses with
 * it; every *other* section is cut, per §01's *cut, never appended*.
 */
export function capDecisions(shaped: ShaperSheet): TooManyDecisions | undefined {
  return shaped.decisions.length > DECISION_CAP
    ? { count: shaped.decisions.length }
    : undefined;
}

/**
 * Whether more than half the decisions carry a mark, which sends the item
 * long regardless of what the shaper recommended (§01a, ADR-0029).
 *
 * A fraction rather than a flat count because a flat 3 waves through a
 * two-decision sheet with both marked, which is plainly an idea nobody
 * understands. Run against **stripped** marks — a malformed mark is not a
 * mark, so it cannot vote (ADR-0028).
 */
export function marksForceLong(decisions: Sheet["decisions"]): boolean {
  const marked = decisions.filter((decision) => decision.mark !== "").length;
  return marked * 2 > decisions.length;
}

/**
 * Applies the grammar to a shaped sheet and the refuter's verdict, producing
 * the sheet as it will be posted and read back.
 *
 * Three things happen, in this order:
 *
 * 1. **Marks are stripped.** ADR-0028: a mark that names nothing is
 *    malformed. Whitespace-only counts as naming nothing, which is what makes
 *    the check need no judgement at check time.
 * 2. **The route is overridden, one way only.** The shaper recommends
 *    (ADR-0007); `> half marked` promotes that recommendation to `long`
 *    (ADR-0029). Nothing here ever demotes a `long` to `short` — ADR-0007 is
 *    explicit that the two misroutes are not symmetric, and the mechanism
 *    holding that line only ever pushes one way.
 * 3. **The remaining sections are cut to their caps.** Never appended, never
 *    summarised; §01 funds a phone screen and the overflow is not the
 *    owner's problem.
 */
export function applyGrammar(shaped: ShaperSheet, refuted: Refutations, round: number): Sheet {
  const decisions = shaped.decisions.map((decision) => ({
    ...decision,
    mark: decision.mark.trim(),
    adrTitle: decision.adrTitle.trim(),
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

/** The Route line when the marks overrode the shaper, so the sheet says why it was overridden. */
function longByMarks(decisions: Sheet["decisions"]): string {
  const marked = decisions.filter((decision) => decision.mark !== "").length;
  return `Long — ${marked} of ${decisions.length} decisions carry an assumption mark, which is more than half.`;
}
