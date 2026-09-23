import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { script, scratch } from "./scenarios.ts";

const REPO = join(import.meta.dirname, "..");
const ACTION = join(REPO, ".github", "actions", "stage", "action.yml");
const ROW = "A job cannot fetch the owner's hooks after 3 tries";

interface Step {
  shell?: string;
  run?: string;
}

interface Action {
  runs: { steps: Step[] };
}

function hooksFetchScript(): string {
  const { runs } = parse(readFileSync(ACTION, "utf8")) as Action;
  const step = runs.steps.find((candidate) => (candidate.run ?? "").includes("git clone"));
  expect(step, "a step that clones the owner's hooks").toBeDefined();
  return (step as Step).run ?? "";
}

describe("the stage action's hooks fetch survives a transient clone failure (#849)", () => {
  it("retries the hooks fetch up to 3 times, and a third failure leaves a log opening with the row for it", () => {
    const root = scratch("stage-hooks-");
    const runnerTemp = join(root, "runner-temp");
    const actionPath = join(root, "action-path");
    const calls = join(root, "git-clone-calls");
    mkdirSync(runnerTemp, { recursive: true });
    mkdirSync(actionPath, { recursive: true });
    writeFileSync(join(root, "github-env"), "");
    writeFileSync(join(actionPath, "feed.jq"), ".\n");
    script(
      join(root, "bin", "git"),
      ['if [ "$1" = clone ]; then', `  printf 'attempt\\n' >>"${calls}"`, "  echo 'fatal: repository not found' >&2", "  exit 128", "fi", "exit 1"].join("\n"),
    );

    const run = spawnSync("bash", ["-e", "-c", hooksFetchScript()], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        HOOKS_TOKEN: "hooks-token",
        RUNNER_TEMP: runnerTemp,
        GITHUB_ACTION_PATH: actionPath,
        GITHUB_ENV: join(root, "github-env"),
      },
      encoding: "utf8",
    });

    expect(run.status).not.toBe(0);
    expect(existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0).toBe(3);
    const logged = readFileSync(join(runnerTemp, "agent-hooks-unreachable.log"), "utf8");
    expect(logged.startsWith(ROW)).toBe(true);
  });
});
