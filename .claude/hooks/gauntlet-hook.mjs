// @shell Claude Code launches this by path through `gauntlet.sh` on a hook event. Nothing

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captured, failedChecks, inScope, report } from "./gauntlet-report.mjs";
import { appendLog, runRow } from "./lib/_hook.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const GAUNTLET = process.env.GAUNTLET_BIN ?? resolve(REPO_ROOT, "bin/gauntlet");

const HOOK_NAME = "gauntlet-hook";

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function silent(verdict) {
  appendLog(HOOK_NAME, runRow(HOOK_NAME, payload, verdict, { venue: venue ?? "" }));
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
appendLog(HOOK_NAME, runRow(HOOK_NAME, payload, "failed", { venue: venue ?? "", checks: failedChecks(stdout), chars: captured(stdout).length }));

process.stdout.write(JSON.stringify({ decision: "block", reason: report(venue, stdout, file) }));
process.exit(0);
