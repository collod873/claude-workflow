// The two in-session venues of the gauntlet: in-turn (PostToolUse) and turn end (Stop).
//
// Neither refuses, and neither can. PostToolUse fires after the edit has already landed, and Stop
// only asks Claude to keep working. That is the accepted shape, not a shortfall: DESIGN.md §12
// names it as open cell 9 — until branch protection lands at move 10 there is no venue an agent
// cannot route around. What these venues buy is the *repair* being cheap, because the context that
// caused the failure is still loaded.
//
// Both fail open. A hook that cannot run its checks stays silent and lets the turn through; the
// push venue and Actions still see the failure. A convenience venue that fails closed wedges every
// turn in the repo, which is a worse outcome than the defect it was trying to catch.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

/** Reads the hook payload off stdin. A payload we cannot parse is a broken hook, not a finding. */
function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** Exits 0 with nothing to say. Every path that is not a finding ends here. */
function silent() {
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
if (!payload || (venue !== "turn" && venue !== "stop")) silent();

if (venue === "turn") {
  // Only TypeScript, and only inside this repo. An edit to a Markdown file has nothing here that
  // can judge it, and running the venue anyway is how a cheap hook becomes a tax on every turn.
  const file = payload.tool_input?.file_path;
  if (typeof file !== "string" || !/\.[cm]?ts$/.test(file)) silent();
  if (!resolve(file).startsWith(REPO_ROOT)) silent();
}

if (venue === "stop") {
  // Report once per turn cycle, then let the turn end. Re-blocking on a failure Claude has already
  // been told about is the documented Stop-hook loop, and it is also wrong on purpose: a red suite
  // mid-task is a legitimate state — a TDD red phase is exactly that shape — so the venue's job is
  // to say so once, not to hold the session hostage until it goes green.
  if (payload.stop_hook_active === true) silent();
}

const run = runGauntlet(venue, venue === "turn" ? payload.tool_input.file_path : undefined);

if (run.error || run.status === null || run.status === COULD_NOT_RUN) silent();
if (run.status === 0) silent();

// bin/gauntlet writes the failing checks to stdout and its own diagnostics to stderr. Only the
// over-budget line is worth surfacing, and it goes to the user rather than to Claude: it is a
// finding about the gauntlet, not about the code being checked.
const overBudget = (run.stderr || "").split("\n").find((line) => line.includes("against a"));

report(
  `The gauntlet failed at the ${venue === "turn" ? "in-turn" : "turn-end"} venue:\n\n${run.stdout}`,
  overBudget,
);
