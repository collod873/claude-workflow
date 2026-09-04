// @shell Claude Code launches this by path through `gauntlet.sh` on a hook event. Nothing

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captured, failedChecks, inScope, report } from "./gauntlet-report.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const GAUNTLET = process.env.GAUNTLET_BIN ?? resolve(REPO_ROOT, "bin/gauntlet");

const HOOK_NAME = "gauntlet-hook";
const LOG_DIR = process.env.STOP_GATE_LOG_DIR || join(homedir(), ".claude", "logs");
const STARTED = Date.now();

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function localTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

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
    ts: localTimestamp(),
  };
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, `${HOOK_NAME}-${row.ts.slice(0, 10)}.jsonl`), JSON.stringify(row) + "\n");
  } catch {
  }
}

function silent(verdict) {
  logRow(verdict);
  process.exit(0);
}

const venue = process.argv[2];
const payload = readPayload();
if (!payload || venue !== "turn") silent("bad-stdin");

if (process.env.WORKFLOW_STAGE === "1") silent("stage");

const file = payload.tool_input?.file_path;
if (!inScope(file, REPO_ROOT)) silent("out-of-scope");

const run = spawnSync(GAUNTLET, [venue, file], { cwd: REPO_ROOT, encoding: "utf8" });

if (run.error || run.status === null) silent("could-not-run");
if (run.status === 0) silent("clean");

const stdout = run.stdout || "";
logRow("failed", { checks: failedChecks(stdout), chars: captured(stdout).length });

process.stdout.write(JSON.stringify({ decision: "block", reason: report(venue, stdout, file) }));
process.exit(0);
