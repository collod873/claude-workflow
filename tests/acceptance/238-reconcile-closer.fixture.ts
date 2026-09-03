import { execFileSync } from "node:child_process";
import { runTsDriver, subjectPath } from "./ts-driver.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The reader lane 04's #238 tests share: it runs lane 09's real reconciler in a child process
 * against a fake tracker and an injected closer, and hands back what the run actually did.
 *
 * **Why a child process.** Everything under `tests/acceptance/` is restored from trunk before CI
 * runs it, and only this directory is. A test that imported the reconciler would be reaching
 * through a specifier the branch under test controls, so the subject is reached the way a shell
 * reaches it — a generated driver, run from the repository root, importing the module by an
 * absolute path built at runtime. Nothing here climbs out of this directory.
 *
 * **Why one fixture rather than one copy per test.** All three of #238's criteria need the same
 * fake tracker, the same spec body and the same driver. Three copies of a `gh` fake is three sets
 * of divergent bugs; this is one.
 *
 * The fake answers `gh` the way the reconciler already expects to be answered — `issue list`,
 * `issue view` with the closing pull requests, the blocked-by edges, the matching refs — plus the
 * calls a spec-closing pass needs: the spec's sub-issues, and each closing pull request's merge
 * commit and merge time. It never throws on a call it does not recognise, so an unrecognised call
 * cannot turn a behavioural assertion into an exception.
 */

const SENTINEL = "__ACCEPTANCE_RESULT__";

/** One issue in the fake tracker — a spec, or one of its children. */
export interface FakeIssue {
  number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  stateReason?: "completed" | "not_planned";
  labels?: string[];
  /** Whether a merged pull request closed it — the estate's `delivered`. */
  merged?: boolean;
  prNumber?: number;
  mergeSha?: string;
  mergedAt?: string;
}

export interface Scenario {
  spec: FakeIssue;
  children: FakeIssue[];
  /** What the injected closer reports back, as `CloseTicketResult` spells it. */
  closer: { exitCode: number; output: string };
}

export interface PassResult {
  /** Every `gh` argv the run issued, in order. */
  calls: string[][];
  /** Every invocation of the injected closer, with its arguments. */
  closerCalls: unknown[][];
  logs: string[];
  outcome: unknown;
  error: string | null;
}

/** A merge on the default branch: the commit a child was delivered by, and when it landed. */
export interface Merge {
  sha: string;
  mergedAt: string;
}

/**
 * `count` merges, oldest first: real commits off this checkout's default branch where they can be
 * had — so an implementation that resolves a range in git rather than reading the tracker gets
 * commits that actually exist — and fixed synthetic ones when the checkout is too shallow to offer
 * `<sha>^`.
 *
 * **The merge times are this fixture's, never the commits' own.** They used to be `%cI` straight
 * off `git log`, which made the criterion below a statement about whatever had last landed on this
 * branch. Committer dates are not monotonic along `--first-parent` — a rebase, a cherry-pick or an
 * amend rewrites them — and they are not even written in one offset: this repository's own history
 * carries both `…-04:00` and `…Z` stamps, and `synthesizeRange` orders merges by `localeCompare`
 * on that string, under which `T23:50:18Z` sorts after `T20:07:14-04:00` while being four hours
 * earlier. Either of those flips the pair, and the test then reports the shape of last night's
 * history instead of the shape of the range.
 *
 * So the shas come from git and the timestamps come from here: strictly ascending, one offset,
 * oldest first. "Oldest first" is then a promise this function keeps rather than one it inherits,
 * which is what the caller was already assuming when it named them `[early, late]`.
 */
export function mergesOnDefaultBranch(count: number): Merge[] {
  const shas = realShas(count) ?? SYNTHETIC_SHAS.slice(0, count);
  return shas.map((sha, index) => ({ sha, mergedAt: MERGED_AT[index] }));
}

/**
 * The merge times, ascending and all in one offset. Long enough for every caller here; a caller
 * asking for more merges than there are stamps is a fixture change, not a silent reordering.
 */
const MERGED_AT = [
  "2026-08-10T09:00:00Z",
  "2026-08-20T09:00:00Z",
  "2026-08-25T09:00:00Z",
];

const SYNTHETIC_SHAS = [
  "3f9a1c7e0b5d4a2c8e6f0b1d3a5c7e9f2b4d6a80",
  "b7d2e4f6a8c0b1d3e5f7a9c1b3d5e7f9a1c3e5d7",
  "c1e3a5b7d9f2a4c6e8b0d2f4a6c8e0b2d4f6a8c0",
];

