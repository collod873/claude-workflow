/**
 * The reporting half of the unreachable-slice counter (#179,
 * [ADR-0011](../../../docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md),
 * [ADR-0064](../../../docs/adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)):
 * pure text, no IO, the same split `./lost-dispatch.ts` holds against `./lost-dispatch-counter.ts`.
 * `dispatch/reconcile.ts` is the IO half here.
 *
 * **An unsatisfiable edge is a refusal, not a park.** A blocker closed without delivering — closed
 * `not planned`, or closed as completed with nothing merged — or one whose pull request a fixer
 * abandoned after
 * [ADR-0041](../../../docs/adr/0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)'s
 * no-progress exit, does not make its dependents *late*. It makes them **unreachable**, and that is
 * knowable at the moment it happens rather than inferable never: the reconciler's walk already
 * computes it, from the other end.
 *
 * The prior art in the sandcastle repo leaves those dependents sitting in `agent:queued` forever and
 * its own ADR admits there is no sweeper. That is exactly the shape ADR-0011 forbids — *"parked work
 * is a queue that drains onto the owner — the one outcome the whole design is built to avoid."* One
 * bounded touch is the alternative, and it is what this files:
 *
 * - **Event:** a slice became unreachable.
 * - **Count:** how many, per run.
 * - **Action:** re-slice, re-open the blocker, or cut the edge.
 */

/** One unreachable slice, as the standing signal needs it named. */
export interface UnreachableFinding {
  number: number;
  title: string;
  /** The blocker(s) that closed without delivering, whether this slice's own or one further back. */
  blockedBy: number[];
}

/**
 * A hidden marker naming the standing signal — one issue for every unreachable slice this counter
 * ever finds, not one per slice. The shape #124's missing-trailer counter established and #127's
 * lost-dispatch counter followed: comment-or-create keyed on one shared marker, so a reader's
 * tracker gains one issue that grows rather than a fresh one per finding. Filing *n* issues for *n*
 * silently parked tickets would be the park with extra steps.
 */
export const FINDING_MARKER = "<!-- unreachable-slice -->";

/** The signal's title. Stable across runs so a reader recognises the standing issue. */
export function signalTitle(): string {
  return "Unreachable slices: a blocker closed without delivering";
}

/** One checklist line naming `entry`, used both in a fresh issue's body and in a comment onto the standing one. */
export function entryLine(entry: UnreachableFinding): string {
  const blockers = entry.blockedBy.map((number) => `#${number}`).join(", ");
  return `- [ ] #${entry.number} — ${entry.title}: behind ${blockers}, closed without delivering`;
}

/** The body for a newly opened standing issue, naming `entries` as its first findings. */
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

/** The comment added to an already-standing issue when further slices are found unreachable. */
export function commentBody(entries: UnreachableFinding[]): string {
  return `Also unreachable:\n\n${entries.map(entryLine).join("\n")}`;
}

/**
 * Whether `number` is already named on a standing issue's body or one of its comments — the same
 * derived-not-stored check `lost-dispatch-counter.ts` makes, and for the same reason: this counter
 * keeps no cursor and no ledger, so "have I said this already?" is answered from what it actually
 * said.
 */
export function alreadyNamed(text: string, number: number): boolean {
  return text.includes(`#${number} —`);
}
