import type { GitExec } from "./git";

/**
 * The gate, as a list of files (#360). Everything that decides what a venue runs, or wires a venue
 * to its trigger, is on it; `.claude/gate-size.test.ts` sums their line counts and fails when the
 * total grows past the number recorded there, and the fixer and recover lanes refuse a pull
 * request that adds a file to this list. A fixed list rather than an ownership rule, because a
 * list is the one thing a lane cannot widen by reinterpreting it.
 */
export const GATE_FILES: readonly string[] = [
  "bin/gauntlet",
  "bin/node-on-path.sh",
  ".claude/contract.json",
  ".claude/hooks/gauntlet.sh",
  ".claude/hooks/gauntlet-hook.mjs",
  ".claude/hooks/gauntlet-report.mjs",
  ".claude/settings.json",
  ".husky/pre-push",
  ".github/workflows/verify.yml",
  ".github/actions/node/action.yml",
  "vitest.config.ts",
  "eslint.config.js",
  "knip.config.ts",
  ".dependency-cruiser.cjs",
  "tsconfig.json",
];

/**
 * The directories a new gate file would land in. A pull request that creates a file under one of
 * these is growing the gate by a path the list above has not heard of, which the size fence
 * cannot see; the fixer and recover lanes refuse it by this rule instead.
 */
const GATE_DIRS: readonly string[] = ["bin/", ".claude/hooks/", ".husky/", ".github/workflows/", ".github/actions/"];

/** The module that carries `GATE_FILES` — editing it is the other way to grow the gate. */
const GATE_LIST_PATH = ".Workflow/agent-workflows/shared/gate-files.ts";

/**
 * Every path in `added` (files a pull request creates, not merely edits) that grows the gate: a
 * new file under a gate directory, or a new spelling of the list itself. Empty means the pull
 * request may proceed as far as this rule is concerned.
 */
export function gateAdditions(added: readonly string[]): string[] {
  return added.filter(
    (path) => path === GATE_LIST_PATH || GATE_FILES.includes(path) || GATE_DIRS.some((dir) => path.startsWith(dir)),
  );
}

/**
 * `gateAdditions` over the subset of `paths` that `git` does not already track — the files a lane's
 * answer would *create*. An edit to a file already on the list is the size fence's business, not
 * this rule's: a lane may shrink a gate file, and the fence says whether it grew.
 */
export function gateGrowth(git: GitExec, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const tracked = new Set(
    git(["ls-files", "--", ...paths])
      .split("\n")
      .filter((line) => line !== ""),
  );
  return gateAdditions(paths.filter((path) => !tracked.has(path)));
}
