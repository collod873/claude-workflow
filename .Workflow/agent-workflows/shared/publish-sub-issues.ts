import type { GhExec } from "./gh";
import { blockedByPath, issuePath, subIssuesPath } from "./gh-paths";
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
  const raw = gh(["api", issuePath(number), "--jq", ".id"]);
  const id = Number(raw.trim());
  if (!Number.isInteger(id)) {
    throw new Error(`could not parse a numeric id for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return id;
}

/**
 * `-F`, not `-f`: both id-taking endpoints here want a JSON integer, and
 * `-f` is `gh`'s always-a-string flag. Sending `-f sub_issue_id=<n>` gets
 * `Invalid property /sub_issue_id: "<n>" is not of type integer` (HTTP 422)
 * — which is what killed to-tickets run 32679981039 after it had already
 * created the first issue.
 */
const ID_FIELD_FLAG = "-F";

function attachUnderPrd(gh: GhExec, prdNumber: number, childId: number): void {
  gh([
    "api",
    subIssuesPath(prdNumber),
    ID_FIELD_FLAG,
    `sub_issue_id=${childId}`,
  ]);
}

/**
 * Wires one native GitHub blocked-by edge for every `dependsOn` entry in the
 * plan: the issue published for each position becomes blocked by the
 * issue(s) published for the position(s) it depends on. `plan` and
 * `published` must be the same length, in the same order — exactly what
 * `publishSubIssues` returns for the plan it was given.
 */
export function wireBlockedByEdges(plan: Plan, published: PublishedIssue[], gh: GhExec): void {
  plan.forEach((slice, index) => {
    const blocked = published[index];
    for (const dep of slice.dependsOn) {
      const blocker = published[dep - 1];
      gh([
        "api",
        blockedByPath(blocked.number),
        ID_FIELD_FLAG,
        `issue_id=${blocker.id}`,
      ]);
    }
  });
}

/**
 * Fetches the blocked-by graph GitHub actually recorded, for every slice
 * that declared a `dependsOn`, and compares it against the graph the plan
 * intended. Throws naming the exact missing edge — which slice should be
 * blocked by which — the moment one is found, so a partial or dropped write
 * fails loudly instead of leaving a batch that looks fully wired.
 */
export function verifyBlockedByGraph(plan: Plan, published: PublishedIssue[], gh: GhExec): void {
  plan.forEach((slice, index) => {
    if (slice.dependsOn.length === 0) {
      return;
    }
    const blocked = published[index];
    const actualBlockerIds = fetchBlockedByIds(gh, blocked.number);
    for (const dep of slice.dependsOn) {
      const blocker = published[dep - 1];
      if (!actualBlockerIds.includes(blocker.id)) {
        throw new Error(
          `published graph is missing a blocked-by edge: slice ${blocked.position} ("${blocked.title}") ` +
            `should be blocked by slice ${blocker.position} ("${blocker.title}"), but the read-back for ` +
            `issue #${blocked.number} does not include it`,
        );
      }
    }
  });
}

function fetchBlockedByIds(gh: GhExec, number: number): number[] {
  const raw = gh([
    "api",
    blockedByPath(number),
    "--jq",
    "[.[].id]",
  ]);
  const parsed: unknown = JSON.parse(raw.trim());
  if (!Array.isArray(parsed) || !parsed.every((value) => Number.isInteger(value))) {
    throw new Error(`could not parse blocked-by ids for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return parsed as number[];
}
