// The two in-session venues of the gauntlet: in-turn (PostToolUse) and turn end (Stop).
//
// @shell Claude Code launches this by path through `gauntlet.sh` on a hook event. Nothing
// imports it, so that launch is the only edge reaching it and no static analysis sees it.
//
// Neither refuses, and neither can. PostToolUse fires after the edit has already landed, and Stop
// only asks Claude to keep working. That is the accepted shape: every venue below Actions is
// bypassable, and with branch protection declined (ADR-0071) there is no venue an agent cannot
// route around; ADR-0063 counts the routing-around. What these venues buy is the *repair* being
// cheap, because the context that caused the failure is still loaded.
//
// Both fail open. A hook that cannot run its checks stays silent and lets the turn through; the
// push venue and Actions still see the failure. A convenience venue that fails closed wedges every
// turn in the repo, which is worse than the defect it was trying to catch.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captured, failedChecks, inScope, report } from "./gauntlet-report.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The stub seam: tests point this at a script that returns a canned exit code, because the real
// gauntlet at the `stop` venue runs tests and a test that spawned it would spawn itself. Nothing in
// production sets it.
const GAUNTLET = process.env.GAUNTLET_BIN ?? resolve(REPO_ROOT, "bin/gauntlet");

// The one row this hook owes an audit (`~/.agents/skills/hooks/_hook.py`'s `run_row`, in the shape
// `hook-report` reads). The field names are the contract, not the language.
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
 * (ADR-0005). `verdict` is one word from this hook's own fixed vocabulary — bad-stdin, stage,
 * out-of-scope, reported-already, could-not-run, clean, failed — so a report can count without
 * parsing prose.
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
    appendFileSync(join(LOG_DIR, `${HOOK_NAME}-${row.ts.slice(0, 10)}.jsonl`), JSON.stringify(row) + "\n");
  } catch {
    /* A log this hook cannot write is not a reason to change what it reports. */
  }
}

/** Exits 0 with nothing to say. Every path that is not a finding ends here. */
function silent(verdict) {
  logRow(verdict);
  process.exit(0);
}

const venue = process.argv[2];
const payload = readPayload();
if (!payload || (venue !== "turn" && venue !== "stop")) silent("bad-stdin");

// Neither venue exists inside a stage. `WORKFLOW_STAGE` is set by `execClaude`
// (`.Workflow/agent-workflows/shared/stage.ts`), the one seam every lane spawns its model through,
// and what it marks is a session with no human in it and an output contract these venues cannot
// honour: `decision: "block"` asks Claude for another turn, and a stage's answer is whatever its
// *last* turn said (#134). The stage's checks still run — in `verify.yml`.
if (process.env.WORKFLOW_STAGE === "1") silent("stage");

const file = venue === "turn" ? payload.tool_input?.file_path : undefined;
if (venue === "turn" && !inScope(file, REPO_ROOT)) silent("out-of-scope");

// Report once per turn cycle, then let the turn end. Re-blocking on a failure Claude has already
// been told about is the documented Stop-hook loop, and it is also wrong on purpose: a red suite
// mid-task is a legitimate state, so the venue's job is to say so once.
if (venue === "stop" && payload.stop_hook_active === true) silent("reported-already");

const run = spawnSync(GAUNTLET, file ? [venue, file] : [venue], { cwd: REPO_ROOT, encoding: "utf8" });

// A gauntlet that never ran — no binary, a spawn error — is not a finding about the code.
if (run.error || run.status === null) silent("could-not-run");
if (run.status === 0) silent("clean");

const stdout = run.stdout || "";
logRow("failed", { checks: failedChecks(stdout), chars: captured(stdout).length });

// The only channel these venues have. `decision: "block"` on a Post event is not a refusal — it
// hands `reason` back to Claude and lets it decide — and it requires exit 0, because JSON emitted
// alongside a non-zero exit is discarded.
process.stdout.write(JSON.stringify({ decision: "block", reason: report(venue, stdout, file) }));
process.exit(0);
