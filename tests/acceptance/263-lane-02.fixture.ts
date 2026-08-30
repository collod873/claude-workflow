import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The out-of-process reader #263's lane 02 criteria share.
 *
 * Not a `.test.ts`, so vitest's acceptance include never collects it as a suite - it is only ever
 * imported by one.
 *
 * It exists because four of this ticket's six criteria ask the same question of the same lane -
 * given this tracker and this stage output, what did the run write? - and the machinery for asking
 * it is a fake `gh`, a fake stage executor and a child process. Copied into four files that is
 * four fakes to get subtly different from each other; here it is one.
 *
 * Why a child process: CI restores `tests/acceptance/` from trunk and restores only that
 * directory, so nothing here may import the subject - an import is a specifier the branch under
 * test controls. The lane is reached the way a shell reaches it instead: `npx tsx -e` over a
 * script that imports `spec.ts`, `open-questions.ts`, `publish.ts` and `shape/marker.ts` by
 * absolute file URL, drives them through their own injected seams, and prints one PROBE: line.
 *
 * The seams are the lane's own: `GhExec`, whose every argv is recorded, and `StageExec`, which
 * answers with one canned payload and records that a model ran at all. Every assertion in the
 * tests beside this file lands on those two records - what the lane wrote to the tracker, and
 * whether a model ran - because that is what a caller of lane 02 can observe.
 */

const laneRoot = path.join(repoRoot, ".Workflow", "agent-workflows");

export const SPEC_SOURCE = path.join(laneRoot, "spec", "spec.ts");
export const OPEN_QUESTIONS_SOURCE = path.join(laneRoot, "spec", "open-questions.ts");
export const PUBLISH_SOURCE = path.join(laneRoot, "spec", "publish.ts");
export const MARKER_SOURCE = path.join(laneRoot, "shape", "marker.ts");
export const ROUNDS_SOURCE = path.join(laneRoot, "spec", "rounds.ts");
export const ROUNDS_TEST_SOURCE = path.join(laneRoot, "spec", "rounds.test.ts");

/**
 * Every SPEC_TRIGGER spelling a cold door could plausibly carry - the two this lane has today,
 * plus the names the one hand label could take after it. A trigger the lane does not accept is
 * reported as such and skipped, so the list costs nothing but covers the rename.
 */
export const COLD_TRIGGERS = ["sheet", "map", "to-spec", "label", "source"];

export interface FakeIssue {
  number: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
  comments?: string[];
}

/** A spec already carrying `sliceable`, recording `sourceIssue` as the source it was drafted from. */
export interface SliceableSpec {
  number: number;
  sourceKind: string;
  sourceIssue: number;
}

export interface ProbeRequest {
  entry: "gate" | "plan" | "lane" | "critique";
  issueNumber?: number;
  triggers?: string[];
  counts?: Array<number | null>;
  scenario?: { issues: FakeIssue[] };
  /** Issues whose comments should carry a real sheet marker and a real accept marker. */
  sheetMarked?: number[];
  sliceableSpecs?: SliceableSpec[];
  stageResponse?: string;
}

export interface StageCall {
  argv: string[];
  rest: unknown;
}

export interface LaneRun {
  accepted?: boolean;
  plan?: unknown;
  result?: unknown;
  error: string | null;
  stageCalls: StageCall[];
  calls: string[][];
}

export interface GateRun {
  count: number | null;
  outcome: string | null;
  error: string | null;
  calls: string[][];
}

export interface Probe {
  entry: string;
  error: string | null;
  constants: { sliceableLabel: string; dispatchEventType: string };
  runs: GateRun[];
  triggers: Record<string, LaneRun>;
  run: LaneRun | null;
}

/**
 * The probe, as plain JavaScript run through `tsx -e`.
 *
 * `String.raw` so a backslash escape written here reaches the child as an escape rather than as a
 * newline in this file's own source.
 */
