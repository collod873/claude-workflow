import {
  runReconcile,
  type ReconcileInput,
  type ReconcileOutcome,
} from "../../.Workflow/agent-workflows/dispatch/reconcile";
import type { GhExec } from "../../.Workflow/agent-workflows/shared/gh";

/**
 * The tracker lane 04's #238 tests share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one. `.fixture.ts` is the name this repo already
 * gives a file whose job is to be unreachable from a lane.
 *
 * It exists because all three of #238's criteria ask the same question of the same machinery — did
 * lane 09's spec-closing pass hand this spec to `bin/close-ticket --spec`, and with what — and the
 * only honest way to ask it is to stand up a whole tracker the reconciler can read. Written once,
 * three times over would be three fakes with three different holes.
 *
 * **Nothing here stands in for the subject.** `runPass` calls the real `runReconcile`; the only
 * things injected are the two seams the ticket names — `gh`, which lane 09 already injects, and the
 * closer, injected the way `integrate.ts` injects `closeTicket`. What the pass decides, and what it
 * hands the closer, is left entirely to the pass.
 */

/** `{exitCode, output}` — what `integrate.ts` folds a `bin/close-ticket` invocation into. */
export interface CloserResult {
  exitCode: number;
  output: string;
}

/**
 * The command a runnable spec's one criterion carries. `true` ignores its arguments and exits 0
 * however the pass runs it — through a shell or not — so the pass's own evaluation is green without
 * the check runner being mocked away. The trailing word is only there to be recognisable in a
 * comment body.
 */
export const SPEC_CHECK_COMMAND = "true wired-spec-probe";

/** The same, red: `false` likewise ignores its arguments and exits non-zero. */
export const RED_SPEC_CHECK_COMMAND = "false wired-spec-probe";

/** A spec body of the shape the spec refusal accepts: exactly one criterion, carrying a check. */
export function runnableSpecBody(command: string = SPEC_CHECK_COMMAND): string {
  return [
    "## Problem Statement",
    "",
    "A spec closes when its tickets close. Nothing ever asks whether the product does the thing.",
    "",
    "## Acceptance criteria",
    "",
    `- [ ] I'll know it works when I can watch a delivered spec judged by its own check — check: \`${command}\``,
    "",
  ].join("\n");
}

export interface FakeChild {
  number: number;
  title?: string;
  state: "open" | "closed";
  /** Defaults to `completed` for a closed child. */
  stateReason?: "completed" | "not_planned";
  /** The merge commit of the merged pull request that closed it. Absent ⇒ nothing merged. */
  merge?: string;
}

export interface FakeSpec {
  number: number;
  title?: string;
  /** Defaults to `runnableSpecBody()`. */
  body?: string;
  /**
   * In **branch order**: `children[0]`'s merge is the earliest on the default branch, whatever its
   * issue number. Every ordering signal this fake publishes — merge timestamps and the commit
   * listing — is derived from this order and from nothing else.
   */
  children: FakeChild[];
}

export interface SpecTrackerOptions {
  specs: FakeSpec[];
  /** What the injected closer hands back. Exit 0 is the close; anything else is a red check. */
  closerResult?: CloserResult;
}

export interface SpecTracker {
  gh: GhExec;
  /** The injected `bin/close-ticket --spec` seam. */
  closer: (...args: unknown[]) => CloserResult;
  /** One entry per invocation: every argument the closer was handed, flattened to strings. */
  closerCalls: string[][];
  /** Every `gh` argv, in order. */
  calls: string[][];
  /** Issues this run closed, by whichever route it closed them. */
  closedIssues: number[];
  /** The comment bodies standing on an issue when the run finished — edits applied. */
  commentsOn(issue: number): string[];
  /** Whether any `gh` call this run made carried `text` in one of its arguments. */
  wrote(text: string): boolean;
}

interface IssueRecord {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  stateReason: "completed" | "not_planned" | null;
  labels: string[];
  parent: number | null;
  merge?: string;
  mergedAt?: string;
  prNumber?: number;
  comments: Array<{ id: number; body: string }>;
}

