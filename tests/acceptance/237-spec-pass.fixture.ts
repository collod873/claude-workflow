import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The child-process probes #237's acceptance tests share.
 *
 * Not a `.test.ts`, so it is never collected as a suite — it is only imported by one. It exists
 * because all three of this ticket's criteria have to reach modules that live outside
 * `tests/acceptance/`, and the only honest way to do that is to run them the way a shell would:
 * `npx tsx -e` a few lines that import the subject by absolute file URL and print what it did.
 * Writing that runner into each test file would be three copies of one parser, which is the
 * duplication this directory's fixture convention exists to prevent.
 *
 * The reconciler probe injects a fake `GhExec` and records every argv, because that is what
 * `reconcile.ts` already gives a test: an injected seam and a call log. The readers below
 * (`markerWrites`, `labelWrites`) turn that log back into the two facts #237's criteria are about
 * — which marker was written, and which labels were added or taken off — and they are deliberately
 * tolerant of *how* the write is spelled (`gh issue comment`, `gh issue edit --add-label`, or the
 * REST equivalents) while remaining strict about *whether* it was a write at all. A `--jq` filter
 * that merely mentions a marker is a read, and a read must never satisfy a criterion about a write.
 */

/** The modules #237 claims, as absolute paths — imported only inside a child process. */
export const TICKET_SHAPE_SOURCE = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "ticket-shape.ts",
);

/** The test file criterion 1's own check command names. */
export const TICKET_SHAPE_TEST = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "ticket-shape.test.ts",
);

export const RECONCILE_SOURCE = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "dispatch",
  "reconcile.ts",
);

/** A module specifier a child process can `import()` — an absolute `file:` URL, never a path. */
export function moduleUrl(file: string): string {
  return pathToFileURL(file).href;
}

