import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { sitePath } from "../observations/site";

/**
 * **The rule trial.** A `mechanise` verdict is ratified only by reproducing
 * its own evidence: before any site is fixed, the rule the stage just
 * authored is run against the tree *as it was before this finding was
 * touched*, and it must flag every site the observation carries. A rule that
 * cannot reproduce its own evidence is not a standard, it is a guess — and
 * the guess is caught here, at birth, instead of by the later audit GOAL.md
 * blocker 3 describes.
 *
 * The threshold comes from the observed failure itself (the sites the
 * two-site gate already collected), never from a number somebody picked.
 *
 * **Why a worktree.** The trial has to run the *new* config over the *old*
 * code, and those two states cannot both be the checkout at once. A detached
 * worktree at the parent commit is the old code; copying the authored
 * `eslint.config.js` into it is the new config. It is staged inside the repo,
 * not in a temp dir, for the reason `.clone-gate-scan/` is
 * (`shared/clone-gate.ts`): eslint and its plugins resolve out of the repo's
 * own `node_modules`, which a path outside the repo cannot walk up to.
 */

/** Where the trial's detached worktree is staged — `.gitignore`d, torn down after every run. */
export const TRIAL_DIR = ".ratify-trial";

/** The config file a mechanise verdict authors its rule into (`eslint.config.js`'s inline-plugin precedent). */
export const ESLINT_CONFIG = "eslint.config.js";

/**
 * Runs eslint and returns its JSON report, as text.
 *
 * Injected so the trial is testable without a real lint run, and so the one
 * place that tolerates eslint's exit code is named: eslint exits 1 when it
 * *found* something, which is the outcome this trial is hoping for, so a
 * non-zero exit is not a failure here the way it is everywhere else.
 */
export type EslintExec = (args: string[], cwd: string) => string;

export const execEslint: EslintExec = (args, cwd) => {
  try {
    return execFileSync("npx", ["eslint", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    // Exit 1 means findings, and findings are what the trial reads. `stdout` is still the report.
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.trim()) return stdout;
    throw new Error(`the rule trial could not run eslint: ${reason(err)}`);
  }
};

/** One eslint result, in the subset of `-f json` this module reads. */
interface EslintResult {
  filePath: string;
  messages: Array<{ ruleId: string | null }>;
}

export interface RuleTrialOptions {
  git: GitExec;
  /** The repo the worktree is staged inside and the authored config is copied from. */
  repoDir: string;
  /** The commit whose tree is the "before" the rule has to flag — the parent of this finding's work. */
  parent: string;
  /** The rule id the verdict claims it authored. */
  ruleId: string;
  /** The observation's own sites, `path:line` or bare path (`observations/site.ts`). */
  sites: string[];
  eslint?: EslintExec;
}

/** What one trial hands back. */
export interface RuleTrialResult {
  /** True only when every site the observation carries was flagged by `ruleId`. */
  reproduced: boolean;
  /** The site paths the rule failed to flag — the whole of why a demotion fired. */
  missed: string[];
}

/**
 * Stages the pre-fix tree, runs the authored rule over this finding's sites,
 * and reports which of them it failed to flag. Always tears the worktree down,
 * including when the lint run itself throws — a leftover worktree would make
 * the next finding's trial refuse to stage at all.
 */
export function runRuleTrial(options: RuleTrialOptions): RuleTrialResult {
  const { git, repoDir, parent, ruleId, sites } = options;
  const eslint = options.eslint ?? execEslint;
  const trialDir = join(repoDir, TRIAL_DIR);

  const paths = [...new Set(sites.map(sitePath))];
  if (paths.length === 0) return { reproduced: false, missed: [] };

  git(["-C", repoDir, "worktree", "add", "--detach", "--force", TRIAL_DIR, parent]);
  try {
    copyFileSync(join(repoDir, ESLINT_CONFIG), join(trialDir, ESLINT_CONFIG));

    // A site whose file the parent commit does not carry cannot be flagged there, and asking
    // eslint for it exits with a usage error rather than a report. It counts as missed: a rule
    // whose evidence is a file that did not exist has reproduced nothing.
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

/** The repo-relative paths `ruleId` reported at least one message on. */
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
