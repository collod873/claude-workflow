import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { moduleUrl, probeResult, runTsx } from "./237-spec-pass.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The readers #262's acceptance tests share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one.
 *
 * It exists because six of this ticket's seven criteria have to reach modules living outside
 * `tests/acceptance/`, and the only honest way to do that is to run them the way a shell would:
 * `npx tsx -e` a few lines that import the subject by absolute file URL and print what it did. The
 * spawn-and-parse plumbing is already here (`runTsx`, `probeResult`, `moduleUrl` from #237's
 * fixture), so what this file adds is the two drivers the criteria actually need — one that calls
 * `runSpecReconciler` directly, one that drives a whole lane door — plus the body readers that turn
 * what came back into the facts the criteria are about.
 *
 * **One response for every stage.** The fake `StageExec` answers every call with the same JSON
 * object, and that object carries every field the author's, the critic's and the reconciler's
 * schemas ask for. Zod strips what a schema does not name, so a superset parses everywhere — which
 * means these probes do not care how many model stages the lane runs or in what order. That matters
 * because a sweep stage ahead of the author is a sibling slice of this same PRD: a probe that
 * queued its responses by position would go wrong the day that lands, for a reason having nothing
 * to do with #262.
 */

function lane(...parts: string[]): string {
  return path.join(repoRoot, ".Workflow", "agent-workflows", ...parts);
}

export const CRITIC_SOURCE = lane("spec", "critic.ts");

/** Lane 02's reconciler — not lane 09's, which #237's fixture names `RECONCILE_SOURCE`. */
export const SPEC_RECONCILE_SOURCE = lane("spec", "reconcile.ts");

export const SPEC_SOURCE = lane("spec", "spec.ts");

/** `sheetMarker` and `acceptedMarker`, so the sheet door's collector reads a real marker payload. */
export const MARKER_SOURCE = lane("shape", "marker.ts");

/** What the critic hands back per finding it decided: what it decided, and why — two fields. */
export interface Resolution {
  decision: string;
  reason: string;
}

/** One of a sheet's decisions, in the shape `collectSheetContext` carries out to the gate. */
export interface MarkedDecision {
  question: string;
  recommendation: string;
  rejected: string;
  mark: string;
  adrTitle: string;
}

export const SPEC_TITLE = "PRD: A spec written in a session";

/**
 * Two resolutions in plain prose — no leading quotes, no markdown of their own, so a body that
 * folded them in carries each string byte for byte whatever wrapper the writer puts around it.
 */
export const RESOLUTIONS: Resolution[] = [
  {
    decision:
      "Gracefully handled errors means the stage exits non-zero and prints the reason it stopped.",
    reason:
      "The phrase admitted two implementations and every neighbouring criterion names an observable exit code.",
  },
  {
    decision: "The retry belongs to the caller, and the transport never retries.",
    reason:
      "Nothing filed puts a retry in the transport, and the caller is where the intent already lives.",
  },
];

export const CRITERIA = [
  "- [ ] The stage exits non-zero and prints the reason — check: `npx vitest run .Workflow/agent-workflows/spec/reconcile.test.ts`",
  "- [ ] The caller retries once and the transport never does — check: `bin/gauntlet push`",
];

/** Criteria carrying the punctuation a rewrite is most likely to normalise away. */
export const TRICKY_CRITERIA = [
  "- [ ] A criterion carrying **bold**, a `code span` and a trailing note (see #236) — check: `npx vitest run .Workflow/agent-workflows/spec/reconcile.test.ts`",
  "- [ ] A criterion whose check quotes a path — check: `grep -q 'ticket-shape' .Workflow/agent-workflows/spec/reconcile.ts`",
];

/** A spec body carrying one checkbox line per criterion, and no assumptions section of its own. */
export function specBody(criteria: string[] = CRITERIA): string {
  return [
    "## Problem Statement",
    "",
    "The lane asks the owner questions he cannot answer.",
    "",
    "## Acceptance criteria",
    "",
    ...criteria,
    "",
  ].join("\n");
}