function realShas(count: number): string[] | null {
  if (count > MERGED_AT.length) return null;
  try {
    const raw = execFileSync("git", ["log", "--first-parent", "-n", String(count), "--format=%H"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const shas = raw
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (shas.length < count) return null;
    for (const sha of shas) {
      // `<sha>^` has to resolve, or a range built from it is not a range.
      execFileSync("git", ["rev-parse", "-q", "--verify", sha + "^"], { cwd: repoRoot, encoding: "utf8" });
    }
    return shas.reverse();
  } catch {
    return null;
  }
}

/** A spec body carrying exactly one criterion with a well-formed check marker — a runnable spec. */
export function specBody(command = "true"): string {
  return [
    "## Problem Statement",
    "",
    "A spec closes when its tickets close. Nothing ever asks whether the product does the thing.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] I'll know it works when I can watch the closer run — check: `" + command + "`",
    "",
  ].join("\n");
}

/** A published slice's body — the `## Parent PRD` heading lane 03 writes and nothing else does. */
export function childBody(spec: number): string {
  return "## Parent PRD\n#" + spec + "\n\n## What to build\nA slice.\n";
}

export function specIssue(number: number, command = "true"): FakeIssue {
  return { number, title: "A spec whose check can run", body: specBody(command), labels: ["prd"], state: "open" };
}

/** A child closed as completed by a merged pull request — delivered. */
export function deliveredChild(number: number, spec: number, merge: Merge, prNumber: number): FakeIssue {
  return {
    number,
    title: "Slice " + number,
    body: childBody(spec),
    state: "closed",
    stateReason: "completed",
    merged: true,
    prNumber,
    mergeSha: merge.sha,
    mergedAt: merge.mergedAt,
  };
}

/** A child still open — undelivered, whatever else has landed. */
export function openChild(number: number, spec: number): FakeIssue {
  return { number, title: "Slice " + number, body: childBody(spec), state: "open" };
}

/** A child closed `not planned` — closed, and by ADR-0013's rule not delivered. */
export function abandonedChild(number: number, spec: number): FakeIssue {
  return {
    number,
    title: "Slice " + number,
    body: childBody(spec),
    state: "closed",
    stateReason: "not_planned",
    merged: false,
  };
}

/** The issues this run closed, as a reader of the tracker would see them. */
export function closedIssues(result: PassResult): number[] {
  return result.calls
    .filter((call) => call[0] === "issue" && call[1] === "close")
    .map((call) => Number(call[2]));
}

/** Runs lane 09's reconciler against `scenario` and returns what it did. */
export function runSpecPass(scenario: Scenario): PassResult {
  return runTsDriver<PassResult>({
    source: DRIVER_SOURCE,
    sentinel: SENTINEL,
    prefix: "acceptance-238-",
    env: {
      ACCEPTANCE_SCENARIO: JSON.stringify(scenario),
      ACCEPTANCE_SUBJECT: subjectPath(".Workflow", "agent-workflows", "dispatch", "reconcile.ts"),
    },
    failure: "could not run the reconciler out of process",
  });
}

/**
 * The driver, written to a temp file and run from the repository root. Plain JavaScript in an
 * `.mts` file so it is ESM under every runner tried above.
 */
const DRIVER_SOURCE = `
import { pathToFileURL } from "node:url";

const SENTINEL = "${SENTINEL}";
const scenario = JSON.parse(process.env.ACCEPTANCE_SCENARIO || "{}");
const subjectPath = process.env.ACCEPTANCE_SUBJECT || "";
const spec = scenario.spec || null;
const children = scenario.children || [];
const closerResult = scenario.closer || { exitCode: 0, output: "" };

const calls = [];
const closerCalls = [];
const logs = [];

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function pluck(value, dotted) {
  let current = value;
  for (const key of dotted.split(".")) {
    if (current === null || current === undefined) return current;
    current = current[key];
  }
  return current;
}

// Enough of jq to answer the shapes this estate's gh calls actually use: a projection over an
// array, an object-building projection, and a plain path.
function applyJq(value, jq) {
  if (!jq) return value;
  const query = String(jq).trim();
  if (query.startsWith("[") && query.endsWith("]")) {
    const inner = query.slice(1, -1).trim();
    const at = inner.indexOf("[]");
    if (at === -1) return value;
    const base = inner.slice(0, at).trim();
    let rest = inner.slice(at + 2).trim();
    const source = base === "." || base === "" ? value : pluck(value, base.startsWith(".") ? base.slice(1) : base);
    const list = Array.isArray(source) ? source : [];
    if (rest.startsWith("|")) rest = rest.slice(1).trim();
    if (rest.startsWith("{") && rest.endsWith("}")) {
      const keys = rest.slice(1, -1).split(",").map((key) => key.trim()).filter((key) => key.length > 0);
      return list.map((entry) => {
        const picked = {};
        for (const key of keys) picked[key] = entry && entry[key] !== undefined ? entry[key] : null;
        return picked;
      });
    }
    if (rest.startsWith(".")) return list.map((entry) => pluck(entry, rest.slice(1)));
    return list;
  }
  if (query.startsWith(".")) {
    const dotted = query.slice(1);
    return dotted.length === 0 ? value : pluck(value, dotted);
  }
  return value;
}

function render(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function issueObject(issue) {
  return {
    number: issue.number,
    title: issue.title || ("issue " + issue.number),
    body: issue.body || "",
    state: issue.state || "open",
    state_reason: issue.stateReason || null,
    stateReason: issue.stateReason || null,
    labels: (issue.labels || []).map((name) => ({ name: name })),
    comments: [],
    url: "https://github.com/acme/tracker/issues/" + issue.number,
  };
}

function everyIssue() {
  return spec ? [spec].concat(children) : children.slice();
}

function closingPullRequests(issue) {
  if (!issue || !issue.merged) return [];
  return [{
    number: issue.prNumber || 0,
    state: "MERGED",
    title: "Delivers #" + issue.number,
    url: "https://github.com/acme/tracker/pull/" + (issue.prNumber || 0),
    mergeCommit: { oid: issue.mergeSha || null },
    mergedAt: issue.mergedAt || null,
    baseRefName: "main",
  }];
}

function pullRequestObject(number) {
  const child = children.find((candidate) => candidate.prNumber === number);
  if (!child) {
    return {
      number: number,
      state: "CLOSED",
      merged: false,
      mergeCommit: null,
      mergedAt: null,
      merge_commit_sha: null,
      merged_at: null,
    };
  }
  return {
    number: number,
    state: "MERGED",
    merged: true,
    mergeCommit: { oid: child.mergeSha },
    mergedAt: child.mergedAt,
    merge_commit_sha: child.mergeSha,
    merged_at: child.mergedAt,
    baseRefName: "main",
    base: { ref: "main" },
  };
}

const gh = (args) => {
  const argv = Array.from(args).map((arg) => String(arg));
  calls.push(argv);
  const jq = flagValue(argv, "--jq") || flagValue(argv, "-q");

  if (argv[0] === "issue" && argv[1] === "list") {
    const state = flagValue(argv, "--state") || flagValue(argv, "-s") || "open";
    const label = flagValue(argv, "--label") || flagValue(argv, "-l");
    let listed = everyIssue();
    if (state !== "all") listed = listed.filter((issue) => (issue.state || "open") === state);
    if (label) listed = listed.filter((issue) => (issue.labels || []).indexOf(label) !== -1);
    return render(applyJq(listed.map(issueObject), jq));
  }

  if (argv[0] === "issue" && argv[1] === "view") {
    const number = Number(argv[2]);
    const issue = everyIssue().find((candidate) => candidate.number === number) || { number: number };
    const view = issueObject(issue);
    view.closedByPullRequestsReferences = closingPullRequests(issue);
    view.subIssues = spec && number === spec.number ? children.map(issueObject) : [];
    return render(applyJq(view, jq));
  }

  if (argv[0] === "pr" && argv[1] === "view") {
    return render(applyJq(pullRequestObject(Number(argv[2])), jq));
  }

  if (argv[0] === "api") {
    const apiPath = argv[1] || "";
    if (apiPath.indexOf("matching-refs") !== -1) return render(applyJq([], jq));
    if (apiPath.indexOf("/dependencies/") !== -1) return render(applyJq([], jq));
    if (apiPath.indexOf("/dispatches") !== -1) return "";
    if (apiPath.indexOf("sub_issues") !== -1 || apiPath.indexOf("sub-issues") !== -1) {
      const after = apiPath.split("/issues/")[1] || "";
      const parent = Number(after.split("/")[0]);
      const listed = spec && parent === spec.number ? children.map(issueObject) : [];
      return render(applyJq(listed, jq));
    }
    if (apiPath.indexOf("/pulls/") !== -1) {
      const after = apiPath.split("/pulls/")[1] || "";
      return render(applyJq(pullRequestObject(Number(after.split("/")[0].split("?")[0])), jq));
    }
    return render(applyJq([], jq));
  }

  return "";
};

const closer = (...invocation) => {
  closerCalls.push(invocation.map((value) => (typeof value === "function" ? "[function]" : value)));
  return { exitCode: closerResult.exitCode, output: closerResult.output };
};

async function main() {
  const subject = await import(pathToFileURL(subjectPath).href);
  // Recorded under both names the ticket's own wording allows for the injected closer, so the
  // recorder is reached whichever one the pass ends up calling it.
  const deps = {
    gh: gh,
    log: (line) => logs.push(String(line)),
    closeTicket: closer,
    closeSpec: closer,
  };
  let outcome = null;
  let error = null;
  try {
    outcome = subject.runReconcile(deps);
    if (outcome && typeof outcome.then === "function") outcome = await outcome;
  } catch (err) {
    error = err instanceof Error ? (err.stack || err.message) : String(err);
  }
  return { calls: calls, closerCalls: closerCalls, logs: logs, outcome: outcome, error: error };
}

main().then(
  (payload) => process.stdout.write("\\n" + SENTINEL + JSON.stringify(payload) + "\\n"),
  (err) => process.stdout.write(
    "\\n" + SENTINEL + JSON.stringify({
      calls: calls,
      closerCalls: closerCalls,
      logs: logs,
      outcome: null,
      error: String((err && err.stack) || err),
    }) + "\\n",
  ),
);
`;