const PROBE_SOURCE = String.raw`
const MODULES = JSON.parse(process.env.PROBE_MODULES || "{}");
const REQUEST = JSON.parse(process.env.PROBE_REQUEST || "{}");

(async () => {
  const out = {
    entry: REQUEST.entry || "",
    error: null,
    constants: { sliceableLabel: "sliceable", dispatchEventType: "prd-sliceable" },
    runs: [],
    triggers: {},
    run: null,
  };
  const calls = [];
  const safeJson = (value) => {
    try {
      return value === undefined ? null : JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  };

  try {
    const cp = await import("node:child_process");

    const issues = (((REQUEST.scenario || {}).issues) || []).map((issue) => ({
      number: Number(issue.number),
      title: issue.title || "",
      body: issue.body || "",
      state: issue.state || "OPEN",
      labels: (issue.labels || []).slice(),
      comments: (issue.comments || []).slice(),
    }));
    const findIssue = (number) => issues.find((issue) => issue.number === Number(number));

    if ((REQUEST.sheetMarked || []).length > 0) {
      const marker = await import(MODULES.marker);
      const sheet = {
        restatement: "the idea as work",
        priorArt: [],
        decisions: [
          {
            question: "which module owns the retry?",
            recommendation: "the caller",
            rejected: "the transport",
            mark: "shared/gh.ts",
            adrTitle: "A ruling that files it",
          },
        ],
        survivors: [],
        route: "short",
        routeReason: "Short - one file.",
        newTerms: [],
        round: 0,
      };
      const accepted = { adrPaths: [], coinedTerms: [], route: "short" };
      for (const number of REQUEST.sheetMarked) {
        const issue = findIssue(number);
        if (issue) {
          issue.comments = issue.comments.concat([
            marker.sheetMarker(sheet),
            marker.acceptedMarker(accepted),
          ]);
        }
      }
    }

    if ((REQUEST.sliceableSpecs || []).length > 0) {
      const publish = await import(MODULES.publish);
      for (const already of REQUEST.sliceableSpecs) {
        issues.push({
          number: Number(already.number),
          title: "PRD: a spec that already dispatched",
          body: [
            "## Problem Statement",
            "",
            "Already sliced, already dispatched.",
            "",
            publish.sourceMarker({ kind: already.sourceKind, issue: Number(already.sourceIssue) }),
          ].join("\n"),
          state: "OPEN",
          labels: ["prd", "sliceable"],
          comments: [],
        });
      }
    }

    const view = (issue, fields) => {
      const full = {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        stateReason: null,
        state_reason: null,
        url: "https://example.invalid/issues/" + issue.number,
        labels: issue.labels.map((name) => ({ name: name })),
        comments: issue.comments.map((body, index) => ({
          id: issue.number * 100 + index,
          body: body,
          author: { login: "owner" },
          user: { login: "owner" },
          createdAt: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
        })),
      };
      if (!fields) return full;
      const picked = {};
      for (const field of String(fields).split(",")) {
        const key = field.trim();
        if (key.length > 0) picked[key] = full[key] === undefined ? null : full[key];
      }
      return picked;
    };

    const gh = (args) => {
      const argv = Array.from(args || []).map(String);
      calls.push(argv);
      const flag = (name) => {
        const index = argv.indexOf(name);
        return index === -1 ? undefined : argv[index + 1];
      };
      const jq = flag("--jq") || flag("-q");
      const emit = (value) => {
        const json = typeof value === "string" ? value : JSON.stringify(value);
        if (!jq) return json;
        try {
          const filtered = cp.spawnSync("jq", ["-r", jq], { input: json, encoding: "utf8" });
          if (filtered && filtered.status === 0) return String(filtered.stdout || "");
        } catch {
          // no jq on this machine: unfiltered JSON is the best answer available
        }
        return json;
      };
      const fields = flag("--json");
      if (argv[0] === "issue" && argv[1] === "view") {
        const found = findIssue(argv[2]);
        const issue = found || {
          number: Number(argv[2]),
          title: "",
          body: "",
          state: "OPEN",
          labels: [],
          comments: [],
        };
        return emit(view(issue, fields));
      }
      if (argv[0] === "issue" && argv[1] === "list") {
        const label = flag("--label") || flag("-l");
        const state = String(flag("--state") || flag("-s") || "open").toLowerCase();
        let listed = issues.slice();
        if (label) listed = listed.filter((issue) => issue.labels.indexOf(label) !== -1);
        if (state !== "all") {
          listed = listed.filter((issue) => String(issue.state).toLowerCase() === state);
        }
        return emit(listed.map((issue) => view(issue, fields)));
      }
      if (argv[0] === "search" && argv[1] === "issues") {
        return emit(issues.map((issue) => view(issue, fields)));
      }
      if (argv[0] === "issue" && argv[1] === "create") {
        return "https://example.invalid/issues/900\n";
      }
      if (argv[0] === "issue") return "";
      if (argv[0] === "api") {
        return emit(String(argv[1] || "") === "graphql" ? { data: {} } : []);
      }
      return "";
    };

    const makeExec = (stageCalls) => async function () {
      const args = Array.prototype.slice.call(arguments);
      stageCalls.push({
        argv: Array.isArray(args[0]) ? args[0].map(String) : [],
        rest: safeJson(args.slice(1)),
      });
      return REQUEST.stageResponse || "{}";
    };

    const oq = await import(MODULES.openQuestions);
    out.constants = {
      sliceableLabel: oq.SLICEABLE_LABEL || "sliceable",
      dispatchEventType: oq.SPEC_DISPATCH_EVENT_TYPE || "prd-sliceable",
    };

    if (REQUEST.entry === "gate") {
      for (const count of REQUEST.counts || [null]) {
        calls.length = 0;
        let outcome = null;
        let error = null;
        try {
          outcome = count === null
            ? oq.applyGate(gh, Number(REQUEST.issueNumber))
            : oq.applyGate(gh, Number(REQUEST.issueNumber), count);
        } catch (err) {
          error = String((err && err.message) || err);
        }
        out.runs.push({
          count: count === undefined ? null : count,
          outcome: outcome === undefined ? null : outcome,
          error: error,
          calls: calls.map((call) => call.slice()),
        });
      }
    } else {
      const spec = await import(MODULES.spec);

      const accepts = (trigger) => {
        if (typeof spec.invocationFromEnv !== "function") return true;
        try {
          spec.invocationFromEnv({ SPEC_TRIGGER: trigger, ISSUE_NUMBER: String(REQUEST.issueNumber) });
          return true;
        } catch {
          return false;
        }
      };

      const planFor = (trigger) => {
        if (typeof spec.planSpecRun !== "function") {
          throw new Error("spec.ts exports no planSpecRun");
        }
        return spec.planSpecRun(gh, { trigger: trigger, issueNumber: Number(REQUEST.issueNumber) });
      };

      if (REQUEST.entry === "plan") {
        for (const trigger of REQUEST.triggers || []) {
          calls.length = 0;
          const accepted = accepts(trigger);
          let planned = null;
          let error = null;
          if (accepted) {
            try {
              planned = planFor(trigger);
            } catch (err) {
              error = String((err && err.message) || err);
            }
          }
          out.triggers[trigger] = {
            accepted: accepted,
            plan: safeJson(planned),
            result: null,
            error: error,
            stageCalls: [],
            calls: calls.map((call) => call.slice()),
          };
        }
      } else if (REQUEST.entry === "lane") {
        for (const trigger of REQUEST.triggers || []) {
          if (!accepts(trigger)) {
            out.triggers[trigger] = {
              accepted: false,
              plan: null,
              result: null,
              error: null,
              stageCalls: [],
              calls: [],
            };
            continue;
          }
          calls.length = 0;
          const stageCalls = [];
          const exec = makeExec(stageCalls);
          let planned = null;
          let result = null;
          let error = null;
          try {
            planned = planFor(trigger);
            if (planned && planned.path === "critique") {
              result = await spec.runSpecCritique(exec, gh, planned.issueNumber);
            } else if (planned && planned.input) {
              result = await spec.runSpecPublication(exec, gh, planned.target, planned.input);
            }
          } catch (err) {
            error = String((err && err.message) || err);
          }
          out.triggers[trigger] = {
            accepted: true,
            plan: safeJson(planned),
            result: safeJson(result),
            error: error,
            stageCalls: stageCalls,
            calls: calls.map((call) => call.slice()),
          };
        }
      } else if (REQUEST.entry === "critique") {
        calls.length = 0;
        const stageCalls = [];
        const exec = makeExec(stageCalls);
        let result = null;
        let error = null;
        try {
          if (typeof spec.runSpecCritique === "function") {
            result = await spec.runSpecCritique(exec, gh, Number(REQUEST.issueNumber));
          } else {
            const planned = planFor("critique");
            result = planned && planned.input
              ? await spec.runSpecPublication(exec, gh, planned.target, planned.input)
              : null;
          }
        } catch (err) {
          error = String((err && err.message) || err);
        }
        out.run = {
          plan: null,
          result: safeJson(result),
          error: error,
          stageCalls: stageCalls,
          calls: calls.map((call) => call.slice()),
        };
      }
    }
  } catch (err) {
    out.error = String((err && err.stack) || err);
  }

  console.log("PROBE:" + JSON.stringify(out));
})().catch((err) => {
  console.log("PROBE:" + JSON.stringify({
    entry: "",
    error: String((err && err.stack) || err),
    constants: { sliceableLabel: "sliceable", dispatchEventType: "prd-sliceable" },
    runs: [],
    triggers: {},
    run: null,
  }));
});
`;