/**
 * The one response every model stage in a lane probe gets: a superset of the author's, the critic's,
 * the reconciler's and the sweep's wire shapes.
 *
 * `rulings` is the sweep's `{ref, quote}` list rather than the one prose line this first carried.
 * The superset was written to survive the sibling slice landing a sweep ahead of the author, and it
 * does — but a superset only parses everywhere if every field it names is the shape its own schema
 * asks for, and this one guessed prose where `spec/sweep.ts` declares an array. Nothing else in the
 * lane reads `rulings` off the wire: the author's own `rulings` is a rendered string the sweep hands
 * it, never a field a stage returns.
 */
export function stageResponse(body: string, resolutions: Resolution[]): string {
  return JSON.stringify({
    title: SPEC_TITLE,
    body,
    openQuestions: [],
    findings: [],
    resolutions,
    rulings: [
      { ref: "ADR-0060", quote: "the lane reaches no second source of intent." },
    ],
    decisions: [],
  });
}

/** The reconciler's own wire shape, on its own — one stage, so no superset is needed. */
export function reconcilerResponse(body: string): string {
  return JSON.stringify({ body });
}

/**
 * The input `runSpecReconciler` is handed. `resolutions` is what #262 repoints it onto; the other
 * lists are passed empty under the names a caller might plausibly reach them by, so a probe never
 * fails on an absent field rather than on the behaviour the criterion is about.
 */
export function reconcileInput(
  body: string,
  resolutions: Resolution[],
): Record<string, unknown> {
  return {
    title: SPEC_TITLE,
    body,
    resolutions,
    answers: [],
    unfiledMarks: [],
    marks: [],
  };
}

/**
 * The lines under a `## Assumptions` heading, up to the next second-level heading — `null` when the
 * body carries no such heading. The heading is a fixed string by design, so it is matched as one.
 */
