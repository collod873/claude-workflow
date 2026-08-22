import type { GhExec } from "./gh";
import type { Plan } from "./plan-schema";
import { renderBody } from "./render-body";

/** One slice's published issue: its position in the plan, and the numbers
 * later stages (wiring blocked-by edges, verifying read-back) key off. */
export interface PublishedIssue {
  /** 1-based position in the plan this issue was created from. */
  position: number;
  title: string;
  /** The issue number (`#<n>`), as GitHub's UI and `gh` both show it. */
  number: number;
  /** The issue's REST numeric id — what the sub-issues and dependencies
   * APIs key on, distinct from its number. */
  id: number;
}

const ISSUE_URL_RE = /\/issues\/(\d+)\s*$/;

/**
 * Creates one GitHub issue per slice and attaches each under the PRD as a
 * native sub-issue. Called only once the plan has passed `validatePlan` —
 * every call here is a real `gh` write, so nothing upstream may reach this
 * with an unvalidated plan.
 */
export function publishSubIssues(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  return plan.map((slice, index) => {
    const body = renderBody(slice, prdNumber);
    const createOutput = gh(["issue", "create", "--title", slice.title, "--body", body]);
    const number = parseIssueNumber(createOutput, slice.title);
    const id = fetchIssueId(gh, number);
    attachUnderPrd(gh, prdNumber, id);
    return { position: index + 1, title: slice.title, number, id };
  });
}

function parseIssueNumber(createOutput: string, title: string): number {
  const match = createOutput.trim().match(ISSUE_URL_RE);
  if (!match) {
    throw new Error(
      `could not parse an issue number from "gh issue create" output for "${title}": ${JSON.stringify(createOutput)}`,
    );
  }
  return Number(match[1]);
}

function fetchIssueId(gh: GhExec, number: number): number {
  const raw = gh(["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", ".id"]);
  const id = Number(raw.trim());
  if (!Number.isInteger(id)) {
    throw new Error(`could not parse a numeric id for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return id;
}

function attachUnderPrd(gh: GhExec, prdNumber: number, childId: number): void {
  gh([
    "api",
    `repos/{owner}/{repo}/issues/${prdNumber}/sub_issues`,
    "-f",
    `sub_issue_id=${childId}`,
  ]);
}
