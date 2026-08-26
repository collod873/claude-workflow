import type { GhExec } from "../shared/gh";
import { isAccepted, isRefusal, readSheetMarker } from "./marker";
import type { Sheet } from "./sheet-schema";
import { CHANGE_REQUEST_CAP } from "./sheet";

/**
 * How many times this lane has already spoken on an idea, read back off the
 * issue.
 *
 * §1's substrate rule: *if a fact is not in a committed file or a GitHub
 * object, it does not exist. No agent may remember anything.* The round
 * number is a fact about a work item, so it is recomputed from the comment
 * list on every run rather than stored anywhere — which also means it cannot
 * go stale, the property §6 credits for making a count free.
 */

/** One comment as `gh issue view --json comments` returns it. */
interface RawComment {
  body?: string;
}

function readComments(gh: GhExec, issueNumber: number): string[] {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  return (parsed.comments ?? []).map((comment) => comment.body ?? "");
}

export interface Round {
  /** 0 for the first run on an idea, then one per change request. */
  round: number;
  /**
   * Whether stage 1's refusal may fire on this run.
   *
   * Only on round 0. From round 1 the owner has read the refusal's evidence
   * and commented anyway, and re-refusing on the same prior art would park
   * the idea forever — the shape
   * [ADR-0011](../../../docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md)
   * rules against. The comment *is* what clears it.
   */
  refusalApplies: boolean;
  /**
   * Whether the change-request budget is spent. §01: capped at 2 rounds,
   * *then it posts as-is and only `approved` / `parked` / `killed` remain* —
   * uncapped is the fixer mistake in a new place.
   */
  capped: boolean;
  /** The most recent sheet posted, if any — what the accept and the counter read. */
  latestSheet?: Sheet;
  /**
   * Whether an accept has already run on this idea. A label can be removed and
   * re-applied, and each application is a fresh event, so without this a second
   * `approved` files every ruling on the sheet again under new numbers.
   */
  accepted: boolean;
}

/** Reads the issue and works out where this run sits. */
export function roundFor(gh: GhExec, issueNumber: number): Round {
  const bodies = readComments(gh, issueNumber);

  const sheets = bodies.map(readSheetMarker).filter((sheet): sheet is Sheet => sheet !== undefined);
  const spoken = sheets.length + bodies.filter(isRefusal).length;

  return {
    round: spoken,
    refusalApplies: spoken === 0,
    capped: spoken > CHANGE_REQUEST_CAP,
    latestSheet: sheets.at(-1),
    accepted: bodies.some(isAccepted),
  };
}

/** The comment posted when a change request arrives with the budget already spent. */
export function cappedComment(): string {
  return `**Change requests are spent.** ${CHANGE_REQUEST_CAP} re-runs is the cap, so the sheet above stands as posted.

\`approved\`, \`parked\` or \`killed\` are what remain.`;
}
