// The two in-session venues of the gauntlet: in-turn (PostToolUse) and turn end (Stop).
//
// @shell Claude Code launches this by path through `gauntlet.sh` on a hook event. Nothing
// imports it, so that launch is the only edge reaching it and no static analysis sees it.
//
// Neither refuses, and neither can. PostToolUse fires after the edit has already landed, and Stop
// only asks Claude to keep working. That is the accepted shape, not a shortfall: every venue below
// Actions is bypassable, and with branch protection declined (ADR-0071) there is no venue an agent
// cannot route around. ADR-0063 is what counts the routing-around.
// What these venues buy is the *repair* being cheap, because the context that
// caused the failure is still loaded.
//
// Both fail open. A hook that cannot run its checks stays silent and lets the turn through; the
// push venue and Actions still see the failure. A convenience venue that fails closed wedges every
// turn in the repo, which is a worse outcome than the defect it was trying to catch.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The stub seam, same shape as the CLI stubs under .Workflow/agent-workflows/. It exists because
// the real gauntlet at the `stop` venue runs the unit suite, and a test that spawned it would spawn
// the suite that spawned it. Tests point this at a script that returns a canned exit code; nothing
// in production sets it.
const GAUNTLET = process.env.GAUNTLET_BIN ?? resolve(REPO_ROOT, "bin/gauntlet");

// bin/gauntlet's third exit code. 0 is clean and 1 is a real finding; 2 means the checks never ran,
// which must never reach Claude as if it were one.
const COULD_NOT_RUN = 2;

// How much of the gauntlet's stdout the report keeps. The same number and the same shape as
// `shared/reason.ts`'s `STDOUT_TAIL`, which caps this very stream for GitHub comments — and the
// tail rather than the head for the same reason it gives: `bin/gauntlet` prints its verdict line
// (`gauntlet: FAILED at …`) last, so head-first truncation drops the one line worth having.
//
// This channel pays for every character twice: into Claude's context, and onto the person's
// screen, because the harness renders `reason` as the visible refusal. A whole vitest run is what
// the `stop` venue produces uncapped.
const STDOUT_TAIL = 4000;

// The one row this hook owes an audit (`~/.agents/skills/hooks/_hook.py`'s `run_row`, in the shape
// `hook-report` reads). Written in JS rather than through that module because this hook is the
// estate's one non-Python hook; the field names are the contract, not the language.
const HOOK_NAME = "gauntlet-hook";
const LOG_DIR = process.env.STOP_GATE_LOG_DIR || join(homedir(), ".claude", "logs");
const STARTED = Date.now();

/** Reads the hook payload off stdin. A payload we cannot parse is a broken hook, not a finding. */
function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/**
 * One JSON line per fire. Write errors are swallowed: a verdict never depends on a writable log
 * (ADR-0005's observability rule). `verdict` is one word from this hook's own fixed vocabulary —
 * bad-stdin, stage, out-of-scope, reported-already, could-not-run, clean, slow, failed — so a
 * report can count without parsing prose.
 */
function logRow(verdict, extra = {}) {
  const cwd = payload && typeof payload.cwd === "string" ? payload.cwd : "";
  const row = {
    hook: HOOK_NAME,
    event: (payload && payload.hook_event_name) || "",
    session_id: (payload && payload.session_id) || "",
    project: cwd ? cwd.split(sep).filter(Boolean).pop() || "" : "",
    verdict,
    seconds: Math.round((Date.now() - STARTED) / 100) / 10,
    venue: venue ?? "",
    ...extra,
    ts: new Date().toISOString().slice(0, 19),
  };
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const day = row.ts.slice(0, 10);
    appendFileSync(join(LOG_DIR, `${HOOK_NAME}-${day}.jsonl`), JSON.stringify(row) + "\n");
  } catch {
    /* A log this hook cannot write is not a reason to change what it reports. */
  }
}

/** Exits 0 with nothing to say. Every path that is not a finding ends here. */
function silent(verdict, extra) {
  logRow(verdict, extra);
  process.exit(0);
}

/**
 * The only channel these venues have. `decision: "block"` on a Post event is not a refusal — it
 * hands `reason` back to Claude and lets it decide — and it requires exit 0, because JSON emitted
 * alongside a non-zero exit is discarded.
 */
