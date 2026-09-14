// @shell Claude Code launches this by path through `gauntlet.sh` on a hook event. Nothing

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captured, EDIT_TOOLS, editedPath, failedChecks, inScope, report } from "./gauntlet-report.mjs";
import { appendLog, runRow } from "./lib/_hook.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const GAUNTLET = process.env.GAUNTLET_BIN ?? resolve(REPO_ROOT, "bin/gauntlet");

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function silent(verdict) {
  appendLog(runRow(payload, verdict, { venue: venue ?? "" }));
  process.exit(0);
}

const venue = process.argv[2];
const payload = readPayload();
if (!payload || venue !== "turn") silent("bad-stdin");

if (process.env.WORKFLOW_STAGE === "1") silent("stage");

if (!EDIT_TOOLS.includes(payload.tool_name)) silent("not-an-edit");

const target = resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());

const file = editedPath(payload.tool_input);
if (!inScope(file, target)) silent("out-of-scope");
if (!existsSync(join(target, ".claude", "contract.json"))) silent("no-contract");

const run = spawnSync(GAUNTLET, [venue, file], {
  cwd: target,
  env: { ...process.env, TARGET_WORKSPACE: target },
  encoding: "utf8",
});

if (run.error || run.status === null) silent("could-not-run");
if (run.status === 0) silent("clean");

const stdout = run.stdout || "";
appendLog(runRow(payload, "failed", { venue: venue ?? "", checks: failedChecks(stdout), chars: captured(stdout).length }));

process.stdout.write(JSON.stringify({ decision: "block", reason: report(venue, stdout, file) }));
process.exit(0);
