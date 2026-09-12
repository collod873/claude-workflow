import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "../shared/immutable-set";
import { gatesThisRun } from "./gate";

export const RED_RESULTS = ["failure", "cancelled"];

export interface RunEnding {
  eventAction: string;
  immutability: string;
  verify: string;
}

export function judgesPullRequest(eventAction: string): boolean {
  return eventAction === IMPLEMENTATION_PR_DISPATCH_ACTION;
}

export function signalsFixer(ending: RunEnding): boolean {
  if (!judgesPullRequest(ending.eventAction)) return false;
  return RED_RESULTS.includes(ending.immutability) || RED_RESULTS.includes(ending.verify);
}

export function signalsReview(ending: RunEnding): boolean {
  if (!judgesPullRequest(ending.eventAction)) return false;
  return gatesThisRun(ending.immutability) && ending.verify === "success";
}
