import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { moduleUrl, probeResult, runTsx } from "./237-spec-pass.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The readers #261's acceptance tests share.
 *
 * Not a `.test.ts`, so it is never collected as a suite — it is only imported by the seven test
 * files beside it. It exists because five of #261's seven criteria ask the same question of the
 * same chain — "run lane 02's two entrances, and tell me which model stages ran, in what order,
 * with what argv, and what the author was handed" — and a spawn-and-parse driver copied into five
 * files is five copies to get subtly different.
 *
 * **Why a child process.** CI restores `tests/acceptance/` from trunk and only that directory, so a
 * test that imported lane 02 would be reaching through a specifier the branch under test controls.
 * The subject is reached the way a shell reaches it instead: `npx tsx -e` a driver that imports
 * `spec.ts` by absolute file URL and prints what the run did. The spawn-and-parse pair itself is
 * already written — `runTsx`/`probeResult` in `237-spec-pass.fixture.ts` — so it is imported rather
 * than restated.
 *
 * **Why the sweep's response is guessed rather than declared.** The sweep's structured-output shape
 * is the implementer's to choose within lane 01's PriorArt citation shape, and this directory may
 * not import it. So the driver runs the whole chain once per candidate payload until the real
 * `runStage` parser accepts one, and every candidate carries the same marker strings — the
 * assertions are about which marker reached the author, never about which field carried it. It
 * gives up early when the run failed *without* a sweep stage having been called at all, because
 * then the payload is not what the failure is about.
 */

const LANE_02 = path.join(repoRoot, ".Workflow", "agent-workflows", "spec");

/** The module #261 creates, and the one it re-points. */
export const SWEEP_SOURCE = path.join(LANE_02, "sweep.ts");
export const SPEC_SOURCE = path.join(LANE_02, "spec.ts");

/** The two check commands' own arguments, as they are spelled on the ticket. */
export const SWEEP_TEST_PATH = ".Workflow/agent-workflows/spec/sweep.test.ts";
export const SPEC_TEST_PATH = ".Workflow/agent-workflows/spec/spec.test.ts";

const MARKER_SOURCE = path.join(repoRoot, ".Workflow", "agent-workflows", "shape", "marker.ts");
const SHEET_COLLECTOR = path.join(LANE_02, "collectors", "sheet.ts");

/** A source file's text, or `""` when it does not exist — so a missing file fails an assertion
 * about its contents rather than throwing on the read. */
