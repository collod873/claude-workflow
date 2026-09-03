export interface UnreachableFinding {
  number: number;
  title: string;
  blockedBy: number[];
}

export const FINDING_MARKER = "<!-- unreachable-slice -->";

export function signalTitle(): string {
  return "Unreachable slices: a blocker closed without delivering";
}

export function entryLine(entry: UnreachableFinding): string {
  const blockers = entry.blockedBy.map((number) => `#${number}`).join(", ");
  return `- [ ] #${entry.number} — ${entry.title}: behind ${blockers}, closed without delivering`;
}

export function signalBody(entries: UnreachableFinding[]): string {
  return [
    "An edge is satisfied when its blocker closed **having delivered** — closed as completed with a",
    "merged pull request. A blocker closed `not planned`, or closed with nothing merged, leaves its",
    "edge unsatisfied forever, so everything behind it is unreachable rather than late.",
    "",
    "Reported here as one standing count rather than left parked, because parked work is a queue",
    "that drains onto the owner —",
    "`docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md`.",
    "",
    "**Unreachable:**",
    "",
    ...entries.map(entryLine),
    "",
    "**To clear a line:** re-slice it, re-open the blocker and deliver it, or cut the edge.",
    "",
    FINDING_MARKER,
  ].join("\n");
}

export function commentBody(entries: UnreachableFinding[]): string {
  return `Also unreachable:\n\n${entries.map(entryLine).join("\n")}`;
}

export function retirementBody(): string {
  return [
    "## Closing record",
    "",
    "No diff.",
    "",
    "Nothing is unreachable. Every slice named above has since been re-sliced, had its blocker",
    "re-opened and delivered, or had its edge cut — so the standing count has nothing left to",
    "stand for.",
    "",
    "This closes the report, never the mechanism: the next slice to become unreachable opens a",
    "fresh one against the same marker.",
  ].join("\n");
}

export function alreadyNamed(text: string, number: number): boolean {
  return text.includes(`#${number} —`);
}
