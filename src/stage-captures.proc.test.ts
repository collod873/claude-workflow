import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { script, scratch } from "./scenarios.ts";

const ACTION = join(import.meta.dirname, "..", ".github", "actions", "stage", "action.yml");

interface Step {
  run?: string;
  with?: Record<string, unknown>;
  "continue-on-error"?: boolean;
}

const stageSteps = (): Step[] => (parse(readFileSync(ACTION, "utf8")) as { runs: { steps: Step[] } }).runs.steps;

const capturesFetch = (): Step => {
  const step = stageSteps().find((candidate) => (candidate.run ?? "").includes("SESSION_CAPTURES="));
  expect(step, "a step that fetches the session captures").toBeDefined();
  return step as Step;
};

function fetching(git: string): { status: number | null; handed: string; held: string[]; filing: boolean } {
  const root = scratch("stage-captures-");
  const runnerTemp = join(root, "runner-temp");
  const githubEnv = join(root, "github-env");
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(githubEnv, "");
  script(join(root, "bin", "git"), git);

  const { status } = spawnSync("bash", ["-e", "-c", capturesFetch().run ?? ""], {
    cwd: root,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, CAPTURES_TOKEN: "captures-token", HOME: root, RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv },
    encoding: "utf8",
  });
  const handed = /^SESSION_CAPTURES=(.*)$/m.exec(readFileSync(githubEnv, "utf8"))?.[1] ?? "";
  return { status, handed, held: handed === "" ? [] : readdirSync(handed).sort(), filing: existsSync(join(root, "Claude Projects", "transcripts")) };
}

describe("a failed fetch of the session captures leaves the job its stage, with an empty captures folder (#999)", () => {
  it("a clone GitHub answers with Repository not found still hands the job an empty captures folder and a transcripts folder to file into, and the step cannot end the job", () => {
    const failed = fetching("[ \"$1\" = clone ] && { echo 'remote: Repository not found.' >&2; exit 128; }\nexit 1");
    const minted = stageSteps().find((step) => step.with?.repositories === "transcripts");

    expect(failed.status).not.toBe(0);
    expect(failed.handed).not.toBe("");
    expect(failed.held).toEqual([]);
    expect(failed.filing).toBe(true);
    expect(capturesFetch()["continue-on-error"]).toBe(true);
    expect(minted?.["continue-on-error"]).toBe(true);
  });

  it("a clone that works hands the job the Workflow captures, each named for its session's folder, and no others", () => {
    const worked = fetching(
      [
        'if [ "$1" = clone ]; then',
        '  dir="${@: -1}"',
        '  mkdir -p "$dir/2026-10/2026-10-09T1747-claude-workflow-e9e8c59b" "$dir/2026-10/2026-10-09T1801-Lumaria-0a1b2c3d"',
        "  printf 'project: /home/collin/Claude Projects/Workflow\\n' >\"$dir/2026-10/2026-10-09T1747-claude-workflow-e9e8c59b/session.md\"",
        "  printf 'project: /home/collin/Elsewhere\\n' >\"$dir/2026-10/2026-10-09T1801-Lumaria-0a1b2c3d/session.md\"",
        "fi",
        "exit 0",
      ].join("\n"),
    );

    expect(worked.status).toBe(0);
    expect(worked.held).toEqual(["2026-10-09T1747-claude-workflow-e9e8c59b.md"]);
  });
});
