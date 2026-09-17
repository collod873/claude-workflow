import type { GhExec } from "../shared/gh";
import { createFakeGh, type FakeDispatch } from "../shared/gh.fake";
import { openIssuesAnswer, runListAnswer } from "../shared/gh-list-answers.fixture";
import { scratchDir } from "../shared/scratch.fixture";
import type { TrackerBlocker, TrackerComment } from "../shared/tracker";
import { trackerMemory } from "../shared/tracker-memory";
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
  runs?: FakeRun[];
  standing?: { number: number; body: string; comments?: string[] };
  fail?: "issues" | "refs" | "edges" | "runs" | "pulls";
}

export function authoredOn(options: TrackerOptions, tickets: number[]): TrackerOptions {
  return { ...options, claimed: [...(options.claimed ?? []), ...tickets.map((ticket) => `accept/issue-${ticket}`)] };
}

export interface Tracker {
  gh: GhExec;
  tracker: ReturnType<typeof trackerMemory>;
  calls: string[][];
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

const closingPrFor = (issue: number) => issue * 10 + 4;
const closerOwner = (pr: number) => (pr - 4) / 10;

function flagValues(args: string[], flag: string): string[] {
  return args.flatMap((arg, at) => (arg === flag && args[at + 1] !== undefined ? [args[at + 1]] : []));
}

export function trackerWith(options: TrackerOptions): Tracker {
  const calls: string[][] = [];
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

  const blockerRef = (number: number): TrackerBlocker => {
    const record = closed.get(number);
    return record ? { number, state: "closed", stateReason: record.stateReason } : { number, state: "open", stateReason: null };
  };

  const blockers: Record<number, TrackerBlocker[]> = {};
  const children: Record<number, TrackerBlocker[]> = {};
  const seededComments: Record<number, TrackerComment[]> = {};
  const mergedClosers: Record<number, number> = {};
  for (const issue of options.open) {
    blockers[issue.number] = (issue.blockedBy ?? []).map(blockerRef);
    children[issue.number] = (issue.children ?? []).map(blockerRef);
    seededComments[issue.number] = (issue.comments ?? []).map((body, index) => ({ id: issue.number * 1000 + index, body }));
    if (issue.mergedCloser) mergedClosers[issue.number] = closingPrFor(issue.number);
  }
  for (const record of options.closed ?? []) {
    if (record.merged) mergedClosers[record.number] = closingPrFor(record.number);
  }

  const base = trackerMemory({
    blockers,
    children,
    comments: seededComments,
    branches: options.claimed ?? [],
    mergedClosers,
  });

  const tracker: ReturnType<typeof trackerMemory> = {
    ...base,
    blockedBy(number) {
      if (options.fail === "edges") throw new Error("gh: 403");
      return base.blockedBy(number);
    },
    branchesUnder(prefix) {
      if (options.fail === "refs") throw new Error("gh: 403");
      return base.branchesUnder(prefix);
    },
    updateComment(id, body) {
      commentEdits.push({ id, body });
    },
  };

  const sender = createFakeGh();

  const answer = (args: string[]): string | undefined => {
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
    if (args[0] === "pr" && args[1] === "list") {
      if (options.fail === "pulls") throw new Error("gh: 403");
      return JSON.stringify((options.withPullRequest ?? []).map((headRefName) => ({ headRefName })));
    }
    if (args[0] === "pr" && args[1] === "view") {
      const ownerNumber = closerOwner(Number(args[2]));
      const record: Partial<FakeClosed> | undefined =
        closed.get(ownerNumber) ?? (open.get(ownerNumber)?.mergedCloser ? { merged: true } : undefined);
      return JSON.stringify({
        mergedAt: record?.merged ? (record.mergedAt ?? null) : null,
        mergeCommit: record?.merged && record.mergeSha ? { oid: record.mergeSha } : null,
      });
    }
    if (args[0] === "run" && args[1] === "list") {
      if (options.fail === "runs") throw new Error("gh: 403");
      return runListAnswer(runs);
    }
    if (args[0] === "run" && args[1] === "view") {
      return runs.find((run) => run.id === Number(args[2]))?.failedLog ?? "";
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

  const gh: GhExec = (args) => {
    calls.push([...args]);
    return answer(args) ?? sender.gh(args);
  };

  return {
    gh,
    tracker,
    calls,
    dispatches: sender.dispatches,
    comments,
    created,
    closedByRun,
    commentEdits,
    labelsAdded,
    labelsRemoved,
    bodyEdits,
    released,
  };
}

const silent = () => {};

export function reconcileOver(tracker: Tracker, input: Partial<ReconcileInput> = {}): ReconcileOutcome {
  return runReconcile({
    gh: tracker.gh,
    tracker: tracker.tracker,
    log: silent,
    targetWorkspace: scratchDir("reconcile-target"),
    ...input,
  });
}

export function startedIssues(tracker: Tracker): number[] {
  return tracker.dispatches.map((dispatch) => Number(dispatch.payload.issue));
}

export function commentsCarrying(tracker: Tracker, marker: string): string[] {
  return [...tracker.comments.map((entry) => entry.body), ...tracker.commentEdits.map((entry) => entry.body)].filter(
    (body) => body.includes(marker),
  );
}
