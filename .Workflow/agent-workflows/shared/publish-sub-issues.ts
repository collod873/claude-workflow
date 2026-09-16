import { fetchIssueId, type GhExec } from "./gh";
import { BY_HAND_LABEL, isByHandClaim } from "./immutable-set";
import { parseIssueNumber } from "./issue-url";
import type { Plan } from "./plan-schema";
import { renderBody } from "./render-body";
import { trackerGh } from "./tracker-gh";
import type { Tracker } from "./tracker";

export interface PublishedIssue {
  position: number;
  title: string;
  number: number;
  id: number;
}

export function publishSubIssues(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  const tracker = trackerGh(gh);
  return plan.map((slice, index) => {
    const body = renderBody(slice, prdNumber);
    const createArgs = ["issue", "create", "--title", slice.title, "--body", body];
    if (isByHandClaim(slice.filesClaimed)) createArgs.push("--label", BY_HAND_LABEL);
    const createOutput = gh(createArgs);
    const number = parseIssueNumber(createOutput, slice.title);
    const id = fetchIssueId(tracker, number);
    tracker.addSubIssue(prdNumber, id);
    return { position: index + 1, title: slice.title, number, id };
  });
}

export function wireBlockedByEdges(plan: Plan, published: PublishedIssue[], tracker: GhExec | Tracker): void {
  if (typeof tracker === "function") {
    throw new Error("wireBlockedByEdges needs a Tracker, not a raw GhExec; wrap it with trackerGh first");
  }
  plan.forEach((slice, index) => {
    const blocked = published[index];
    for (const dep of slice.dependsOn) {
      const blocker = published[dep - 1];
      tracker.addBlockedBy(blocked.number, blocker.id);
    }
  });
}

export function verifyBlockedByGraph(plan: Plan, published: PublishedIssue[], tracker: Tracker): void {
  plan.forEach((slice, index) => {
    if (slice.dependsOn.length === 0) {
      return;
    }
    const blocked = published[index];
    const actualBlockerIds = tracker.blockedByIds(blocked.number);
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
