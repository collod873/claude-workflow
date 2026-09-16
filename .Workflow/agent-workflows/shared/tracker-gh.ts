import { z } from "zod";
import type { GhExec } from "./gh";
import { blockedByPath, issueCommentsPath, issuePath, matchingRefsPath, runJobsPath, subIssuesPath, workflowRunsPath } from "./gh-paths";
import type { Tracker, TrackerBlocker, TrackerComment, TrackerRecordComment, WorkflowRun } from "./tracker";

const ApiRun = z.object({
  id: z.number(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  head_branch: z.string().nullable(),
  created_at: z.string(),
  event: z.string(),
});

const JobsResponse = z.object({
  jobs: z.array(
    z.object({
      steps: z.array(
        z.object({
          name: z.string(),
          conclusion: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const ApiBlocker = z.object({
  number: z.number(),
  state: z.string(),
  state_reason: z.string().nullable().optional(),
});

const ApiComment = z.object({ id: z.number(), body: z.string() });

const ApiRecordComment = z.object({
  body: z.string(),
  author_association: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});

const ApiRecordCommentPages = z.array(z.array(ApiRecordComment));

const ApiRefs = z.array(z.string());

const ClosingPrNumbers = z.array(z.number());

const MERGED = "MERGED";

function toWorkflowRun(run: z.infer<typeof ApiRun>): WorkflowRun {
  return {
    id: run.id,
    conclusion: run.conclusion ?? "",
    htmlUrl: run.html_url,
    headBranch: run.head_branch ?? "",
    createdAt: run.created_at,
    event: run.event,
  };
}

function toBlocker(blocker: z.infer<typeof ApiBlocker>): TrackerBlocker {
  return { number: blocker.number, state: blocker.state, stateReason: blocker.state_reason ?? null };
}

function toRecordComment(comment: z.infer<typeof ApiRecordComment>): TrackerRecordComment {
  return { body: comment.body, authorAssociation: comment.author_association, login: comment.user?.login ?? null };
}

function prIsMerged(gh: GhExec, pr: number): boolean {
  try {
    return gh(["pr", "view", String(pr), "--json", "state", "--jq", ".state"]).trim() === MERGED;
  } catch {
    return false;
  }
}

const ID_FIELD_FLAG = "-F";

function parsedId(raw: string, number: number): number {
  const id = Number(raw.trim());
  if (!Number.isInteger(id)) {
    throw new Error(`could not parse a numeric id for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return id;
}

function parsedIds(raw: string, number: number): number[] {
  const parsed: unknown = JSON.parse(raw.trim());
  if (!Array.isArray(parsed) || !parsed.every((value) => Number.isInteger(value))) {
    throw new Error(`could not parse blocked-by ids for issue #${number} from: ${JSON.stringify(raw)}`);
  }
  return parsed as number[];
}

export function trackerGh(gh: GhExec): Tracker {
  return {
    workflowRuns(workflow, perPage) {
      const projection = "[.workflow_runs[] | {id, conclusion, html_url, head_branch, created_at, event}]";
      const raw = gh(["api", workflowRunsPath(workflow, perPage), "--jq", projection]);
      return ApiRun.array()
        .parse(JSON.parse(raw))
        .map(toWorkflowRun);
    },
    jobs(runId) {
      const raw = gh(["api", runJobsPath(runId)]);
      return JobsResponse.parse(JSON.parse(raw)).jobs;
    },
    blockedBy(number) {
      const raw = gh(["api", blockedByPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
      return ApiBlocker.array()
        .parse(JSON.parse(raw))
        .map(toBlocker);
    },
    children(number) {
      const raw = gh(["api", subIssuesPath(number), "--jq", "[.[] | {number, state, state_reason}]"]);
      return ApiBlocker.array()
        .parse(JSON.parse(raw))
        .map(toBlocker);
    },
    comments(number): TrackerComment[] {
      const raw = gh(["api", issueCommentsPath(number)]);
      return ApiComment.array().parse(JSON.parse(raw));
    },
    recordComments(number) {
      const raw = gh(["api", issueCommentsPath(number), "--paginate", "--slurp"]);
      return ApiRecordCommentPages.parse(JSON.parse(raw))
        .flat()
        .map(toRecordComment);
    },
    branchesUnder(prefix) {
      const raw = gh(["api", matchingRefsPath(prefix), "--jq", "[.[].ref]"]);
      return ApiRefs.parse(JSON.parse(raw)).map((ref) => ref.replace(/^refs\/heads\//, ""));
    },
    mergedCloser(number) {
      let closers: number[];
      try {
        const raw = gh([
          "issue",
          "view",
          String(number),
          "--json",
          "closedByPullRequestsReferences",
          "--jq",
          "[.closedByPullRequestsReferences[].number]",
        ]);
        const parsed = ClosingPrNumbers.safeParse(JSON.parse(raw));
        if (!parsed.success) return undefined;
        closers = parsed.data;
      } catch {
        return undefined;
      }
      return closers.find((pr) => prIsMerged(gh, pr));
    },
    blockedByIds(number) {
      const raw = gh(["api", blockedByPath(number), "--jq", "[.[].id]"]);
      return parsedIds(raw, number);
    },
    issueId(number) {
      const raw = gh(["api", issuePath(number), "--jq", ".id"]);
      return parsedId(raw, number);
    },
    addSubIssue(parentNumber, childId) {
      gh(["api", subIssuesPath(parentNumber), ID_FIELD_FLAG, `sub_issue_id=${childId}`]);
    },
    addBlockedBy(number, blockerId) {
      gh(["api", blockedByPath(number), ID_FIELD_FLAG, `issue_id=${blockerId}`]);
    },
  };
}
