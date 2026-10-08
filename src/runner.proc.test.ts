import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PC_HOST as HOST, PC_REPO as REPO, pcRunner, switching } from "./scenarios.ts";

describe("bin/runner moves a private repo's jobs between this PC and GitHub's runners", () => {
  it("sends a repo's next jobs to the PC once its PC runners are online, installing none it already has", () => {
    const { run, variable, sudo } = switching({ runners: [pcRunner(`${HOST}-1`), pcRunner(`${HOST}-2`)] });

    expect(run("pc")).toEqual({ status: 0, stdout: `runner: ${REPO} runs on this PC from its next job, 2 PC runners online\n`, stderr: "" });
    expect(variable()).toBe("pc");
    expect(sudo()).toEqual([]);
  });

  it("installs the PC runners a repo is missing, each its own service with its own home, and labels them pc", () => {
    const { run, variable, sudo } = switching({ userExists: false });

    const result = run("pc");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`runner: ${REPO} runs on this PC from its next job, 2 PC runners online, 2 installed\n`);
    expect(variable()).toBe("pc");
    const calls = sudo();
    expect(calls[0]).toMatch(/useradd .*--groups docker ghrunner$/);
    expect(calls.join("\n")).toContain("node-v24.11.0-linux-x64.tar.xz");
    for (const n of [1, 2]) {
      const dir = `/home/ghrunner/runners/collod873-Lumaria/${HOST}-${n}`;
      expect(calls.some((call) => call.includes(`cd ${dir} &&`) && call.includes(`--name '${HOST}-${n}' --labels pc`) && call.includes(`HOME=${dir}/home`))).toBe(true);
      expect(calls).toContain(`bash -c cd ${dir} && ./bin/installdependencies.sh >/dev/null && ./svc.sh install ghrunner >/dev/null && ./svc.sh start >/dev/null`);
    }
  });

  it("leaves a repo where it was when no PC runner comes online, so no job queues for a PC that never takes it", () => {
    const { run, variable } = switching({ runners: [pcRunner(`${HOST}-1`, "offline"), pcRunner(`${HOST}-2`, "offline")], startsOnline: false });

    const result = run("pc");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^runner: no PC runner of collod873\/Lumaria came online/);
    expect(variable()).toBeUndefined();
  });

  it("refuses a public repo, whose PRs from anyone would run on this PC", () => {
    const { run, variable, sudo } = switching({ isPrivate: false });

    const result = run("pc");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is public");
    expect(variable()).toBeUndefined();
    expect(sudo()).toEqual([]);
  });

  it("sends a repo's next jobs back to GitHub's runners, and says so when they already go there", () => {
    const { run, variable } = switching({ variable: "pc" });

    expect(run("github").stdout).toMatch(/^runner: collod873\/Lumaria runs on GitHub's runners from its next job/);
    expect(variable()).toBeUndefined();
    expect(run("github").stdout).toBe(`runner: ${REPO} already runs on GitHub's runners\n`);
  });

  it("says where a repo's jobs run without changing it", () => {
    const { run, gh } = switching({ variable: "pc", runners: [pcRunner(`${HOST}-1`), pcRunner(`${HOST}-2`, "offline")] });

    expect(run().stdout).toBe(`runner: ${REPO} runs on this PC, 1 of 2 PC runners online\n`);
    expect(gh().filter((call) => /variable (set|delete)/.test(call))).toEqual([]);
  });
});

describe("the machine's jobs run where the repo's switch says", () => {
  it("every job of the stage workflows reads the calling repo's CI_RUNNER, falling back to GitHub's runners", () => {
    for (const file of ["tickets.yml", "specs.yml"]) {
      const text = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", file), "utf8");
      const runsOn = text.match(/^ {4}runs-on: .*$/gm) ?? [];
      expect(runsOn.length, file).toBeGreaterThan(0);
      for (const line of runsOn) expect(line, file).toBe("    runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}");
    }
  });
});