export function readSource(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/**
 * The strings the probe plants, each one traceable to exactly one source.
 *
 * `quote` contains `adrPath` on purpose: whichever field of the citation shape the implementer
 * renders into the author's rulings, one `toContain` covers both the quotation and the citation,
 * and no assertion has to guess a field name.
 */
export const MARKS = {
  /** A filed ruling the sheet and the map both forgot — the sweep is the only way it can arrive. */
  adrPath: "docs/adr/0104-the-sweep-reads-the-record-the-collectors-forgot.md",
  quote:
    "docs/adr/0104-the-sweep-reads-the-record-the-collectors-forgot.md — SWEEP-ONLY-RULING: no upstream sheet or map ever cited this line.",
  term: "SWEEP-ONLY-TERM",
  /** The one ruling the accepted sheet did cite — what a replaced rulings field must lose. */
  collectorAdrPath: "docs/adr/0060-only-the-accepted-sheet-cited-this-one.md",
  ownerWords: "make lane 02 read the rulings it has already filed",
  restatement: "the idea as work: a sweep ahead of the author",
  specTitle: "PRD: A spec the sweep ran ahead of",
  draftBody: "## Problem Statement -- lane 02 drafts against a partial memory of the record.",
  sessionBody: "## Problem Statement -- it stalls on the tracker.",
} as const;

/** One model stage the chain ran, as the fake `StageExec` saw it. */
export interface ProbeCall {
  /** `sweep` names the cheap model, `author` carries the allow-list, `critic` carries neither. */
  kind: "sweep" | "author" | "critic";
  argv: string[];
  /** Every string the stage was invoked with, argv and prompt alike, flattened. */
  blob: string;
  model: string;
}

/** One entrance's run: the stages it spent, the tracker calls it made, and what it returned. */
export interface DoorProbe {
  calls: ProbeCall[];
  gh: string[][];
  result: { issueNumber?: number; gateCount?: number; outcome?: string } | null;
  error: string | null;
  /** Which candidate payload the sweep's parser accepted, or `null` when no sweep stage ran. */
  candidate: number | null;
}

export interface SweepProbe {
  /** The sheet door — collector, sweep, author, critic, publish, gate. */
  cold: DoorProbe;
  /** ADR-0085's door — a spec that arrived already written, entering at the critic. */
  warm: DoorProbe;
  /** What the sheet collector on its own puts in `DecidedContext.rulings`. */
  collector: { rulings: string | null; error: string | null };
  fatal?: string;
}

const PROBE = `
const CONFIG = JSON.parse(process.env.PROBE_CONFIG || "{}");
const MARK = CONFIG.marks;
const HAIKU = "claude-haiku-4-5-20251001";

function citation(kind, extra) {
  const base = {
    path: MARK.adrPath,
    source: MARK.adrPath,
    file: MARK.adrPath,
    citation: MARK.adrPath,
    adr: MARK.adrPath,
    id: MARK.adrPath,
    ref: MARK.adrPath,
    url: MARK.adrPath,
    location: MARK.adrPath,
    module: MARK.adrPath,
    title: MARK.quote,
    quote: MARK.quote,
    text: MARK.quote,
    excerpt: MARK.quote,
    summary: MARK.quote,
    note: MARK.quote,
    why: MARK.quote,
    relevance: MARK.quote,
    ruling: MARK.quote,
    statement: MARK.quote,
    definition: MARK.quote,
    name: MARK.quote,
    term: MARK.term
  };
  if (kind) base.kind = kind;
  if (extra) Object.assign(base, extra);
  return base;
}

const LIST_KEYS = [
  "rulings", "citations", "priorArt", "prior_art", "sweep", "findings", "results", "items",
  "entries", "sources", "adrs", "vocabulary", "terms", "modules", "neighbours", "neighbors"
];
const PROSE_KEYS = ["summary", "notes", "context", "overview", "rationale", "reason", "text"];

function spread(listValue, proseValue) {
  const out = {};
  for (const key of LIST_KEYS) out[key] = listValue();
  for (const key of PROSE_KEYS) out[key] = proseValue();
  return out;
}

function candidates() {
  const out = [];
  const prose = function () { return MARK.quote; };
  out.push(spread(function () { return [citation(null, null)]; }, prose));
  const kinds = ["adr", "ruling", "module", "term", "vocabulary", "code", "file"];
  for (const kind of kinds) {
    out.push(spread(function () { return [citation(kind, null)]; }, prose));
  }
  out.push(spread(function () { return [citation(null, { line: 1 })]; }, prose));
  out.push(spread(function () { return [citation(null, { line: "1" })]; }, prose));
  out.push(spread(prose, prose));
  for (const key of LIST_KEYS) { const one = {}; one[key] = [citation(null, null)]; out.push(one); }
  for (const key of ["rulings", "citations", "summary", "text"]) {
    const one = {}; one[key] = MARK.quote; out.push(one);
  }
  out.push([citation(null, null)]);
  const minimal = [
    { path: MARK.adrPath, quote: MARK.quote },
    { source: MARK.adrPath, quote: MARK.quote },
    { path: MARK.adrPath, title: MARK.quote, quote: MARK.quote },
    { citation: MARK.adrPath, quote: MARK.quote },
    { path: MARK.adrPath, quote: MARK.quote, why: MARK.quote },
    { source: MARK.adrPath, quote: MARK.quote, why: MARK.quote },
    { quote: MARK.quote }
  ];
  for (const shape of minimal) {
    for (const key of ["rulings", "citations", "priorArt"]) {
      const one = {}; one[key] = [shape]; out.push(one);
    }
  }
  return out.map(function (value) { return JSON.stringify(value); });
}

function argvOf(invocation) {
  for (const value of invocation) {
    if (Array.isArray(value)) {
      let strings = true;
      for (const entry of value) if (typeof entry !== "string") strings = false;
      if (strings) return value.slice();
    }
  }
  return [];
}

function blobOf(invocation) {
  const parts = [];
  const seen = [];
  function walk(value) {
    if (value === null || value === undefined) return;
    const type = typeof value;
    if (type === "string") { parts.push(value); return; }
    if (type === "number" || type === "boolean") { parts.push(String(value)); return; }
    if (type !== "object") return;
    if (seen.indexOf(value) !== -1) return;
    seen.push(value);
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return; }
    for (const key of Object.keys(value)) { parts.push(key); walk(value[key]); }
  }
  walk(invocation);
  return parts.join(" | ");
}

function makeExec(state, sweepResponse) {
  return async function () {
    const invocation = Array.prototype.slice.call(arguments);
    const argv = argvOf(invocation);
    const blob = blobOf(invocation);
    const at = argv.indexOf("--model");
    const model = at === -1 ? "" : String(argv[at + 1]);
    const isSweep = model === HAIKU || blob.indexOf(HAIKU) !== -1;
    const hasTools = argv.indexOf("--allowedTools") !== -1;
    const kind = isSweep ? "sweep" : (hasTools ? "author" : "critic");
    state.calls.push({ kind: kind, argv: argv, blob: blob, model: model });
    if (kind === "sweep") return sweepResponse;
    if (kind === "author") {
      return JSON.stringify({ title: MARK.specTitle, body: MARK.draftBody, openQuestions: [] });
    }
    return JSON.stringify({ findings: [] });
  };
}

function makeGh(record, comments) {
  const issues = {};
  issues[String(CONFIG.sheetIssue)] = {
    title: "An accepted idea",
    body: MARK.ownerWords,
    comments: comments
  };
  issues[String(CONFIG.specIssue)] = {
    title: MARK.specTitle,
    body: MARK.sessionBody,
    comments: []
  };
  issues["900"] = { title: MARK.specTitle, body: MARK.draftBody, comments: [] };

  return function (args) {
    const argv = Array.prototype.slice.call(args).map(String);
    record.push(argv);
    if (argv[0] === "issue" && argv[1] === "view") {
      const number = Number(argv[2]);
      const issue = issues[String(number)] || { title: "", body: "", comments: [] };
      return JSON.stringify({
        number: number,
        title: issue.title,
        body: issue.body,
        state: "OPEN",
        labels: [],
        comments: (issue.comments || []).map(function (body) { return { body: body }; })
      });
    }
    if (argv[0] === "issue" && argv[1] === "create") {
      return "https://github.com/acme/tracker/issues/900";
    }
    return "";
  };
}

async function runDoor(door, sweepResponse, comments) {
  const state = { calls: [], gh: [] };
  const gh = makeGh(state.gh, comments);
  const exec = makeExec(state, sweepResponse);
  let result = null;
  let error = null;
  try {
    const spec = await import(CONFIG.specModule);
    if (door === "cold") {
      result = await spec.runSpecPublication(
        exec,
        gh,
        { mode: "publish", source: { kind: "sheet", issue: CONFIG.sheetIssue } },
        { kind: "sheet", gh: gh, issueNumber: CONFIG.sheetIssue }
      );
    } else {
      result = await spec.runSpecCritique(exec, gh, CONFIG.specIssue);
    }
  } catch (err) {
    error = (err && err.stack) ? String(err.stack) : String(err);
  }
  return {
    calls: state.calls,
    gh: state.gh,
    result: result === null ? null : JSON.parse(JSON.stringify(result)),
    error: error,
    candidate: null
  };
}

async function attempt(door, comments) {
  const payloads = candidates();
  let last = null;
  for (let index = 0; index < payloads.length; index++) {
    const run = await runDoor(door, payloads[index], comments);
    let sawSweep = false;
    for (const call of run.calls) if (call.kind === "sweep") sawSweep = true;
    run.candidate = sawSweep ? index : null;
    if (!run.error) return run;
    last = run;
    // A failure with no sweep stage in it is not a failure about the payload.
    if (!sawSweep) return last;
  }
  return last;
}

async function main() {
  const markerMod = await import(CONFIG.markerModule);
  const comments = [markerMod.sheetMarker(CONFIG.sheet), markerMod.acceptedMarker(CONFIG.accepted)];

  const cold = await attempt("cold", comments);
  const warm = await attempt("warm", comments);

  const collector = { rulings: null, error: null };
  try {
    const mod = await import(CONFIG.collectorModule);
    const collected = mod.collectSheetContext(makeGh([], comments), CONFIG.sheetIssue);
    const context = collected && collected.context ? collected.context : collected;
    collector.rulings =
      context && context.rulings !== undefined && context.rulings !== null
        ? String(context.rulings)
        : null;
  } catch (err) {
    collector.error = (err && err.message) ? String(err.message) : String(err);
  }

  return { cold: cold, warm: warm, collector: collector };
}

(async () => {
  let payload;
  try {
    payload = await main();
  } catch (err) {
    payload = { fatal: (err && err.stack) ? String(err.stack) : String(err) };
  }
  console.log("PROBE:" + JSON.stringify(payload));
})();
`;

let cached: SweepProbe | undefined;

/** Runs both of lane 02's entrances out of process and reports what each did. Memoised per file. */
export function runSweepProbe(): SweepProbe {
  if (cached !== undefined) return cached;

  const config = {
    specModule: moduleUrl(SPEC_SOURCE),
    markerModule: moduleUrl(MARKER_SOURCE),
    collectorModule: moduleUrl(SHEET_COLLECTOR),
    sheetIssue: 42,
    specIssue: 180,
    marks: MARKS,
    // The sheet as `spec.test.ts` builds one, carrying no marked decisions — the gate's other
    // measure is not what any of #261's criteria are about.
    sheet: {
      restatement: MARKS.restatement,
      priorArt: [],
      decisions: [],
      survivors: [],
      route: "short",
      routeReason: "Short — one file.",
      newTerms: [],
      round: 0,
    },
    accepted: { adrPaths: [MARKS.collectorAdrPath], coinedTerms: [], route: "short" },
  };

  const run = runTsx(PROBE, { PROBE_CONFIG: JSON.stringify(config) });
  const probe = probeResult<SweepProbe>(run);
  if (probe.fatal) {
    throw new Error(`the #261 probe could not run lane 02 at all:\n${probe.fatal}`);
  }
  cached = probe;
  return probe;
}

/** The first stage of `kind` a door ran, or `undefined` when it ran none. */
export function callOfKind(door: DoorProbe, kind: ProbeCall["kind"]): ProbeCall | undefined {
  return door.calls.find((call) => call.kind === kind);
}

/** Where a stage of `kind` sits in the order the door ran them, or `-1`. */
export function indexOfKind(door: DoorProbe, kind: ProbeCall["kind"]): number {
  return door.calls.findIndex((call) => call.kind === kind);
}

/** The value after `flag` in an argv, or `undefined` when the flag is absent. */
export function flagValue(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

/** A one-line summary of the stages a door ran — what a failed order assertion should print. */
export function describeCalls(door: DoorProbe): string {
  return door.calls.map((call) => `${call.kind}(${call.model || "no --model"})`).join(" -> ");
}

export interface VitestRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * A criterion's own `npx vitest run <file>` check, run from the checkout root.
 *
 * The environment is stripped of the runner's own markers so the child starts a clean run rather
 * than believing it is already inside one.
 */
export function runVitest(testFile: string): VitestRun {
  const env: Record<string, string | undefined> = { ...process.env, CI: "1" };
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_MODE;

  const run = spawnSync("npx", ["vitest", "run", testFile], {
    cwd: repoRoot,
    encoding: "utf8",
    env: env as NodeJS.ProcessEnv,
    timeout: 540_000,
    maxBuffer: 64 * 1024 * 1024,
  });

  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}