export function assumptionsSection(body: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Assumptions");
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Every checkbox line in a body — the lines the never-drop arithmetic counts. */
export function checkboxLines(body: string): string[] {
  return body.split("\n").filter((line) => /^\s*- \[[ xX]\]/.test(line));
}

/** Each body a run put on the tracker, in order, with the verb that put it there. */
export function bodyWrites(calls: string[][]): Array<{ verb: string; body: string }> {
  return calls
    .filter(
      (call) =>
        call[0] === "issue" &&
        (call[1] === "edit" || call[1] === "create") &&
        call.includes("--body"),
    )
    .map((call) => ({ verb: String(call[1]), body: String(call[call.indexOf("--body") + 1]) }));
}

/** The body a run left standing on the tracker, whether it created it or edited it in. */
export function lastBody(calls: string[][]): string | undefined {
  const writes = bodyWrites(calls);
  return writes.length === 0 ? undefined : writes[writes.length - 1].body;
}

/**
 * The `repository_dispatch` calls a run made. Matched on the word the route ends in rather than on
 * a hand-written REST path, which this directory's lint rule forbids.
 */
export function dispatches(calls: string[][]): string[][] {
  return calls.filter((call) => call[0] === "api" && call.some((arg) => arg.includes("dispatches")));
}

/**
 * Runs a probe and parses its result, turning a child that never reported into a value carrying the
 * failure rather than an exception — so a criterion goes red on an assertion, with the child's own
 * streams in the message, instead of blowing up the file.
 *
 * **Every probe gets its own checkpoint directory.** `runStage` consults a real on-disk checkpoint
 * before it spawns (`shared/stage.ts`): `<stage>.json` under `CHECKPOINTS_DIR`, keyed on
 * `sha256(HEAD + "\0" + the substituted prompt)`. On a key hit it returns the stored response and
 * never calls `exec` at all — so a second probe that drives the same stage over the same prompt
 * silently reads the *first* probe's canned answer, with the fake `StageExec` it injected sitting
 * untouched. `isolate-checkpoints.setup.ts` gives one directory per *test*, which is the right
 * grain for an in-process test and the wrong one here: a criterion in this directory is a pair of
 * runs inside one `it`, each of them a whole separate lane run, and a child inherits whatever
 * directory the test was given. #262's three criteria all read as satisfied-then-broken that way —
 * a reasonless payload "accepted" because the well-formed one before it had been cached, a lane
 * spending zero stages because the control run had cached them, a rewrite refused for the previous
 * probe's short body.
 *
 * A caller that names `CHECKPOINTS_DIR` itself still wins: #272's probes hand their own directory
 * in because what they are *about* is what a checkpoint does.
 */
export function runProbe<T extends { error: string | null }>(
  script: string,
  env: Record<string, string>,
  fallback: T,
): T {
  const checkpoints = mkdtempSync(path.join(tmpdir(), "acceptance-checkpoints-"));
  try {
    const run = runTsx(script, { CHECKPOINTS_DIR: checkpoints, ...env });
    try {
      return probeResult<T>(run);
    } catch (err) {
      return { ...fallback, error: err instanceof Error ? err.message : String(err) };
    }
  } finally {
    rmSync(checkpoints, { recursive: true, force: true });
  }
}

export interface ReconcileProbe {
  /** The body the reconciler resolved to, or `null` when it refused. */
  body: string | null;
  /** Every argv the reconciler handed its injected `StageExec`. */
  calls: string[][];
  error: string | null;
}

const RECONCILE_PROBE = `
const MODULE = process.env.PROBE_MODULE;
const RESPONSE = process.env.PROBE_RESPONSE || "";
const INPUT = JSON.parse(process.env.PROBE_INPUT || "{}");

const calls = [];
const flatten = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch (err) { return "[object]"; }
  }
  return String(value);
};
const exec = async (...args) => {
  calls.push(args.map(flatten));
  return RESPONSE;
};

(async () => {
  let body = null;
  let error = null;
  try {
    const mod = await import(MODULE);
    const returned = await mod.runSpecReconciler(exec, INPUT);
    body =
      typeof returned === "string"
        ? returned
        : returned && typeof returned.body === "string"
          ? returned.body
          : null;
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  console.log("PROBE:" + JSON.stringify({ body: body, calls: calls, error: error }));
})();
`;

/** Runs the real `runSpecReconciler` over one body and one resolutions list. */
export function probeReconciler(input: {
  body: string;
  resolutions: Resolution[];
  response: string;
}): ReconcileProbe {
  return runProbe<ReconcileProbe>(
    RECONCILE_PROBE,
    {
      PROBE_MODULE: moduleUrl(SPEC_RECONCILE_SOURCE),
      PROBE_INPUT: JSON.stringify(reconcileInput(input.body, input.resolutions)),
      PROBE_RESPONSE: input.response,
    },
    { body: null, calls: [], error: null },
  );
}

/** One run of a lane door, as a scenario declares it. */
export interface LaneScenario {
  /** `"sheet"` runs the cold door through the collector; `"critique"` the warm one. */
  door: "sheet" | "critique";
  specNumber?: number;
  specTitle?: string;
  specBody?: string;
  comments?: string[];
  sourceNumber?: number;
  ownerWords?: string;
  decisions?: MarkedDecision[];
  publishedNumber?: number;
}

export interface LaneProbe {
  /** Every `gh` argv the run issued, in order. */
  calls: string[][];
  /** Every model stage the run spent, in order. */
  stages: string[][];
  result: Record<string, unknown> | null;
  /** Non-null when the sheet marker could not be built — a fact about the fake, not the ticket. */
  setupError: string | null;
  error: string | null;
}

const LANE_PROBE = `
const MODULE = process.env.PROBE_MODULE;
const MARKER = process.env.PROBE_MARKER;
const RESPONSE = process.env.PROBE_RESPONSE || "";
const scenario = JSON.parse(process.env.PROBE_SCENARIO || "{}");

const calls = [];
const stages = [];

const flatten = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch (err) { return "[object]"; }
  }
  return String(value);
};
const exec = async (...args) => {
  stages.push(args.map(flatten));
  return RESPONSE;
};

const pluck = (value, dotted) => {
  let current = value;
  for (const key of String(dotted).split(".")) {
    if (current === null || current === undefined) return current;
    current = current[key];
  }
  return current;
};
const listQuery = (value, query) => {
  const inner = query.slice(1, -1).trim();
  const at = inner.indexOf("[]");
  if (at === -1) return [];
  const base = inner.slice(0, at).trim();
  let rest = inner.slice(at + 2).trim();
  if (rest.charAt(0) === "|") rest = rest.slice(1).trim();
  const source = base === "" || base === "." ? value : pluck(value, base.slice(1));
  const list = Array.isArray(source) ? source : [];
  return rest.charAt(0) === "." ? list.map((entry) => pluck(entry, rest.slice(1))) : list;
};
const jq = (value, expr) => {
  if (!expr) return JSON.stringify(value);
  const query = String(expr).trim();
  if (query.charAt(0) === "[") return JSON.stringify(listQuery(value, query));
  if (query.charAt(0) === ".") {
    const picked = query.length === 1 ? value : pluck(value, query.slice(1));
    return typeof picked === "string" ? picked : JSON.stringify(picked);
  }
  return JSON.stringify(value);
};

let sourceComments = [];

const gh = (args) => {
  const argv = Array.from(args).map(String);
  calls.push(argv);
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  if (argv[0] === "issue" && argv[1] === "view") {
    const number = Number(argv[2]);
    const isSource = number === Number(scenario.sourceNumber);
    const comments = isSource ? sourceComments : scenario.comments || [];
    const payload = {
      number: number,
      title: isSource ? "An accepted idea" : scenario.specTitle,
      body: isSource ? scenario.ownerWords : scenario.specBody,
      comments: comments.map((text) => ({ body: text })),
      labels: [],
      state: "OPEN",
    };
    return jq(payload, flag("--jq"));
  }
  if (argv[0] === "issue" && argv[1] === "create") {
    return "https://example.invalid/issues/" + String(scenario.publishedNumber || 9001) + "\\n";
  }
  return "";
};

(async () => {
  let result = null;
  let error = null;
  let setupError = null;
  try {
    const marker = await import(MARKER);
    sourceComments = [
      marker.sheetMarker({
        restatement: "the idea as work",
        priorArt: [],
        decisions: scenario.decisions || [],
        survivors: [],
        route: "short",
        routeReason: "Short — one file.",
        newTerms: [],
        round: 0,
      }),
      marker.acceptedMarker({ adrPaths: [], coinedTerms: [], route: "short" }),
    ];
  } catch (err) {
    setupError = err && err.message ? err.message : String(err);
  }
  try {
    const mod = await import(MODULE);
    result =
      scenario.door === "sheet"
        ? await mod.runSpecPublication(
            exec,
            gh,
            { mode: "publish", source: { kind: "sheet", issue: Number(scenario.sourceNumber) } },
            { kind: "sheet", gh: gh, issueNumber: Number(scenario.sourceNumber) },
          )
        : await mod.runSpecCritique(exec, gh, Number(scenario.specNumber));
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  console.log(
    "PROBE:" +
      JSON.stringify({
        calls: calls,
        stages: stages,
        result: result === undefined ? null : result,
        setupError: setupError,
        error: error,
      }),
  );
})();
`;

/** Runs one of lane 02's two doors end to end against a fake tracker, and reports what it did. */
export function probeLane(scenario: LaneScenario, response: string): LaneProbe {
  return runProbe<LaneProbe>(
    LANE_PROBE,
    {
      PROBE_MODULE: moduleUrl(SPEC_SOURCE),
      PROBE_MARKER: moduleUrl(MARKER_SOURCE),
      PROBE_SCENARIO: JSON.stringify({
        specNumber: 180,
        specTitle: SPEC_TITLE,
        specBody: specBody(),
        comments: [],
        sourceNumber: 42,
        ownerWords: "make the accept file its own rulings",
        decisions: [],
        publishedNumber: 9001,
        ...scenario,
      }),
      PROBE_RESPONSE: response,
    },
    { calls: [], stages: [], result: null, setupError: null, error: null },
  );
}
