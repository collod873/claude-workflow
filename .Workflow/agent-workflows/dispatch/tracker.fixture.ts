import type { GhExec } from "../shared/gh";
import { createFakeGh, type FakeDispatch } from "../shared/gh.fake";
import {
  blockedByPathMatcher,
  branchRefPathMatcher,
  comparePathMatcher,
  issueCommentPathMatcher,
  issueCommentsPathMatcher,
  issuePathMatcher,
  matchingRefsPath,
  subIssuesPathMatcher,
} from "../shared/gh-paths";
import { openIssuesAnswer, runListAnswer } from "../shared/gh-list-answers.fixture";
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
  fail?: "issues" | "refs" | "edges" | "runs" | "pulls";
}

function matchingRefsPrefix(path: string): string | undefined {
  for (const prefix of ["implement/", "accept/"]) {
    if (path === matchingRefsPath(prefix)) return prefix;
  }
  return undefined;
}

export function authoredOn(options: TrackerOptions, tickets: number[]): TrackerOptions {
  return {
    ...options,
    claimed: [...(options.claimed ?? []), ...tickets.map((ticket) => `accept/issue-${ticket}`)],
  };
}

export function issueIdOf(number: number): number {
  return number * 1000 + 7;
}

function issueNumberOf(id: number): number | undefined {
  const number = (id - 7) / 1000;
  return Number.isInteger(number) ? number : undefined;
}

export interface Tracker {
  gh: GhExec;
  calls: string[][];
  edges: Array<{ blocked: number; blockerId: number }>;
  dispatches: FakeDispatch[];
  comments: Array<{ issue: number; body: string }>;
  created: Array<{ title: string; body: string }>;
  closedByRun: Array<{ issue: number; reason: string }>;
  commentEdits: Array<{ id: number; body: string }>;
  labelsAdded: Array<{ issue: number; name: string }>;
  labelsRemoved: Array<{ issue: number; name: string }>;
  bodyEdits: Array<{ issue: number; body: string }>;
  released: string[];
}

function flagValues(args: string[], flag: string): string[] {
  return args.flatMap((arg, at) => (arg === flag && args[at + 1] !== undefined ? [args[at + 1]] : []));
}

export function trackerWith(options: TrackerOptions): Tracker {
  const calls: string[][] = [];
  const edges: Tracker["edges"] = [];
  const comments: Tracker["comments"] = [];
  const created: Tracker["created"] = [];
  const closedByRun: Tracker["closedByRun"] = [];
  const commentEdits: Tracker["commentEdits"] = [];
  const labelsAdded: Tracker["labelsAdded"] = [];
  const labelsRemoved: Tracker["labelsRemoved"] = [];
  const bodyEdits: Tracker["bodyEdits"] = [];
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
    const prefix = matchingRefsPrefix(path);
    if (prefix !== undefined) {
      if (options.fail === "refs") throw new Error("gh: 403");
      const under = (options.claimed ?? []).filter((branch) => branch.startsWith(prefix));
      return JSON.stringify(under.map((branch) => `refs/heads/${branch}`));
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
    const edge = blockedByPathMatcher.exec(path);
    if (edge) {
      if (options.fail === "edges") throw new Error("gh: 403");
      const blocked = Number(edge[1]);
      const field = flagValues(args, "-F").concat(flagValues(args, "-f")).find((value) => value.startsWith("issue_id="));
      if (field === undefined) return issueRefs(open.get(blocked)?.blockedBy ?? []);
      const blockerId = Number(field.slice("issue_id=".length));
      const blocker = issueNumberOf(blockerId);
      if (blocker === undefined || !open.has(blocker)) {
        throw new Error(`gh: Not Found (HTTP 404): issue_id=${blockerId} is no issue id this tracker knows`);
      }
      edges.push({ blocked, blockerId });
      const record = open.get(blocked);
      if (record) record.blockedBy = [...(record.blockedBy ?? []), blocker];
      return "";
    }
    const subIssues = subIssuesPathMatcher.exec(path);
    if (subIssues) return issueRefs(open.get(Number(subIssues[1]))?.children ?? []);
    const issue = issuePathMatcher.exec(path);
    if (issue && args[args.indexOf("--jq") + 1] === ".id") return `${issueIdOf(Number(issue[1]))}\n`;
    return undefined;
  };

  const answer = (args: string[]): string | undefined => {
    if (args[0] === "api") return answerApi(args);

    if (args[0] === "run" && args[1] === "list") {
      if (options.fail === "runs") throw new Error("gh: 403");
      return runListAnswer(runs);
    }
    if (args[0] === "run" && args[1] === "view") {
      return runs.find((run) => run.id === Number(args[2]))?.failedLog ?? "";
    }
    if (args[0] === "pr" && args[1] === "list") {
      if ((args[args.indexOf("--json") + 1] ?? "") === "headRefName") {
        if (options.fail === "pulls") throw new Error("gh: 403");
        return JSON.stringify((options.withPullRequest ?? []).map((headRefName) => ({ headRefName })));
      }
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
      return openIssuesAnswer(options.open, sliceBody);
    }
    if (args[0] === "issue" && args[1] === "view") {
      const number = Number(args[2]);
      if (args[args.indexOf("--json") + 1] === "labels") {
        return JSON.stringify({ labels: (open.get(number)?.labels ?? []).map((name) => ({ name })) });
      }
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
      const record = open.get(issue);
      for (const name of flagValues(args, "--remove-label")) {
        labelsRemoved.push({ issue, name });
        if (record) record.labels = (record.labels ?? []).filter((each) => each !== name);
      }
      for (const name of flagValues(args, "--add-label")) {
        labelsAdded.push({ issue, name });
        if (record && !(record.labels ?? []).includes(name)) record.labels = [...(record.labels ?? []), name];
      }
      for (const body of flagValues(args, "--body")) bodyEdits.push({ issue, body });
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

  return { gh, calls, edges, dispatches: sender.dispatches, comments, created, closedByRun, commentEdits, labelsAdded, labelsRemoved, bodyEdits, released };
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
