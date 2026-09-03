import { issueComments, type GhExec } from "../shared/gh";
import { isAccepted, isRefusal, readSheetMarker } from "../shared/marker";
import type { Sheet } from "../shared/sheet-schema";
import { CHANGE_REQUEST_CAP } from "./sheet";

export interface Round {
  round: number;
  refusalApplies: boolean;
  capped: boolean;
  latestSheet?: Sheet;
  accepted: boolean;
}

export function roundFor(gh: GhExec, issueNumber: number): Round {
  const bodies = issueComments(gh, issueNumber);

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

export function cappedComment(): string {
  return `**Change requests are spent.** ${CHANGE_REQUEST_CAP} re-runs is the cap, so the sheet above stands as posted.

\`approved\`, \`parked\` or \`killed\` are what remain.`;
}
