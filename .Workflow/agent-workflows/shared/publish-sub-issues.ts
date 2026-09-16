import { fetchIssueId, type GhExec } from "./gh";
import { BY_HAND_LABEL, isByHandClaim } from "./immutable-set";
import type { Plan } from "./plan-schema";
import { renderBody } from "./render-body";
import type { CreateIssueInput, Tracker } from "./tracker";

export interface PublishedIssue {
  position: number;
  title: string;
  number: number;
  id: number;
}

export function publishSubIssues(plan: Plan, prdNumber: number, tracker: Tracker): PublishedIssue[] {
  return plan.map((slice, index) => {
    const body = renderBody(slice, prdNumber);
    const input: CreateIssueInput = { title: slice.title, body, assignee: "" };
    if (isByHandClaim(slice.filesClaimed)) input.label = BY_HAND_LABEL;
    const number = tracker.createIssue(input);
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
