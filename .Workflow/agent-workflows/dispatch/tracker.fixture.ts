import type { GhExec } from "../shared/gh";
import { createFakeGh, type FakeDispatch } from "../shared/gh.fake";
import {
  blockedByPathMatcher,
  issueCommentPathMatcher,
  issueCommentsPathMatcher,
  matchingRefsPath,
  subIssuesPathMatcher,
} from "../shared/gh-paths";
import { scratchDir } from "../shared/scratch.fixture";
import { runReconcile, type ReconcileInput, type ReconcileOutcome } from "./reconcile";

/**
 * The tracker lane 09 reasons over, in memory: open issues with their blocked-by edges, labels,
 * comments and sub-issues; closed issues with how they closed and what merged them; the claim refs
 * implementers hold; and the standing unreachable report, if one is up.
 *
 * `trackerWith` answers every read `reconcile.ts` makes the way GitHub answers it — the delivery
 * question in particular takes the two calls it really takes (`issue view` for the closing PR's
 * *number*, `pr view` for its state), never a state served straight off the issue (ADR-0106) —
 * and records every write. It is composed in front of `createFakeGh`, which records the
 * `repository_dispatch` sends as `FakeDispatch`es and throws on anything neither side models.
 *
 * @fixture Reached only from this lane's tests, by design.
 */

/** A published slice's body — `render-body.ts` writes this heading and nothing else does. */
export function sliceBody(prd = 145): string {
  return `## Parent PRD\n#${prd}\n\n## What to build\nSomething.\n`;
}

/**
 * A ticket the owner wrote in a session: both headings lane 06 needs and no `## Parent PRD`
 * anywhere on it, which is the whole point — the second door admits work no slicer ever produced.
 */
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

/** A runnable spec body: one criterion, one well-formed `check:` marker. */
export const RUNNABLE_BODY = [
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
  "",
].join("\n");

export interface FakeIssue {
  number: number;
  title: string;
  /** Defaults to a published-slice body; pass a bare string for a hand-written issue. */
  body?: string;
  blockedBy?: number[];
  /** Label names, as `prd` and `needs-human` are spelled on the tracker. */
  labels?: string[];
  /** Comment bodies already standing on the issue, oldest first. */
  comments?: string[];
  /** Sub-issue numbers — what puts a `prd` issue in the spec-evaluate pass's scope. */
  children?: number[];
}

export interface FakeClosed {
  number: number;
  stateReason: "completed" | "not_planned";
  /** Whether a merged pull request closed it. */
  merged?: boolean;
  /** When the closing PR merged — the spec-closing pass's own "branch position" ordering. */
  mergedAt?: string;
  /** The closing PR's own merge commit — what the spec-closing pass's synthesized range names. */
  mergeSha?: string;
}

/** A child closed as completed by a merged pull request — the estate's `delivered`. */
export function delivered(number: number, mergedAt: string, mergeSha: string): FakeClosed {
  return { number, stateReason: "completed", merged: true, mergedAt, mergeSha };
}

/**
 * The pull request the tracker says closed issue `n`, and the inverse. An issue and its closer are
 * different numbers in the real tracker — #237 was closed by PR #244 — so the fake gives them
 * different numbers too, and a reader that confused the two would fail here rather than pass by
 * coincidence.
 */
const closingPrFor = (issue: number) => issue * 10 + 4;
const closerOwner = (pr: number) => (pr - 4) / 10;

export interface TrackerOptions {
  open: FakeIssue[];
  closed?: FakeClosed[];
  /** Branch refs that already exist, as `implement/issue-<n>`. */
  claimed?: string[];
  standing?: { number: number; body: string; comments?: string[] };
  /** Endpoints that should throw, to exercise the degraded paths. */
  fail?: "issues" | "refs" | "edges";
}