/** A module specifier a child process can import - an absolute file URL, never a path. */
function moduleUrl(file: string): string {
  return pathToFileURL(file).href;
}

/**
 * Runs the probe and returns what the lane did.
 *
 * The handoff-file variable is cleared from the child's environment on purpose: with it set,
 * `shared/dispatch-request.ts` records the dispatch to a file instead of asking `gh` for it, and
 * the request would then be invisible to a reader of the call log.
 */
export function runProbe(request: ProbeRequest): Probe {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DISPATCH_REQUESTS_PATH;
  env.PROBE_MODULES = JSON.stringify({
    spec: moduleUrl(SPEC_SOURCE),
    openQuestions: moduleUrl(OPEN_QUESTIONS_SOURCE),
    publish: moduleUrl(PUBLISH_SOURCE),
    marker: moduleUrl(MARKER_SOURCE),
  });
  env.PROBE_REQUEST = JSON.stringify(request);

  const attempts: Array<[string, string[]]> = [
    ["npx", ["--no-install", "tsx", "-e", PROBE_SOURCE]],
    ["npx", ["tsx", "-e", PROBE_SOURCE]],
    ["node", ["--import", "tsx", "-e", PROBE_SOURCE]],
  ];

  const diagnostics: string[] = [];
  for (const [command, args] of attempts) {
    const run = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      env,
      timeout: 240_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const stdout = run.stdout ?? "";
    const line = stdout
      .split("\n")
      .reverse()
      .find((candidate) => candidate.startsWith("PROBE:"));
    if (line !== undefined) return JSON.parse(line.slice("PROBE:".length)) as Probe;
    diagnostics.push(command + " " + args[1] + ": exit " + String(run.status) + "\n" + stdout + "\n" + (run.stderr ?? ""));
  }

  throw new Error("could not run lane 02 out of process:\n" + diagnostics.join("\n---\n"));
}

