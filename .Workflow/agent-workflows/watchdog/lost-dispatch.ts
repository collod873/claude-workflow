export interface PrdCandidate {
  number: number;
  title: string;
  labels: string[];
  subIssueCount: number;
  hasCompletedSlicingRun: boolean;
}

export function isLostDispatch(prd: PrdCandidate): boolean {
  return prd.labels.includes("sliceable") && prd.subIssueCount === 0 && !prd.hasCompletedSlicingRun;
}

export interface LostDispatchFinding {
  prdNumber: number;
  prdTitle: string;
}

export function finding(prd: PrdCandidate): LostDispatchFinding {
  return { prdNumber: prd.number, prdTitle: prd.title };
}

export const FINDING_MARKER = "<!-- lost-dispatch -->";

export function signalTitle(): string {
  return "Lost dispatch: a spec carrying `sliceable` never sliced";
}

export function entryLine(entry: LostDispatchFinding): string {
  return `- [ ] #${entry.prdNumber} — ${entry.prdTitle}: carries \`sliceable\` with no sub-issues and no completed slicing run`;
}

export function signalBody(entry: LostDispatchFinding): string {
  return [
    "A `repository_dispatch` that never arrived leaves no run for a run-reading sweep to find",
    "([#41](https://github.com/collod873/claude-workflow/issues/41) reads runs; this reads the",
    "label the dispatch should have followed:",
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

export function commentBody(entry: LostDispatchFinding): string {
  return `Also lost:\n\n${entryLine(entry)}`;
}
