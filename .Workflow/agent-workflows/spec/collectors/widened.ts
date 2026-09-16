import type { Tracker } from "../../shared/tracker";
import type { DecidedContext } from "../author-contract";

export function collectWidenedContext(tracker: Tracker, issueNumber: number): DecidedContext {
  return {
    ownerWords: tracker.issueBody(issueNumber),
    decisions: "",
    rulings: "",
    boundaries: "",
    openGuesses: "",
  };
}