/** The label names one call puts on, however the write is spelled. */
function labelsAdded(call: string[]): string[] {
  const names: string[] = [];
  const push = (value: string | undefined): void => {
    for (const name of String(value ?? "").split(",")) {
      const trimmed = name.trim();
      if (trimmed.length > 0) names.push(trimmed);
    }
  };
  call.forEach((arg, index) => {
    if (arg === "--add-label") push(call[index + 1]);
    else if (arg.startsWith("--add-label=")) push(arg.slice("--add-label=".length));
    else if (call[0] === "api" && arg.startsWith("labels[]=")) push(arg.slice("labels[]=".length));
    else if (call[0] === "api" && arg.startsWith("labels=")) push(arg.slice("labels=".length));
  });
  return names;
}

/** Every label the run put on, in the order it put them on. */
export function addedLabels(calls: string[][]): string[] {
  return calls.flatMap((call) => labelsAdded(call));
}

/** Where in the call log the run applied `label`, or -1 if it never did. */
export function labelAddIndex(calls: string[][], label: string): number {
  return calls.findIndex((call) => labelsAdded(call).includes(label));
}

/**
 * Where in the call log the run asked for the dispatch, or -1 if it never did.
 *
 * Matched on the event type the lane names rather than on a route, because the route is the one
 * thing a test in this directory may not spell out.
 */
