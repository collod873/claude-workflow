import type { GhExec } from "../shared/gh";
import { createFakeGh, type FakeDispatch } from "../shared/gh.fake";
import {
  blockedByPathMatcher,
  branchRefPathMatcher,
  comparePathMatcher,
  issueCommentPathMatcher,
  issueCommentsPathMatcher,
  matchingRefsPath,
  subIssuesPathMatcher,
} from "../shared/gh-paths";
import { scratchDir } from "../shared/scratch.fixture";
import { runReconcile, type ReconcileInput, type ReconcileOutcome } from "./reconcile";

/**
 * @fixture Reached only from this lane's tests, by design.
 */

export function sliceBody(prd = 145): string {
  return `## Parent PRD\n#${prd}\n\n## What to build\nSomething.\n`;
}

export const HAND_WRITTEN_TICKET = [
  "## What to build",
  "",
  "Something the owner could already write in full.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] `make gate` exits 0 — check: `make gate`",
  "",
  "## Files claimed",
  "",
  "- None — no files.",
  "",
].join("\n");

export const RUNNABLE_BODY = [
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
  "",
].join("\n");

export interface FakeIssue {
  number: number;
  title: string;
  body?: string;
  blockedBy?: number[];
  labels?: string[];
  comments?: string[];
  children?: number[];
  mergedCloser?: boolean;
}

export interface FakeClosed {
  number: number;
  stateReason: "completed" | "not_planned";
  merged?: boolean;
  mergedAt?: string;
  mergeSha?: string;
}

export function delivered(number: number, mergedAt: string, mergeSha: string): FakeClosed {
  return { number, stateReason: "completed", merged: true, mergedAt, mergeSha };
}

const closingPrFor = (issue: number) => issue * 10 + 4;
const closerOwner = (pr: number) => (pr - 4) / 10;

export interface FakeRun {
  id: number;
  title: string;
  status?: "completed" | "in_progress" | "queued";
  conclusion?: "success" | "failure" | "cancelled" | "timed_out";
  failedLog?: string;
}

export function deadRun(id: number, ticket: number, failedLog?: string, conclusion: FakeRun["conclusion"] = "failure"): FakeRun {
  return failedLog === undefined
    ? { id, title: `Implement #${ticket}`, conclusion }
    : { id, title: `Implement #${ticket}`, conclusion, failedLog };
}

export function liveRun(id: number, title: string): FakeRun {
  return { id, title, status: "in_progress" };
}

export interface TrackerOptions {
  open: FakeIssue[];
  closed?: FakeClosed[];
  claimed?: string[];
  withPullRequest?: string[];
  withCommits?: string[];
  runs?: FakeRun[];
  standing?: { number: number; body: string; comments?: string[] };
  fail?: "issues" | "refs" | "edges" | "runs";
}

export interface Tracker {
  gh: GhExec;
  calls: string[][];
  dispatches: FakeDispatch[];
  comments: Array<{ issue: number; body: string }>;
  created: Array<{ title: string; body: string }>;
  closedByRun: Array<{ issue: number; reason: string }>;
  commentEdits: Array<{ id: number; body: string }>;
  labelsAdded: Array<{ issue: number; name: string }>;
  labelsRemoved: Array<{ issue: number; name: string }>;
  released: string[];
}

