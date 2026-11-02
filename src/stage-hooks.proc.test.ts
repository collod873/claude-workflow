import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { script, scratch } from "./scenarios.ts";

const REPO = join(import.meta.dirname, "..");
const ACTION = join(REPO, ".github", "actions", "hooks", "action.yml");
const ROW = "A job cannot fetch the owner's hooks after 3 tries";

interface Step {
  id?: string;
  shell?: string;
  run?: string;
}

interface Action {
  runs: { steps: Step[] };
}

function stepScript(id: string): string {
  const { runs } = parse(readFileSync(ACTION, "utf8")) as Action;
  const step = runs.steps.find((candidate) => candidate.id === id);
  expect(step, `a step with id ${id}`).toBeDefined();
  return (step as Step).run ?? "";
}

describe("the hooks action's Python keeps what setup installs whatever HOME a tool runs under (#1632)", () => {
  it("puts a venv's python3 first on PATH, so setup installs into it and not into HOME's user site", () => {
    const root = scratch("stage-python-");
    const runnerTemp = join(root, "runner-temp");
    const githubPath = join(root, "github-path");
    const githubEnv = join(root, "github-env");
    const swappedHome = join(root, "sandbox-home");
    mkdirSync(runnerTemp, { recursive: true });
    mkdirSync(swappedHome, { recursive: true });

    const made = spawnSync("bash", ["-e", "-c", stepScript("python-venv")], {
      cwd: root,
      env: { ...process.env, RUNNER_TEMP: runnerTemp, GITHUB_PATH: githubPath, GITHUB_ENV: githubEnv },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(made.status, made.stderr).toBe(0);

    const pathed = readFileSync(githubPath, "utf8").trim().split("\n");
    const probe = spawnSync("python3", ["-c", "import sys, sysconfig; print(sys.prefix != sys.base_prefix, sysconfig.get_path('purelib'), sys.prefix)"], {
      env: { PATH: [...pathed, process.env.PATH].join(":"), HOME: swappedHome },
      encoding: "utf8",
    });
    const [isVenv, sitePackages, venvPrefix] = probe.stdout.trim().split(" ");
    expect(isVenv).toBe("True");
    expect(sitePackages?.startsWith(runnerTemp)).toBe(true);
    expect(readFileSync(githubEnv, "utf8")).toContain(`VIRTUAL_ENV=${venvPrefix}\n`);
  });
});

describe("the hooks action's fetch survives a transient clone failure (#849)", () => {
  it("retries the hooks fetch up to 3 times, and a third failure leaves a log opening with the row for it", () => {
    const root = scratch("stage-hooks-");
    const runnerTemp = join(root, "runner-temp");
    const calls = join(root, "git-clone-calls");
    mkdirSync(runnerTemp, { recursive: true });
    script(
      join(root, "bin", "git"),
      ['if [ "$1" = clone ]; then', `  printf 'attempt\\n' >>"${calls}"`, "  echo 'fatal: repository not found' >&2", "  exit 128", "fi", "exit 1"].join("\n"),
    );

    const run = spawnSync("bash", ["-e", "-c", stepScript("hooks-fetch")], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        HOOKS_TOKEN: "hooks-token",
        RUNNER_TEMP: runnerTemp,
      },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(run.signal).toBeNull();
    expect(run.status).toBe(1);
    expect(existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0).toBe(3);
    const logged = readFileSync(join(runnerTemp, "agent-hooks-unreachable.log"), "utf8");
    expect(logged.startsWith(ROW)).toBe(true);
    expect(run.stderr).toContain(ROW);
    expect(run.stderr).toContain("fatal: repository not found");
  });
});
