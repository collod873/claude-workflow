// The decisions `gauntlet-hook.mjs` makes, as pure functions of the payload and the gauntlet's
// exit — kept apart from the hook's process edges (stdin, spawn, the log file) so they can be
// tested by import rather than by driving a process. `gauntlet.proc.test.ts` drives the process;
// `gauntlet.test.ts` drives these.

import { resolve, sep } from "node:path";

/**
 * How much of the gauntlet's stdout the report keeps. The same number and the same shape as
 * `shared/reason.ts`'s `STDOUT_TAIL` — the tail rather than the head, because `bin/gauntlet`
 * prints its verdict line (`gauntlet: FAILED at …`) last, and head-first truncation drops the one
 * line worth having. This channel pays for every character twice: into Claude's context, and
 * onto the person's screen.
 */
export const STDOUT_TAIL = 4000;

/**
 * Whether the in-turn venue has anything to say about an edit: only a TypeScript file, and only
 * one inside `repoRoot`. The separator is part of the boundary — a bare prefix test puts a
 * sibling checkout (`…/Workflow-scratch/x.ts`) inside this repo.
 */
export function inScope(file, repoRoot) {
  if (typeof file !== "string" || !/\.[cm]?ts$/.test(file)) return false;
  const abs = resolve(file);
  return abs === repoRoot || abs.startsWith(repoRoot + sep);
}

/**
 * The checks `bin/gauntlet` named on its last stdout line, comma-joined for the report, or `""`
 * when the output carries no verdict line. The runner already computed them; saying which check
 * failed in the hook's own words is the half that survives a reader skimming past the dump.
 */
export function failedChecks(stdout) {
  return (stdout.match(/^gauntlet: FAILED at (.+)$/m)?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(", ");
}

/**
 * The gauntlet's output as the report quotes it: the tail past `STDOUT_TAIL`, marked as cut.
 * Fenced and labelled by `report` below, because this is data — the suite asserts on built agent
 * prompts, and a `toContain` failure prints the whole received string, so an unlabelled dump lands
 * an agent-facing document mid-turn reading as if addressed to this session.
 */
export function captured(stdout) {
  const text = stdout.trim();
  return text.length > STDOUT_TAIL ? `…\n${text.slice(-STDOUT_TAIL)}` : text;
}

/**
 * The `reason` handed back to Claude for a red run at `venue`: which checks failed, the step
 * stated positively (a command it can re-run), and the captured output quoted as data. At `stop`
 * it also carries the standing fact the venue is built around — the report fires once, and ending
 * the turn is allowed, because a red suite mid-task is a legitimate state (a TDD red phase).
 */
export function report(venue, stdout, file) {
  const checks = failedChecks(stdout);
  const next =
    venue === "turn"
      ? `Fix, then re-run: \`bin/gauntlet turn ${file}\``
      : "Fix, then re-run: `bin/gauntlet stop`. A red suite mid-task is a legitimate state — a TDD " +
        "red phase is exactly that shape — so this report fires once per turn cycle and ending the " +
        "turn is allowed.";
  return (
    `[gauntlet] The ${venue} venue's checks failed${checks ? `: ${checks}` : ""}.\n\n` +
    `${next}\n\n` +
    `Captured output from \`bin/gauntlet\`, quoted as data:\n\n~~~\n${captured(stdout)}\n~~~`
  );
}
