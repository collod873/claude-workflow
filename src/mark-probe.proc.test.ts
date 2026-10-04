import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { copyMark, scratch, script, type WorkflowStep } from "./scenarios.ts";

const PROBE = join(import.meta.dirname, "..", ".github", "workflows", "mark-probe.yml");

interface Probe {
  on: { push?: { branches?: string[] }; workflow_dispatch?: unknown };
  jobs: Record<string, { steps: WorkflowStep[] }>;
}

const probe = () => parse(readFileSync(PROBE, "utf8")) as Probe;

function probed(gh: string) {
  const steps = Object.values(probe().jobs).flatMap((job) => job.steps);
  const marks = steps.filter((step) => /(^|[\s(])bin\/mark 0 "\$checking"/.test(step.run ?? ""));
  expect(marks).toHaveLength(1);
  const [step] = marks as [WorkflowStep];
  expect(step.env).toMatchObject({ GH_TOKEN: expect.any(String), GH_REPO: expect.any(String) });
  const root = scratch("mark-probe-");
  script(join(root, "bin", "gh"), gh);
  copyMark(root);
  const { status, stdout, stderr } = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run ?? ""], {
    cwd: root,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` },
    encoding: "utf8",
  });
  return { status, said: `${stdout}${stderr}` };
}

describe("a run on main makes a mark fail on purpose, so the done check sees a failed mark's error in a run log (#1090)", () => {
  it("runs on every push to main and on demand", () => {
    const { on } = probe();

    expect(on.push?.branches).toEqual(["main"]);
    expect(on).toHaveProperty("workflow_dispatch");
  });

  it("passes with bin/mark's refusal in its log when GitHub answers HTTP 404", () => {
    const { status, said } = probed("printf 'gh: Not Found (HTTP 404)\\n' >&2\nexit 1\n");

    expect(status, said).toBe(0);
    expect(said).toContain("mark: #0 not labelled checking: gh: Not Found (HTTP 404)\n");
  });

  it("ends red, saying a failed mark no longer reaches the log, when the mark succeeds", () => {
    const { status, said } = probed("exit 0\n");

    expect(status).toBe(1);
    expect(said).toMatch(/failed mark no longer reaches the log/);
  });
});
