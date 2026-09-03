import type { GitExec } from "./git";

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

const GATE_DIRS: readonly string[] = ["bin/", ".claude/hooks/", ".husky/", ".github/workflows/", ".github/actions/"];

const GATE_LIST_PATH = ".Workflow/agent-workflows/shared/gate-files.ts";

export function gateAdditions(added: readonly string[]): string[] {
  return added.filter(
    (path) => path === GATE_LIST_PATH || GATE_FILES.includes(path) || GATE_DIRS.some((dir) => path.startsWith(dir)),
  );
}

export function gateGrowth(git: GitExec, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const tracked = new Set(
    git(["ls-files", "--", ...paths])
      .split("\n")
      .filter((line) => line !== ""),
  );
  return gateAdditions(paths.filter((path) => !tracked.has(path)));
}