export function trackerWith(options: TrackerOptions): Tracker {
  const calls: string[][] = [];
  const comments: Tracker["comments"] = [];
  const created: Tracker["created"] = [];
  const closedByRun: Tracker["closedByRun"] = [];
  const commentEdits: Tracker["commentEdits"] = [];
  const labelsAdded: Tracker["labelsAdded"] = [];
  const labelsRemoved: Tracker["labelsRemoved"] = [];
  const released: string[] = [];
  const closed = new Map((options.closed ?? []).map((issue) => [issue.number, issue]));
  const open = new Map(options.open.map((issue) => [issue.number, issue]));
  const runs = options.runs ?? [];

  const issueRefs = (numbers: number[]): string =>
    JSON.stringify(
      numbers.map((number) => {
        const record = closed.get(number);
        return record
          ? { number, state: "closed", state_reason: record.stateReason }
          : { number, state: "open", state_reason: null };
      }),
    );

  const answerApi = (args: string[]): string | undefined => {
    const path = args[1] ?? "";
    if (path === matchingRefsPath("implement/")) {
      if (options.fail === "refs") throw new Error("gh: 403");
      return JSON.stringify((options.claimed ?? []).map((branch) => `refs/heads/${branch}`));
    }
    const compared = comparePathMatcher.exec(path)?.[2];
    if (compared !== undefined) {
      return JSON.stringify({ ahead_by: (options.withCommits ?? []).includes(compared) ? 1 : 0 });
    }
    const deleted = args[1] === "--method" && args[2] === "DELETE" ? branchRefPathMatcher.exec(args[3] ?? "")?.[1] : undefined;
    if (deleted !== undefined) {
      released.push(deleted);
      return "";
    }
    const commentPatch = issueCommentPathMatcher.exec(path);
    if (commentPatch) {
      const body = args[args.indexOf("-f") + 1]?.replace(/^body=/, "") ?? "";
      commentEdits.push({ id: Number(commentPatch[1]), body });
      return "{}";
    }
    const commentsList = issueCommentsPathMatcher.exec(path);
    if (commentsList) {
      const bodies = open.get(Number(commentsList[1]))?.comments ?? [];
      return JSON.stringify(bodies.map((body, index) => ({ id: Number(commentsList[1]) * 1000 + index, body })));
    }
    const edges = blockedByPathMatcher.exec(path);
    if (edges) {
      if (options.fail === "edges") throw new Error("gh: 403");
      return issueRefs(open.get(Number(edges[1]))?.blockedBy ?? []);
    }
    const subIssues = subIssuesPathMatcher.exec(path);
    if (subIssues) return issueRefs(open.get(Number(subIssues[1]))?.children ?? []);
    return undefined;
  };

  const answer = (args: string[]): string | undefined => {
    if (args[0] === "api") return answerApi(args);

    if (args[0] === "run" && args[1] === "list") {
      if (options.fail === "runs") throw new Error("gh: 403");
      return JSON.stringify(
        runs.map((run) => ({
          databaseId: run.id,
          displayTitle: run.title,
          status: run.status ?? "completed",
          conclusion: run.status === undefined || run.status === "completed" ? (run.conclusion ?? "success") : null,
          url: `https://github.com/owner/repo/actions/runs/${run.id}`,
        })),
      );
    }
    if (args[0] === "run" && args[1] === "view") {
      return runs.find((run) => run.id === Number(args[2]))?.failedLog ?? "";
    }
    if (args[0] === "pr" && args[1] === "list") {
      const head = args[args.indexOf("--head") + 1];
      return JSON.stringify((options.withPullRequest ?? []).includes(head) ? [{ number: 1 }] : []);
    }

    if (args[0] === "issue" && args[1] === "list") {
      const fields = args[args.indexOf("--json") + 1] ?? "";
      if (fields.includes("comments")) {
        const standing = options.standing;
        return JSON.stringify(
          standing
            ? [{ number: standing.number, body: standing.body, comments: (standing.comments ?? []).map((body) => ({ body })) }]
            : [],
        );
      }
      if (options.fail === "issues") throw new Error("gh: 403");
      return JSON.stringify(
        options.open.map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? sliceBody(),
          labels: (issue.labels ?? []).map((name) => ({ name })),
        })),
      );
    }
    if (args[0] === "issue" && args[1] === "view") {
      const number = Number(args[2]);
      const closes = closed.has(number) || open.get(number)?.mergedCloser === true;
      return JSON.stringify(closes ? [closingPrFor(number)] : []);
    }
    if (args[0] === "pr" && args[1] === "view") {
      const owner = closerOwner(Number(args[2]));
      const record: Partial<FakeClosed> | undefined =
        closed.get(owner) ?? (open.get(owner)?.mergedCloser ? { merged: true } : undefined);
      if (args.includes("--jq")) return `${record?.merged ? "MERGED" : "CLOSED"}\n`;
      return JSON.stringify({
        mergedAt: record?.merged ? (record.mergedAt ?? null) : null,
        mergeCommit: record?.merged && record.mergeSha ? { oid: record.mergeSha } : null,
      });
    }
    if (args[0] === "issue" && args[1] === "comment") {
      comments.push({ issue: Number(args[2]), body: args[args.indexOf("--body") + 1] });
      return "";
    }
    if (args[0] === "issue" && args[1] === "close") {
      closedByRun.push({ issue: Number(args[2]), reason: args[args.indexOf("--reason") + 1] });
      return "";
    }
    if (args[0] === "issue" && args[1] === "edit") {
      const issue = Number(args[2]);
      if (args.includes("--add-label")) labelsAdded.push({ issue, name: args[args.indexOf("--add-label") + 1] });
      if (args.includes("--remove-label")) labelsRemoved.push({ issue, name: args[args.indexOf("--remove-label") + 1] });
      return "";
    }
    if (args[0] === "issue" && args[1] === "create") {
      created.push({ title: args[args.indexOf("--title") + 1], body: args[args.indexOf("--body") + 1] });
      return "https://github.com/owner/repo/issues/500\n";
    }
    if (args[0] === "label") return "";
    return undefined;
  };

  const sender = createFakeGh();
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return answer(args) ?? sender.gh(args);
  };

  return { gh, calls, dispatches: sender.dispatches, comments, created, closedByRun, commentEdits, labelsAdded, labelsRemoved, released };
}

export const silent = () => {};

export function reconcileOver(tracker: Tracker, input: Partial<ReconcileInput> = {}): ReconcileOutcome {
  return runReconcile({ gh: tracker.gh, log: silent, targetWorkspace: scratchDir("reconcile-target"), ...input });
}

export function startedIssues(tracker: Tracker): number[] {
  return tracker.dispatches.map((dispatch) => Number(dispatch.payload.issue));
}

export function commentsCarrying(tracker: Tracker, marker: string): string[] {
  return [...tracker.comments.map((entry) => entry.body), ...tracker.commentEdits.map((entry) => entry.body)].filter(
    (body) => body.includes(marker),
  );
}