/** A published slice's body — `render-body.ts` writes this heading and nothing else does. */
function sliceBody(spec: number): string {
  return `## Parent PRD\n#${spec}\n\n## What to build\nOne vertical slice.\n`;
}

function mergedAtOf(position: number): string {
  return `2026-03-${String(position + 1).padStart(2, "0")}T09:00:00Z`;
}

/** A synthetic parent for a merge commit — hex, and never one of the merges themselves. */
function parentSha(sha: string): string {
  return sha.split("").reverse().join("");
}

function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at !== -1) return args[at + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline === undefined ? undefined : inline.slice(flag.length + 1);
}

function jsonFields(args: string[]): string[] {
  return (flagValue(args, "--json") ?? "")
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

/** A comment body, however it was passed: `--body`, `--body=`, or an API `-f body=`. */
function bodyArg(args: string[]): string | undefined {
  const direct = flagValue(args, "--body");
  if (direct !== undefined) return direct;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1] ?? "";
    if (["-f", "-F", "--field", "--raw-field"].includes(arg) && next.startsWith("body=")) {
      return next.slice("body=".length);
    }
    if (arg.startsWith("body=")) return arg.slice("body=".length);
  }
  return undefined;
}

/**
 * Every argument the closer was handed, flattened to strings — so a test can assert what it was
 * told without pinning whether the seam takes an argv, three positionals or one options object.
 */
function flattenArgs(args: unknown[]): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) push(item);
      return;
    }
    out.push(String(value));
  };
  for (const arg of args) push(arg);
  return out;
}