function report(reason, systemMessage) {
  const out = { decision: "block", reason };
  if (systemMessage) out.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function runGauntlet(venue, target) {
  const args = target ? [venue, target] : [venue];
  return spawnSync(GAUNTLET, args, { cwd: REPO_ROOT, encoding: "utf8" });
}

const venue = process.argv[2];
const payload = readPayload();
if (!payload || (venue !== "turn" && venue !== "stop")) silent("bad-stdin");

// Neither venue exists inside a stage. `WORKFLOW_STAGE` is set by `execClaude`
// (.Workflow/agent-workflows/shared/stage.ts), the one seam every lane spawns its
// model through, and what it marks is a session with no human in it and an output
// contract these venues cannot honour: `decision: "block"` asks Claude for another
// turn, and a stage's answer is whatever its *last* turn said. #134's slicing spent
// its `<output>` block replying to this hook about a flaky suite it had not touched.
// The stage's checks still run — in `verify.yml`, where a red suite fails the run
// rather than the response.
if (process.env.WORKFLOW_STAGE === "1") silent("stage");

if (venue === "turn") {
  // Only TypeScript, and only inside this repo. An edit to a Markdown file has nothing here that
  // can judge it, and running the venue anyway is how a cheap hook becomes a tax on every turn.
  //
  // The separator is part of the boundary: a bare prefix test puts a sibling checkout
  // (`…/Workflow-scratch/x.ts`) inside this repo.
  const file = payload.tool_input?.file_path;
  if (typeof file !== "string" || !/\.[cm]?ts$/.test(file)) silent("out-of-scope");
  const abs = resolve(file);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + sep)) silent("out-of-scope");
}

if (venue === "stop") {
  // Report once per turn cycle, then let the turn end. Re-blocking on a failure Claude has already
  // been told about is the documented Stop-hook loop, and it is also wrong on purpose: a red suite
  // mid-task is a legitimate state — a TDD red phase is exactly that shape — so the venue's job is
  // to say so once, not to hold the session hostage until it goes green.
  if (payload.stop_hook_active === true) silent("reported-already");
}

const run = runGauntlet(venue, venue === "turn" ? payload.tool_input.file_path : undefined);

if (run.error || run.status === null || run.status === COULD_NOT_RUN) silent("could-not-run");

// bin/gauntlet writes the failing checks to stdout and its own diagnostics to stderr. Only the
// over-budget lines are worth surfacing, and they go to the user rather than to Claude: it is a
// finding about the gauntlet, not about the code being checked.
//
// `timing-baseline.ts` emits two of them, independently gated: the venue line (wall clock past the
// venue budget) and the per-check line (a check past its own). Match both — the venue line alone
// is, in `bin/gauntlet`'s own words, "a report nobody can act on until it says which check did" —
// and prefer the per-check line when a run raised both. Matching on the article in "against a"
// caught only the venue line, and said nothing at all on a run that raised only the other.
const budgetLines = (run.stderr || "")
  .split("\n")
  .filter((line) => line.startsWith("gauntlet: ") && line.includes("budget"));
const overBudget =
  budgetLines.find((line) => line.includes("the slowest check over budget is")) ?? budgetLines[0];

// A venue that got slower is the whole signal the timing ratchet exists to raise (#335), and until
// this line it was raised into a stderr stream nobody reads: `bin/gauntlet` prints it, these venues
// exit 0 on it deliberately — a timing regression may not block an agent's turn — and the hook then
// dropped it on the floor because the checks passed. `systemMessage` with no `decision` is the one
// channel that reaches the person without asking Claude for another turn.
if (run.status === 0) {
  if (overBudget) {
    process.stdout.write(JSON.stringify({ systemMessage: overBudget }));
  }
  logRow(overBudget ? "slow" : "clean");
  process.exit(0);
}

const stdout = (run.stdout || "").trim();

// `bin/gauntlet` names the failing checks on its last stdout line. Saying which check failed in the
// hook's own words costs nothing — the runner already computed it — and it is the half that
// survives when a reader skims past the captured output below.
const failedChecks = (stdout.match(/^gauntlet: FAILED at (.+)$/m)?.[1] ?? "")
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .join(", ");

// Fenced and labelled, because this is data. The suite asserts on built agent prompts
// (`acceptance/author/prompt.test.ts`, `acceptance.test.ts`, `observations/auditor.test.ts`), and a
// `toContain` failure prints the whole received string — so an unlabelled dump lands a 130-line
// agent-facing document mid-turn, reading as if addressed to this session.
const captured = stdout.length > STDOUT_TAIL ? `…\n${stdout.slice(-STDOUT_TAIL)}` : stdout;

// The step, stated positively, and one the agent can check. At `stop` it also carries the standing
// fact the venue was built around: this report fires once, and ending the turn is allowed.
const next =
  venue === "turn"
    ? `Fix, then re-run: \`bin/gauntlet turn ${payload.tool_input.file_path}\``
    : "Fix, then re-run: `bin/gauntlet stop`. A red suite mid-task is a legitimate state — a TDD " +
      "red phase is exactly that shape — so this report fires once per turn cycle and ending the " +
      "turn is allowed.";

logRow("failed", { checks: failedChecks, chars: captured.length });

report(
  `[gauntlet] The ${venue} venue's checks failed${failedChecks ? `: ${failedChecks}` : ""}.\n\n` +
    `${next}\n\n` +
    `Captured output from \`bin/gauntlet\`, quoted as data:\n\n~~~\n${captured}\n~~~`,
  overBudget,
);
