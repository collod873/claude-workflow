import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GitExec } from "../shared/git";
import { runRuleTrial, TRIAL_DIR, type EslintExec } from "./rule-trial";

/**
 * The trial's git seam does two real things — stage a worktree and tear it down — and the whole
 * point of the module is that the second happens even when the first's contents make the lint run
 * throw. So this fake actually creates and removes the directory, and records both calls.
 */
function fakeGit(repoDir: string): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push([...args]);
    if (args.includes("worktree") && args.includes("add")) mkdirSync(join(repoDir, TRIAL_DIR), { recursive: true });
    if (args.includes("worktree") && args.includes("remove")) {
      rmSync(join(repoDir, TRIAL_DIR), { recursive: true, force: true });
    }
    return "";
  };
  return { git, calls };
}

/** An eslint stand-in answering `-f json`'s report for whichever files the test says the rule flags. */
function fakeEslint(trialDir: string, flaggedBy: Record<string, string[]>): EslintExec {
  return (args) => {
    const files = args.filter((arg) => !arg.startsWith("-") && arg !== "json");
    return JSON.stringify(
      files.map((file) => ({
        filePath: join(trialDir, file),
        messages: (flaggedBy[file] ?? []).map((ruleId) => ({ ruleId })),
      })),
    );
  };
}

let dirs: string[] = [];

/** A repo dir with the named files present at the trial's parent commit — what the worktree carries. */
function makeRepo(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "rule-trial-"));
  dirs.push(dir);
  writeFileSync(join(dir, "eslint.config.js"), "export default [];\n", "utf8");
  mkdirSync(join(dir, TRIAL_DIR), { recursive: true });
  for (const file of files) writeFileSync(join(dir, TRIAL_DIR, file), "// a site\n", "utf8");
  rmSync(join(dir, TRIAL_DIR), { recursive: true, force: true });
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** Stages the pre-fix site files the way the real `git worktree add` would, then runs the trial. */
function trial(options: {
  present: string[];
  sites: string[];
  flaggedBy: Record<string, string[]>;
  ruleId?: string;
}) {
  const repoDir = makeRepo([]);
  const trialDir = join(repoDir, TRIAL_DIR);
  const git = fakeGit(repoDir);
  const staging: GitExec = (args) => {
    const out = git.git(args);
    if (args.includes("worktree") && args.includes("add")) {
      for (const file of options.present) writeFileSync(join(trialDir, file), "// a site\n", "utf8");
      writeFileSync(join(trialDir, "eslint.config.js"), "export default [];\n", "utf8");
    }
    return out;
  };

  const result = runRuleTrial({
    git: staging,
    repoDir,
    parent: "parentsha",
    ruleId: options.ruleId ?? "ns/rule",
    sites: options.sites,
    eslint: fakeEslint(trialDir, options.flaggedBy),
  });

  return { result, calls: git.calls };
}

describe("runRuleTrial — a rule is ratified only by reproducing its own evidence", () => {
  it("reproduces when the rule flags every site the observation carries", () => {
    const { result } = trial({
      present: ["a.ts", "b.ts"],
      sites: ["a.ts:12", "b.ts:4"],
      flaggedBy: { "a.ts": ["ns/rule"], "b.ts": ["ns/rule"] },
    });

    expect(result).toEqual({ reproduced: true, missed: [] });
  });

  it("fails, naming the site it missed, when the rule flags only one of two", () => {
    const { result } = trial({
      present: ["a.ts", "b.ts"],
      sites: ["a.ts:12", "b.ts:4"],
      flaggedBy: { "a.ts": ["ns/rule"] },
    });

    expect(result).toEqual({ reproduced: false, missed: ["b.ts"] });
  });

  it("does not count a different rule's finding at the site as this rule reproducing", () => {
    const { result } = trial({
      present: ["a.ts"],
      sites: ["a.ts:12"],
      flaggedBy: { "a.ts": ["@typescript-eslint/no-unused-vars"] },
    });

    expect(result.reproduced).toBe(false);
    expect(result.missed).toEqual(["a.ts"]);
  });

  it("counts a site whose file the parent commit never carried as missed, not as absent evidence", () => {
    const { result } = trial({
      present: ["a.ts"],
      sites: ["a.ts:12", "gone.ts:1"],
      flaggedBy: { "a.ts": ["ns/rule"] },
    });

    expect(result.missed).toEqual(["gone.ts"]);
  });

  it("collapses two sites in one file to a single lint target", () => {
    const { result, calls } = trial({
      present: ["a.ts"],
      sites: ["a.ts:12", "a.ts:40"],
      flaggedBy: { "a.ts": ["ns/rule"] },
    });

    expect(result.reproduced).toBe(true);
    expect(calls.filter((argv) => argv.includes("worktree"))).toHaveLength(2);
  });

  it("tears the worktree down even when the lint run throws, so the next finding can stage one", () => {
    const repoDir = makeRepo([]);
    const git = fakeGit(repoDir);
    const staging: GitExec = (args) => {
      const out = git.git(args);
      if (args.includes("worktree") && args.includes("add")) {
        writeFileSync(join(repoDir, TRIAL_DIR, "a.ts"), "// a site\n", "utf8");
        writeFileSync(join(repoDir, TRIAL_DIR, "eslint.config.js"), "export default [];\n", "utf8");
      }
      return out;
    };

    expect(() =>
      runRuleTrial({
        git: staging,
        repoDir,
        parent: "parentsha",
        ruleId: "ns/rule",
        sites: ["a.ts:1"],
        eslint: () => {
          throw new Error("eslint blew up");
        },
      }),
    ).toThrow(/eslint blew up/);

    const removes = git.calls.filter((argv) => argv.includes("remove"));
    expect(removes).toHaveLength(1);
  });
});
