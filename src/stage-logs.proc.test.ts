import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { script, scratch } from "./scenarios.ts";

const ACTIONS = join(import.meta.dirname, "..", ".github", "actions");

interface Step {
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
}

const stepsOf = (action: string): Step[] => (parse(readFileSync(join(ACTIONS, action, "action.yml"), "utf8")) as { runs: { steps: Step[] } }).runs.steps;

const stepRunning = (action: string, text: string): Step => {
  const step = stepsOf(action).find((candidate) => (candidate.run ?? "").includes(text));
  expect(step, `a ${action} step running ${text}`).toBeDefined();
  return step as Step;
};

function keeping(root: string, hookLogs: string) {
  return spawnSync("bash", ["-e", "-c", stepRunning("stage-logs", "HOOK_LOG_DIR").run ?? ""], {
    cwd: root,
    env: { ...process.env, HOOK_LOG_DIR: hookLogs },
    encoding: "utf8",
  });
}

function stocked(gitDir: string, hookLogs: string) {
  mkdirSync(join(gitDir, "check", "logs"), { recursive: true });
  writeFileSync(join(gitDir, "check", "logs", "check-fast-4baa50.log"), "unit: red\n");
  mkdirSync(hookLogs, { recursive: true });
  writeFileSync(join(hookLogs, "check-gate-2026-10-07.jsonl"), '{"verdict":"block"}\n');
}

describe("a stage job's uploaded machine logs carry its check logs and the owner's hook logs", () => {
  it("files both under the machine logs when the job's .git/machine-logs links into its tree", () => {
    const root = scratch("stage-logs-");
    const treeGit = join(root, "tree", ".git");
    const hookLogs = join(root, "runner-temp", "hook-logs");
    mkdirSync(join(treeGit, "machine-logs"), { recursive: true });
    mkdirSync(join(root, ".git"));
    symlinkSync(join(treeGit, "machine-logs"), join(root, ".git", "machine-logs"));
    stocked(treeGit, hookLogs);

    const kept = keeping(root, hookLogs);

    expect(kept.status, kept.stderr).toBe(0);
    expect(readFileSync(join(treeGit, "machine-logs", "check", "check-fast-4baa50.log"), "utf8")).toBe("unit: red\n");
    expect(readFileSync(join(treeGit, "machine-logs", "hooks", "check-gate-2026-10-07.jsonl"), "utf8")).toContain("block");
  });

  it("files both when the job runs in the repo itself, and a job with neither still uploads", () => {
    const root = scratch("stage-logs-");
    const hookLogs = join(root, "runner-temp", "hook-logs");
    mkdirSync(join(root, ".git", "machine-logs"), { recursive: true });
    stocked(join(root, ".git"), hookLogs);

    expect(keeping(root, hookLogs).status).toBe(0);
    expect(readFileSync(join(root, ".git", "machine-logs", "check", "check-fast-4baa50.log"), "utf8")).toBe("unit: red\n");

    const bare = scratch("stage-logs-");
    mkdirSync(join(bare, ".git", "machine-logs"), { recursive: true });
    expect(keeping(bare, join(bare, "absent")).status).toBe(0);
    expect(stepRunning("stage-logs", "HOOK_LOG_DIR").if).toBe("always()");
  });

  it("points the owner's hooks at a log folder the job keeps, rather than the runner's home it throws away", () => {
    const root = scratch("stage-logs-");
    const runnerTemp = join(root, "runner-temp");
    const githubEnv = join(root, "github-env");
    mkdirSync(runnerTemp, { recursive: true });
    writeFileSync(githubEnv, "");

    const readied = spawnSync("bash", ["-e", "-c", stepRunning("stage", "HOOK_LOG_DIR=").run ?? ""], {
      cwd: root,
      env: { ...process.env, HOME: join(root, "home"), RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv, GITHUB_ACTION_PATH: root },
      encoding: "utf8",
    });

    expect(readied.status, readied.stderr).toBe(0);
    expect(readFileSync(githubEnv, "utf8")).toContain(`HOOK_LOG_DIR=${join(runnerTemp, "hook-logs")}\n`);
  });
});

describe("a stage job on a runner shared with other jobs waits only for its own log captures (#1282)", () => {
  const capturing = (hooks: string, seconds: number) => {
    script(join(hooks, "capture.py"), `sleep ${seconds}`);
    return spawn("bash", [join(hooks, "capture.py")], { stdio: "ignore" });
  };

  it("files as soon as its own capture ends, while another job's capture on the same machine still runs", () => {
    const root = scratch("stage-logs-");
    const runnerTemp = join(root, "runner one", "_work", "_temp");
    const theirs = capturing(join(root, "runner two", "_work", "_temp", "agent-hooks"), 60);
    const ours = capturing(join(runnerTemp, "agent-hooks"), 2);
    try {
      const began = Date.now();
      const flushed = spawnSync("bash", ["-e", "-c", stepRunning("stage-logs", "KB_TOKEN").run ?? ""], {
        cwd: root,
        env: { ...process.env, HOME: join(root, "home"), RUNNER_TEMP: runnerTemp },
        encoding: "utf8",
        timeout: 20_000,
      });
      const waited = Date.now() - began;

      expect(flushed.status, flushed.stderr).toBe(0);
      expect(waited).toBeGreaterThanOrEqual(1_500);
      expect(waited).toBeLessThan(15_000);
    } finally {
      theirs.kill();
      ours.kill();
    }
  });
});