export function dispatchRequestIndex(calls: string[][], eventType: string): number {
  return calls.findIndex((call) => call.some((arg) => arg.includes("event_type=" + eventType)));
}

/** The `gh issue create` calls a run made - what publishing looks like from outside. */
export function createdIssues(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "issue" && call[1] === "create");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Which collector a plan picked - the `kind` of the source it carries, wherever the plan keeps it.
 *
 * `SpecSource`'s two kinds are the vocabulary; where the plan hangs them is not what any criterion
 * is about, so all the places it could reasonably hang them are read.
 */
export function sourceKindOf(plan: unknown): string | null {
  const record = asRecord(plan);
  if (record === null) return null;
  const holders = [
    asRecord(record.input),
    asRecord(record.source),
    asRecord(asRecord(record.target)?.source),
  ];
  for (const holder of holders) {
    const kind = holder?.kind;
    if (typeof kind === "string" && kind.length > 0) return kind;
  }
  return typeof record.collector === "string" ? record.collector : null;
}

/** What the critic could not settle - the thing that used to hold the gate. */
const UNRESOLVED = "a criterion that admits two implementations was left standing.";

/** A published spec body carrying two acceptance criteria, as checkbox lines. */
export const SPEC_BODY = [
  "## Problem Statement",
  "",
  "Lane 02 asks the owner questions he cannot answer, and will not stop asking until he does.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The lane dispatches without asking the owner anything - check: `true`",
  "- [ ] The label lands before the dispatch is requested - check: `true`",
  "",
].join("\n");

/** The same two criteria, in the same order, with the assumption section written beneath them. */
export const REWRITTEN_BODY = [
  "## Problem Statement",
  "",
  "Lane 02 asks the owner questions he cannot answer, and will not stop asking until he does.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The lane dispatches without asking the owner anything - check: `true`",
  "- [ ] The label lands before the dispatch is requested - check: `true`",
  "",
  "## Assumptions",
  "",
  "- **The retry lives in the caller.** Nothing filed says otherwise, and the transport cannot see the budget.",
  "",
].join("\n");

/**
 * One canned stage payload, answering every stage this lane can run.
 *
 * It carries a draft (title and body), something the critic could not resolve - in each of the
 * fields such a thing could plausibly ride out on - and a resolution in the two fields the design
 * gives one. The body it returns carries the same checkbox lines as the body it was handed, in the
 * same order, so a rewrite made from it drops no criterion.
 */
export const STAGE_RESPONSE = JSON.stringify({
  title: "PRD: A spec the lane could not fully resolve",
  body: REWRITTEN_BODY,
  openQuestions: [UNRESOLVED],
  findings: [UNRESOLVED],
  unresolved: [UNRESOLVED],
  resolutions: [
    {
      decision: "The retry lives in the caller.",
      reason: "The transport cannot see the budget, and nothing filed says otherwise.",
    },
  ],
  assumptions: [
    {
      decision: "The retry lives in the caller.",
      reason: "The transport cannot see the budget, and nothing filed says otherwise.",
    },
  ],
  decisions: [],
});

/** A spec already on the tracker - the warm door's whole input. */
export function publishedSpecIssue(number: number): FakeIssue {
  return {
    number,
    title: "PRD: A spec written in a session",
    body: SPEC_BODY,
    state: "OPEN",
    labels: ["prd"],
    comments: [],
  };
}

/** An accepted idea, labelled by hand - a source whose spec has not been written yet. */
export function acceptedIdeaIssue(number: number): FakeIssue {
  return {
    number,
    title: "Make the accept file its own rulings",
    body: "make the accept file its own rulings",
    state: "OPEN",
    labels: ["idea", "approved", "to-spec"],
    comments: [],
  };
}

/** A closed map, labelled by the same hand and carrying no accept of its own. */
export function closedMapIssue(number: number): FakeIssue {
  return {
    number,
    title: "Wayfinder Map: where the retry lives",
    body: [
      "## Wayfinder Map",
      "",
      "The retry seam, mapped, with nowhere left to look.",
      "",
      "## Territory",
      "",
      "- shared/gh.ts",
      "",
    ].join("\n"),
    state: "CLOSED",
    labels: ["wayfinder-map", "to-spec"],
    comments: [],
  };
}