export function createSpecTracker(options: SpecTrackerOptions): SpecTracker {
  const calls: string[][] = [];
  const closerCalls: string[][] = [];
  const closedIssues: number[] = [];
  const records = new Map<number, IssueRecord>();
  /** The merges, oldest first — this fake's whole notion of position on the default branch. */
  const branch: string[] = [];
  let nextCommentId = 900100;

  for (const spec of options.specs) {
    records.set(spec.number, {
      number: spec.number,
      title: spec.title ?? `A spec (#${spec.number})`,
      body: spec.body ?? runnableSpecBody(),
      state: "open",
      stateReason: null,
      labels: ["prd"],
      parent: null,
      comments: [],
    });
    for (const child of spec.children) {
      const position = child.merge === undefined ? -1 : branch.push(child.merge) - 1;
      records.set(child.number, {
        number: child.number,
        title: child.title ?? `A slice (#${child.number})`,
        body: sliceBody(spec.number),
        state: child.state,
        stateReason: child.state === "closed" ? (child.stateReason ?? "completed") : null,
        labels: [],
        parent: spec.number,
        merge: child.merge,
        mergedAt: position === -1 ? undefined : mergedAtOf(position),
        prNumber: child.merge === undefined ? undefined : 1000 + child.number,
        comments: [],
      });
    }
  }

  const childrenOf = (parent: number): IssueRecord[] =>
    [...records.values()].filter((rec) => rec.parent === parent);

  const closingPrs = (rec: IssueRecord): Array<Record<string, unknown>> =>
    rec.merge === undefined
      ? []
      : [
          {
            number: rec.prNumber,
            state: "MERGED",
            merged: true,
            mergedAt: rec.mergedAt,
            mergeCommit: { oid: rec.merge },
            url: `https://github.com/owner/repo/pull/${rec.prNumber}`,
            title: rec.title,
          },
        ];

  const project = (rec: IssueRecord, fields: string[]): Record<string, unknown> => {
    const all: Record<string, unknown> = {
      number: rec.number,
      title: rec.title,
      body: rec.body,
      state: rec.state.toUpperCase(),
      stateReason: rec.stateReason === null ? null : rec.stateReason.toUpperCase(),
      state_reason: rec.stateReason,
      labels: rec.labels.map((name) => ({ name })),
      comments: rec.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        url: `https://github.com/owner/repo/issues/${rec.number}#issuecomment-${comment.id}`,
      })),
      url: `https://github.com/owner/repo/issues/${rec.number}`,
      closedAt: rec.state === "closed" ? "2026-03-15T09:00:00Z" : null,
      closedByPullRequestsReferences: closingPrs(rec),
    };
    const out: Record<string, unknown> = {};
    for (const field of fields) out[field] = field in all ? all[field] : null;
    return out;
  };

  const restIssue = (rec: IssueRecord): Record<string, unknown> => ({
    number: rec.number,
    title: rec.title,
    body: rec.body,
    state: rec.state,
    state_reason: rec.stateReason,
    labels: rec.labels.map((name) => ({ name })),
    html_url: `https://github.com/owner/repo/issues/${rec.number}`,
  });

  const issueList = (argv: string[]): string => {
    const fields = jsonFields(argv);
    const state = (flagValue(argv, "--state") ?? "open").toLowerCase();
    const label = flagValue(argv, "--label");
    const search = flagValue(argv, "--search");
    let pool = [...records.values()];
    if (state === "open" || state === "closed") pool = pool.filter((rec) => rec.state === state);
    if (label !== undefined) pool = pool.filter((rec) => rec.labels.includes(label));
    if (search !== undefined) {
      const parent = /#?(\d+)/.exec(search);
      if (parent) pool = pool.filter((rec) => rec.parent === Number(parent[1]));
      const named = /label:\s*"?([\w-]+)"?/.exec(search);
      if (named) pool = pool.filter((rec) => rec.labels.includes(named[1]));
    }
    const wanted = fields.length > 0 ? fields : ["number", "title", "body"];
    return JSON.stringify(pool.map((rec) => project(rec, wanted)));
  };

  const issueView = (argv: string[]): string => {
    const rec = records.get(Number(argv[2]));
    const fields = jsonFields(argv);
    const jq = flagValue(argv, "--jq") ?? "";
    if (rec === undefined) return jq === "" ? "{}" : "[]";

    if (jq.includes("closedByPullRequestsReferences")) {
      const prs = closingPrs(rec);
      const wantsSha = /oid|sha|mergecommit|commit/i.test(jq);
      const wantsState = /state/i.test(jq);
      if (wantsSha && wantsState) {
        return JSON.stringify(
          prs.map((pr) => ({
            state: pr.state,
            oid: (pr.mergeCommit as { oid: string }).oid,
            mergeCommit: pr.mergeCommit,
            number: pr.number,
            mergedAt: pr.mergedAt,
          })),
        );
      }
      if (wantsSha) return JSON.stringify(prs.map((pr) => (pr.mergeCommit as { oid: string }).oid));
      return JSON.stringify(prs.map((pr) => pr.state));
    }

    if (jq.includes("comments")) {
      return /body/.test(jq)
        ? JSON.stringify(rec.comments.map((comment) => comment.body))
        : JSON.stringify(rec.comments);
    }

    const wanted = fields.length > 0 ? fields : ["number", "title", "body", "state"];
    return JSON.stringify(project(rec, wanted));
  };

  const issueComment = (argv: string[]): string => {
    const number = Number(argv[2]);
    const rec = records.get(number);
    const body = bodyArg(argv) ?? "";
    if (rec === undefined) return "";
    const last = rec.comments[rec.comments.length - 1];
    if (argv.includes("--edit-last") && last !== undefined) {
      last.body = body;
      return `https://github.com/owner/repo/issues/${number}#issuecomment-${last.id}\n`;
    }
    const id = nextCommentId++;
    rec.comments.push({ id, body });
    return `https://github.com/owner/repo/issues/${number}#issuecomment-${id}\n`;
  };

  const api = (argv: string[]): string => {
    const path = argv[1] ?? "";
    const jq = flagValue(argv, "--jq") ?? "";

    if (path.includes("matching-refs")) return "[]";
    if (path.includes("/dependencies/")) return "[]";
    if (path.endsWith("dispatches")) return "";

    const sub = /\/issues\/(\d+)\/sub_issues/.exec(path);
    if (sub) return JSON.stringify(childrenOf(Number(sub[1])).map(restIssue));

    const comment = /\/issues\/comments\/(\d+)/.exec(path);
    if (comment) {
      const body = bodyArg(argv);
      const id = Number(comment[1]);
      if (body !== undefined) {
        for (const rec of records.values()) {
          const found = rec.comments.find((entry) => entry.id === id);
          if (found) found.body = body;
        }
      }
      return JSON.stringify({ id, body: body ?? "" });
    }

    if (path.includes("/commits")) {
      const newestFirst = [...branch].reverse();
      if (/sha|oid/i.test(jq)) return JSON.stringify(newestFirst);
      return JSON.stringify(
        newestFirst.map((sha) => ({
          sha,
          parents: [{ sha: parentSha(sha) }],
          commit: { message: "Merge pull request", committer: { date: mergedAtOf(branch.indexOf(sha)) } },
        })),
      );
    }

    if (path === "graphql") {
      const raw = argv.join(" ");
      const asked = /number[=:]\s*(\d+)/.exec(raw);
      const parent = asked ? Number(asked[1]) : (options.specs[0]?.number ?? 0);
      const nodes = childrenOf(parent).map((rec) => ({
        number: rec.number,
        title: rec.title,
        state: rec.state.toUpperCase(),
        stateReason: rec.stateReason === null ? null : rec.stateReason.toUpperCase(),
        closedByPullRequestsReferences: { nodes: closingPrs(rec) },
      }));
      return JSON.stringify({
        data: { repository: { issue: { subIssues: { nodes }, trackedIssues: { nodes } } } },
      });
    }

    const issue = /\/issues\/(\d+)(?:$|\?)/.exec(path);
    if (issue) {
      const rec = records.get(Number(issue[1]));
      if (rec === undefined) return "{}";
      if (argv.some((arg) => /^state=closed$/i.test(arg))) {
        rec.state = "closed";
        closedIssues.push(rec.number);
      }
      return JSON.stringify(restIssue(rec));
    }

    return "[]";
  };

  const gh: GhExec = (args) => {
    const argv = [...args];
    calls.push(argv);

    if (argv[0] === "issue" && argv[1] === "list") return issueList(argv);
    if (argv[0] === "issue" && argv[1] === "view") return issueView(argv);
    if (argv[0] === "issue" && argv[1] === "comment") return issueComment(argv);
    if (argv[0] === "issue" && argv[1] === "close") {
      const number = Number(argv[2]);
      closedIssues.push(number);
      const rec = records.get(number);
      if (rec) {
        rec.state = "closed";
        rec.stateReason = "completed";
      }
      return "";
    }
    if (argv[0] === "issue") return "";
    if (argv[0] === "api") return api(argv);

    // Permissive on purpose: an unrecognised read must not cost the reconciler its answer, or a
    // test goes red for a call this fake failed to imagine rather than for anything #238 does.
    return "[]";
  };

  const closer = (...args: unknown[]): CloserResult => {
    closerCalls.push(flattenArgs(args));
    return options.closerResult ?? { exitCode: 0, output: "" };
  };

  return {
    gh,
    closer,
    closerCalls,
    calls,
    closedIssues,
    commentsOn: (issue) => (records.get(issue)?.comments ?? []).map((comment) => comment.body),
    wrote: (text) => calls.some((call) => call.some((arg) => arg.includes(text))),
  };
}

/**
 * One session of lane 09, against this tracker, with the closer injected.
 *
 * The cast is what lets these tests be written before `ReconcileInput` carries the seam: it names
 * `closeTicket` and nothing else, so a pass that reads the closer from anywhere else simply never
 * calls this one, and the assertions go red.
 */
export function runPass(tracker: SpecTracker): ReconcileOutcome {
  return runReconcile({
    gh: tracker.gh,
    log: () => {},
    closeTicket: tracker.closer,
  } as ReconcileInput);
}
