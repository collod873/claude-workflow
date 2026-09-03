import type { GhExec } from "./gh";
import { blockedByPath, issuePath, subIssuesPath } from "./gh-paths";
import { parseIssueNumber } from "./issue-url";
import type { Plan } from "./plan-schema";
import { renderBody } from "./render-body";

export interface PublishedIssue {
  position: number;
  title: string;
  number: number;
  id: number;
}

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

function fetchIssueId(gh: GhExec, number: number): number {
  const raw = gh(["api", issuePath(number), "--jq", ".id"]);
  const id = Number(raw.trim());
  if (!Number.isInteger(id)) {
    throw new Error(`could not parse a numeric id for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return id;
}

const ID_FIELD_FLAG = "-F";

function attachUnderPrd(gh: GhExec, prdNumber: number, childId: number): void {
  gh([
    "api",
    subIssuesPath(prdNumber),
    ID_FIELD_FLAG,
    `sub_issue_id=${childId}`,
  ]);
}

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
