import { issueBody } from "../../shared/issue-body";
import type { GhExec } from "../../shared/gh";
import type { DecidedContext } from "../author-contract";

export function collectWidenedContext(gh: GhExec, issueNumber: number): DecidedContext {
  return {
    ownerWords: issueBody(gh, issueNumber),
    decisions: "",
    rulings: "",
    boundaries: "",
    openGuesses: "",
  };
}
