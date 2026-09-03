import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { sitePath } from "../shared/site";

export const TRIAL_DIR = ".ratify-trial";

export const ESLINT_CONFIG = "eslint.config.js";

export type EslintExec = (args: string[], cwd: string) => string;

export const execEslint: EslintExec = (args, cwd) => {
  try {
    return execFileSync("npx", ["eslint", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.trim()) return stdout;
    throw new Error(`the rule trial could not run eslint: ${reason(err)}`);
  }
};

interface EslintResult {
  filePath: string;
  messages: Array<{ ruleId: string | null }>;
}

export interface RuleTrialOptions {
  git: GitExec;
  repoDir: string;
  parent: string;
  ruleId: string;
  sites: string[];
  eslint?: EslintExec;
}

export interface RuleTrialResult {
  reproduced: boolean;
  missed: string[];
}

export function runRuleTrial(options: RuleTrialOptions): RuleTrialResult {
  const { git, repoDir, parent, ruleId, sites } = options;
  const eslint = options.eslint ?? execEslint;
  const trialDir = join(repoDir, TRIAL_DIR);

  const paths = [...new Set(sites.map(sitePath))];
  if (paths.length === 0) return { reproduced: false, missed: [] };

  git(["-C", repoDir, "worktree", "add", "--detach", "--force", TRIAL_DIR, parent]);
  try {
    copyFileSync(join(repoDir, ESLINT_CONFIG), join(trialDir, ESLINT_CONFIG));

    const present = paths.filter((path) => existsSync(join(trialDir, path)));
    const absent = paths.filter((path) => !present.includes(path));
    if (present.length === 0) return { reproduced: false, missed: paths };

    const flagged = flaggedBy(eslint(["-f", "json", ...present], trialDir), trialDir, ruleId);
    const missed = [...absent, ...present.filter((path) => !flagged.has(path))];
    return { reproduced: missed.length === 0, missed };
  } finally {
    git(["-C", repoDir, "worktree", "remove", "--force", TRIAL_DIR]);
  }
}

function flaggedBy(report: string, trialDir: string, ruleId: string): Set<string> {
  let results: EslintResult[];
  try {
    results = JSON.parse(report) as EslintResult[];
  } catch (err) {
    throw new Error(`the rule trial could not read eslint's JSON report: ${reason(err)}`);
  }

  const flagged = new Set<string>();
  for (const result of results) {
    if (!result.messages?.some((message) => message.ruleId === ruleId)) continue;
    const relative = result.filePath.startsWith(trialDir)
      ? result.filePath.slice(trialDir.length).replace(/^[/\\]/, "")
      : result.filePath;
    flagged.add(relative);
  }
  return flagged;
}
