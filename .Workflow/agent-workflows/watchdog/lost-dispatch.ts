/**
 * The judgement half of the lost-dispatch counter (#127, ADR-0062, ADR-0065): a pure function
 * over one PRD's already-fetched state, flagging a spec that carries `sliceable` with no
 * sub-issues and no completed slicing run — a `repository_dispatch` that never arrived.
 *
 * ADR-0062 rules `sliceable` a **durable trace rather than a trigger**: the job that judges a spec
 * ready applies the label and sends the dispatch in the same breath, so a PRD carrying the label
 * with nothing downstream of it is exactly the shape of a dispatch that was owed and never
 * arrived. Kept apart from the IO half (`./lost-dispatch-counter.ts`) so it can be run against
 * hand-built fixtures with no GitHub reachable — PRD #117's own point 40.
 *
 * **This is the absence one level further out than the run watchdog can see** (#41,
 * `./dead-lanes.ts`). That watchdog keys on a run that executed zero jobs — it reads runs. A
 * `repository_dispatch` that never arrived produces **no run at all**, so there is nothing for a
 * run-reading sweep to find; the only surviving trace is the label itself, crossed with what did
 * and didn't follow it.
 */

/**
 * One PRD as this module needs it, already resolved by the IO half: its sub-issue count from
 * `subIssuesPath`, and whether the slicing lane has produced a completed run since — see
 * `./lost-dispatch-counter.ts` for how each is read.
 */
export interface PrdCandidate {
  number: number;
  title: string;
  labels: string[];
  /** The count `subIssuesPath` returns. Zero is the trace `to-tickets.yml`'s own first refusal already treats as "not yet sliced". */
  subIssueCount: number;
  /** Whether the slicing lane has produced a completed run in the window the IO half checked. A run that completed and failed still counts here — a dispatch that arrived and broke is a different defect, not a lost one. */
  hasCompletedSlicingRun: boolean;
}

/** Whether `prd` is a lost dispatch: it carries `sliceable`, and neither a sub-issue nor a completed slicing run followed. */
export function isLostDispatch(prd: PrdCandidate): boolean {
  return prd.labels.includes("sliceable") && prd.subIssueCount === 0 && !prd.hasCompletedSlicingRun;
}

/** One lost-dispatch finding, as the signal needs it to name the PRD. */
export interface LostDispatchFinding {
  prdNumber: number;
  prdTitle: string;
}

export function finding(prd: PrdCandidate): LostDispatchFinding {
  return { prdNumber: prd.number, prdTitle: prd.title };
}

/**
 * A hidden marker naming the standing signal — one issue for every lost dispatch this counter
 * finds, not one per PRD (the shape #124's missing-trailer counter established for a `Count: 1`
 * counter: comment-or-create keyed on one shared marker, so a reader's tracker gains one issue
 * that grows rather than a fresh one per finding).
 */
export const FINDING_MARKER = "<!-- lost-dispatch -->";

/** The signal's title. Stable across runs so a reader recognises the standing issue. */
export function signalTitle(): string {
  return "Lost dispatch: a spec carrying `sliceable` never sliced";
}

/** One checklist line naming `finding`, used both in a fresh issue's body and in a comment onto the standing one. */
export function entryLine(entry: LostDispatchFinding): string {
  return `- [ ] #${entry.prdNumber} — ${entry.prdTitle}: carries \`sliceable\` with no sub-issues and no completed slicing run`;
}

/** The body for a newly opened standing issue, naming `entry` as its first finding. */
export function signalBody(entry: LostDispatchFinding): string {
  return [
    "A `repository_dispatch` that never arrived leaves no run for a run-reading sweep to find",
    "([#41](https://github.com/collod873/claude-workflow/issues/41) reads runs; this reads the",
    "label the dispatch should have followed —",
    "`docs/adr/0065-parity-and-correction-do-not-survive-their-own-history-so-se.md`).",
    "",
    "**Carrying `sliceable` with no sub-issues and no completed slicing run:**",
    "",
    entryLine(entry),
    "",
    "**To clear a line:** slice it by hand, or investigate why the dispatch never arrived.",
    "",
    FINDING_MARKER,
  ].join("\n");
}

/** The comment added to an already-standing issue when a further PRD is found lost. */
export function commentBody(entry: LostDispatchFinding): string {
  return `Also lost:\n\n${entryLine(entry)}`;
}