export interface Tracker {
  gh: GhExec;
  calls: string[][];
  /** Every `repository_dispatch` sent, with its event type and payload split out. */
  dispatches: FakeDispatch[];
  comments: Array<{ issue: number; body: string }>;
  created: Array<{ title: string; body: string }>;
  closedByRun: Array<{ issue: number; reason: string }>;
  /** Every comment rewritten whole via `gh api ... -X PATCH`, by the id the fake handed out. */
  commentEdits: Array<{ id: number; body: string }>;
  labelsAdded: Array<{ issue: number; name: string }>;
  labelsRemoved: Array<{ issue: number; name: string }>;
}

export function trackerWith(options: TrackerOptions): Tracker {
  const calls: string[][] = [];
  const comments: Tracker["comments"] = [];
  const created: Tracker["created"] = [];
  const closedByRun: Tracker["closedByRun"] = [];
  const commentEdits: Tracker["commentEdits"] = [];
  const labelsAdded: Tracker["labelsAdded"] = [];
  const labelsRemoved: Tracker["labelsRemoved"] = [];
  const closed = new Map((options.closed ?? []).map((issue) => [issue.number, issue]));
  const open = new Map(options.open.map((issue) => [issue.number, issue]));

  /**
   * How this tracker reports a related issue: its number and its state, resolved off the one
   * `closed`/`open` bookkeeping every handler here shares. Both edge endpoints answer in this
   * shape — blocked-by edges and sub-issues — and the reconciler reads `state`/`state_reason` from
   * each, so they are answered by one function rather than two that can drift apart.
   */
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
    // `{number}` is all `fetchSubIssueCount` asks for; the spec-closing pass's own `fetchChildren`
    // reads `state`/`state_reason` off the same endpoint, so both are served the same way.
    if (subIssues) return issueRefs(open.get(Number(subIssues[1]))?.children ?? []);
    return undefined;
  };

  const answer = (args: string[]): string | undefined => {
    if (args[0] === "api") return answerApi(args);

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
    // `closedByPullRequestsReferences` carries a PR's *number*; only the pull request itself knows
    // whether it merged, so the tracker makes the reader go and ask (ADR-0106).
    if (args[0] === "issue" && args[1] === "view") {
      const record = closed.get(Number(args[2]));
      return JSON.stringify(record ? [closingPrFor(record.number)] : []);
    }
    if (args[0] === "pr" && args[1] === "view") {
      const record = closed.get(closerOwner(Number(args[2])));
      if (args.includes("--jq")) return `${record?.merged ? "MERGED" : "CLOSED"}\n`;
      // `--json mergedAt,mergeCommit`, no `--jq` — the spec-closing pass's own "branch position"
      // read, asked only of a PR the two-call delivery question above already found merged.
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
    return undefined;
  };

  const sender = createFakeGh();
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return answer(args) ?? sender.gh(args);
  };

  return { gh, calls, dispatches: sender.dispatches, comments, created, closedByRun, commentEdits, labelsAdded, labelsRemoved };
}

export const silent = () => {};

/**
 * One reconcile pass over `tracker`, against a throwaway target checkout — so no case depends on
 * what this process's own cwd happens to hold. `input` overrides anything a case is about.
 */
export function reconcileOver(tracker: Tracker, input: Partial<ReconcileInput> = {}): ReconcileOutcome {
  return runReconcile({ gh: tracker.gh, log: silent, targetWorkspace: scratchDir("reconcile-target"), ...input });
}

/**
 * The issue numbers this pass started, whichever door it sent them through — lane 04's
 * `acceptance-wanted` or lane 05's `ticket-ready`. Which of the two is `to-build-door.test.ts`'s
 * subject; the pass's own tests are about *whether* a slice started.
 */
export function startedIssues(tracker: Tracker): number[] {
  return tracker.dispatches.map((dispatch) => Number(dispatch.payload.issue));
}

/** Every write — a fresh `issue comment` or a rewritten `commentEdits` entry — carrying `marker`. */
export function commentsCarrying(tracker: Tracker, marker: string): string[] {
  return [...tracker.comments.map((entry) => entry.body), ...tracker.commentEdits.map((entry) => entry.body)].filter(
    (body) => body.includes(marker),
  );
}