export interface TsxRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `script` under `tsx`, from the checkout root, with `env` layered over this process's. */
export function runTsx(script: string, env: Record<string, string>): TsxRun {
  const run = spawnSync("npx", ["tsx", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/**
 * The last `PROBE:` line a probe printed, parsed. A probe that printed none crashed before it could
 * report, which is a fact about the run rather than about the ticket — so the error carries both
 * streams.
 */
export function probeResult<T>(run: TsxRun): T {
  const line = run.stdout
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("PROBE:"));
  if (line === undefined) {
    throw new Error(
      `the probe printed no PROBE: line (exit ${String(run.status)}).\n` +
        `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE:".length)) as T;
}

/** One issue as a scenario declares it. */
export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  /** Label names, as `prd` and `needs-human` are spelled on the tracker. */
  labels?: string[];
  /** Comment bodies already standing on the issue, oldest first. */
  comments?: string[];
  /** Sub-issue numbers — what makes a spec in scope for this pass. */
  children?: number[];
  blockedBy?: number[];
}

export interface Scenario {
  issues: FakeIssue[];
}

export interface ReconcileProbe {
  /** Every argv the reconciler handed its injected `GhExec`, in order. */
  calls: string[][];
  outcome: { action?: string; note?: string } | null;
  /** Non-null when `runReconcile` threw rather than returning. */
  error: string | null;
}

/**
 * A fake `gh` that answers every channel a spec-closing pass could plausibly read through —
 * `issue list` with labels and comments, `issue view`, the sub-issues endpoint, `## Parent PRD`
 * bodies, and `subIssuesSummary` — so an assertion about what the pass *wrote* never depends on
 * which channel it chose to *read*. Writes are recorded and answered blandly.
 */
const RECONCILE_PROBE = `
const MODULE = process.env.PROBE_MODULE;
const scenario = JSON.parse(process.env.PROBE_SCENARIO || "{}");
const issues = scenario.issues || [];
const find = (n) => issues.find((issue) => issue.number === Number(n));
const stub = (n) => ({ number: Number(n), title: "#" + n, body: "", labels: [], comments: [], children: [] });
const labelsOf = (issue) => (issue.labels || []).map((name) => ({ name: name }));
const commentsOf = (issue) =>
  (issue.comments || []).map((body, index) => ({
    id: issue.number * 100 + index,
    body: body,
    user: { login: "github-actions[bot]" },
    created_at: "2026-01-01T00:00:00Z",
  }));
const view = (issue) => ({
  number: issue.number,
  title: issue.title || "#" + issue.number,
  body: issue.body || "",
  state: "OPEN",
  stateReason: null,
  state_reason: null,
  labels: labelsOf(issue),
  comments: commentsOf(issue),
  url: "https://example.invalid/issues/" + issue.number,
  subIssuesSummary: { total: (issue.children || []).length, completed: 0, percentCompleted: 0 },
});
const calls = [];
const gh = (args) => {
  const argv = (args || []).map(String);
  calls.push(argv);
  const joined = argv.join(" ");
  const after = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  if (argv[0] === "issue" && argv[1] === "list") {
    const label = after("-l") || after("--label");
    const wanted = label ? issues.filter((issue) => (issue.labels || []).indexOf(label) !== -1) : issues;
    return JSON.stringify(wanted.map(view));
  }
  if (argv[0] === "issue" && argv[1] === "view") {
    const issue = find(argv[2]) || stub(argv[2]);
    const fields = after("--json") || "";
    if (fields.indexOf("closedByPullRequestsReferences") !== -1) {
      return JSON.stringify(issue.mergedPr ? ["MERGED"] : []);
    }
    return JSON.stringify(view(issue));
  }
  if (argv[0] === "issue") {
    return argv[1] === "create" ? "https://example.invalid/issues/900\\n" : "";
  }
  if (argv[0] === "api") {
    const route = argv[1] || "";
    if (route.indexOf("matching-refs") !== -1) return "[]";
    if (route.slice(-11) === "/dispatches") return "";
    const named = /\\/issues\\/(\\d+)\\//.exec(route + "/");
    const issue = named ? find(named[1]) || stub(named[1]) : undefined;
    const mutating =
      /\\b(POST|PATCH|PUT|DELETE)\\b/.test(joined) ||
      argv.some((arg) => /^(-f|-F|--field|--raw-field)$/.test(arg));
    if (mutating) return "{}";
    if (route.indexOf("blocked_by") !== -1 || route.indexOf("blocking") !== -1) {
      const blockers = (issue && issue.blockedBy) || [];
      return JSON.stringify(
        blockers.map((n) => {
          const open = find(n);
          return { number: Number(n), state: open ? "open" : "closed", state_reason: open ? null : "completed" };
        }),
      );
    }
    if (route.indexOf("sub_issue") !== -1) {
      const children = (issue && issue.children) || [];
      return JSON.stringify(children.map((n) => view(find(n) || stub(n))));
    }
    if (route.indexOf("/comments") !== -1) return JSON.stringify(issue ? commentsOf(issue) : []);
    if (route.indexOf("/labels") !== -1) return JSON.stringify(issue ? labelsOf(issue) : []);
    return "[]";
  }
  return "";
};
(async () => {
  let outcome = null;
  let error = null;
  try {
    const mod = await import(MODULE);
    outcome = await mod.runReconcile({ gh: gh, log: () => {} });
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  console.log("PROBE:" + JSON.stringify({ calls: calls, outcome: outcome, error: error }));
})();
`;

/** Runs lane 09's reconciler against `scenario` and returns every call it made. */
export function runReconcilePass(scenario: Scenario): ReconcileProbe {
  const run = runTsx(RECONCILE_PROBE, {
    PROBE_MODULE: moduleUrl(RECONCILE_SOURCE),
    PROBE_SCENARIO: JSON.stringify(scenario),
  });
  return probeResult<ReconcileProbe>(run);
}

/** Whether an argv is a write rather than a read — a `--jq` naming a marker is not a write. */
function isWrite(call: string[]): boolean {
  if (call[0] === "issue") {
    return ["comment", "create", "edit", "close", "reopen", "delete"].includes(call[1] ?? "");
  }
  if (call[0] === "api") {
    const joined = call.join(" ");
    if (/\b(POST|PATCH|PUT|DELETE)\b/.test(joined)) return true;
    return call.some((arg) => /^(-f|-F|--field|--raw-field)$/.test(arg) || /^-[fF]\S/.test(arg));
  }
  return false;
}

/** Every write whose argv carries `marker` — the calls that put it on the tracker. */
export function markerWrites(calls: string[][], marker: string): string[][] {
  return calls.filter((call) => isWrite(call) && call.some((arg) => arg.includes(marker)));
}

export interface LabelWrites {
  added: string[];
  removed: string[];
}

/**
 * The label names a run put on and took off, however the write is spelled: `gh issue edit`'s
 * `--add-label`/`--remove-label` (comma-separated lists included), a REST `POST .../labels` with
 * `labels[]=` fields, or a `DELETE .../labels/<name>`.
 */
export function labelWrites(calls: string[][]): LabelWrites {
  const added: string[] = [];
  const removed: string[] = [];
  const push = (sink: string[], value: string | undefined): void => {
    for (const name of String(value ?? "").split(",")) {
      const trimmed = name.trim().replace(/^["']|["']$/g, "");
      if (trimmed.length > 0) sink.push(trimmed);
    }
  };

  for (const call of calls) {
    call.forEach((arg, index) => {
      if (arg === "--add-label") push(added, call[index + 1]);
      if (arg === "--remove-label") push(removed, call[index + 1]);
      const inline = /^--(add|remove)-label=(.+)$/.exec(arg);
      if (inline) push(inline[1] === "add" ? added : removed, inline[2]);
    });

    if (call[0] !== "api") continue;
    const joined = call.join(" ");
    if (!/\/labels\b/.test(joined) && !call.some((arg) => /^labels(\[\])?=/.test(arg))) continue;
    const names: string[] = [];
    const fromRoute = /\/labels\/([^\s/]+)/.exec(joined);
    if (fromRoute) names.push(decodeURIComponent(fromRoute[1]));
    for (const arg of call) {
      const field = /^labels(?:\[\])?=(.+)$/.exec(arg);
      if (field) names.push(field[1]);
    }
    const deleting = /\bDELETE\b/.test(joined);
    for (const name of names) push(deleting ? removed : added, name);
  }

  return { added, removed };
}

/** A spec body carrying exactly one well-formed check-marked criterion. */
export const RUNNABLE_SPEC_BODY = [
  "## Problem Statement",
  "A spec closes when its tickets close. Nothing ever asks whether the product does the thing.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
  "",
].join("\n");

/** A spec body carrying two criteria — a shape the closer cannot run, so a refusal. */
export const UNRUNNABLE_SPEC_BODY = [
  "## Problem Statement",
  "Two behavioural claims are two specs.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] I'll know it works when I can see a verdict on the spec — check: `true`",
  "- [ ] And also when I can see the second thing — check: `true`",
  "",
].join("\n");

/** A published slice, as `render-body.ts` writes one: the `## Parent PRD` heading is the trace. */
export function sliceBody(prd: number): string {
  return [
    "## Parent PRD",
    `#${prd}`,
    "",
    "## What to build",
    "The tracer.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The tracer runs end to end — check: `true`",
    "",
    "## Files claimed",
    "- None — no files.",
    "",
  ].join("\n");
}

/**
 * A refusal comment this pass left on an earlier session — what pairs a `needs-human` with this
 * pass rather than with another lane.
 *
 * Both spellings of the marker are present because this fixture does not get to choose the one the
 * implementation reads for: a bracketed HTML comment is the estate's idiom, and a reader looking
 * for either the bare `prd-unrunnable:v1` substring or the bracketed form finds it here. What the
 * criterion is about is the pairing, not the punctuation.
 */
export const OWN_REFUSAL_COMMENT = [
  "Could not run this spec's check: its body carries two acceptance criteria.",
  "",
  "<!-- prd-unrunnable:v1 -->",
  "<!-- [prd-unrunnable:v1] -->",
].join("\n");
