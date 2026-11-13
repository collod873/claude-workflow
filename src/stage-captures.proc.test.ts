import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { script, scratch } from "./scenarios.ts";

const ACTION = join(import.meta.dirname, "..", ".github", "actions", "stage", "action.yml");

interface Step {
  id?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
  "continue-on-error"?: boolean;
}

const stageSteps = (): Step[] => (parse(readFileSync(ACTION, "utf8")) as { runs: { steps: Step[] } }).runs.steps;

const capturesFetch = (): Step => {
  const step = stageSteps().find((candidate) => candidate.id === "captures-fetch");
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

const designKitFetch = (): Step => {
  const step = stageSteps().find((candidate) => candidate.id === "design-kit-fetch");
  expect(step, "a step that clones design-kit for the ticket builder").toBeDefined();
  return step as Step;
};

function cloningDesignKit(failures: number): { status: number | null; calls: string[]; kit: string } {
  const root = scratch("stage-design-kit-");
  const calls = join(root, "calls");
  const failed = join(root, "failed");
  script(join(root, "bin", "sleep"), "exit 0");
  script(
    join(root, "bin", "git"),
    [
      `printf '%s\\n' "$*" >>'${calls}'`,
      'if [ "$1" = clone ]; then',
      `  tries=$(cat '${failed}' 2>/dev/null || echo 0)`,
      `  if [ "$tries" -lt ${String(failures)} ]; then echo $((tries + 1)) >'${failed}'; mkdir -p "\${@: -1}"; exit 128; fi`,
      '  mkdir -p "${@: -1}/.git"',
      "fi",
      "exit 0",
    ].join("\n"),
  );
  const { status } = spawnSync("bash", ["-e", "-c", designKitFetch().run ?? ""], {
    cwd: root,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, DESIGN_KIT_TOKEN: "kit-token", HOME: root, GITHUB_REPOSITORY_OWNER: "collod873" },
    encoding: "utf8",
  });
  return { status, calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [], kit: join(root, "Claude Projects", "design-kit") };
}

describe("a ticket builder gets design-kit cloned in full where the kit-land launcher looks, pushing with its own App token (#1754)", () => {
  it("clones design-kit with the design-kit token and no --depth into $HOME/Claude Projects/design-kit, keeps .git, and leaves its origin without a credential", () => {
    const cloned = cloningDesignKit(2);
    const clones = cloned.calls.filter((call) => call.startsWith("clone "));

    expect(cloned.status).toBe(0);
    expect(clones).toHaveLength(3);
    expect(clones[2]).toBe(`clone --quiet https://x-access-token:kit-token@github.com/collod873/design-kit ${cloned.kit}`);
    expect(existsSync(join(cloned.kit, ".git"))).toBe(true);
    expect(cloned.calls.at(-1)).toBe(`-C ${cloned.kit} remote set-url origin https://github.com/collod873/design-kit`);
  });

  it("ends the step red once a third clone fails", () => {
    const refused = cloningDesignKit(3);

    expect(refused.status).not.toBe(0);
    expect(refused.calls.filter((call) => call.startsWith("clone "))).toHaveLength(3);
  });
});
