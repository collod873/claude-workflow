import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, PC_HOST as HOST, PC_REPO as REPO, PC_RUNNER_COUNT, pcRunner, scratch, script, switching } from "./scenarios.ts";

describe("bin/runner moves a private repo's jobs between this PC and GitHub's runners", () => {
  it("sends a repo's next jobs to the PC once its PC runners are online, installing none it already has", () => {
    const { run, variable, sudo } = switching({ runners: Array.from({ length: PC_RUNNER_COUNT }, (_, at) => pcRunner(`${HOST}-${at + 1}`)) });

    expect(run("pc")).toEqual({ status: 0, stdout: `runner: ${REPO} runs on this PC from its next job, 6 PC runners online\n`, stderr: "" });
    expect(variable()).toBe("pc");
    expect(sudo().filter((call) => call.includes("config.sh"))).toEqual([]);
  });

  it("installs the PC runners a repo is missing, each its own service with its own home and temp, and labels them pc", () => {
    const { run, variable, sudo, placed } = switching({ userExists: false });

    const result = run("pc");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`runner: ${REPO} runs on this PC from its next job, 6 PC runners online, 6 installed\n`);
    expect(variable()).toBe("pc");
    const calls = sudo();
    expect(calls[0]).toMatch(/useradd .*--groups docker ghrunner$/);
    expect(calls.join("\n")).toContain("node-v24.11.0-linux-x64.tar.xz");
    for (let n = 1; n <= PC_RUNNER_COUNT; n += 1) {
      const dir = `/home/ghrunner/runners/collod873-Lumaria/${HOST}-${n}`;
      expect(calls.some((call) => call.includes(`cd ${dir} &&`) && call.includes(`--name '${HOST}-${n}' --labels pc`))).toBe(true);
      expect(calls).toContain(`bash -c cd ${dir} && ./bin/installdependencies.sh >/dev/null && ./svc.sh install ghrunner >/dev/null`);
    }
    const dir = `/home/ghrunner/runners/collod873-Lumaria/${HOST}-2`;
    expect(placed(`${dir}/.env`).split("\n")).toEqual(expect.arrayContaining([`HOME=${dir}/home`, `TMPDIR=${dir}/tmp`, `ACTIONS_RUNNER_HOOK_JOB_STARTED=${dir}/clear.sh`, `ACTIONS_RUNNER_HOOK_JOB_COMPLETED=${dir}/clear.sh`]));
  });

  it("installs only the PC runners a repo lacks, so a repo with two gains the other four", () => {
    const { run, sudo } = switching({ runners: [pcRunner(`${HOST}-1`), pcRunner(`${HOST}-2`)] });

    expect(run("pc").stdout).toContain(", 4 installed");
    expect(sudo().filter((call) => call.includes("config.sh")).map((call) => /--name '([^']+)'/.exec(call)?.[1])).toEqual([3, 4, 5, 6].map((n) => `${HOST}-${n}`));
  });

  it("restarts a PC runner only when its setup changed, so a flip never kills a job it is running", () => {
    const { run, sudo } = switching();
    run("pc");
    const before = sudo().length;

    run("pc");

    const again = sudo().slice(before);
    expect(again.filter((call) => call.includes("svc.sh start"))).toHaveLength(PC_RUNNER_COUNT);
    expect(again.filter((call) => call.includes("svc.sh stop"))).toEqual([]);
  });

  it("starts and ends every job on a cleared home, temp and workspace with its runner's Postgres gone, as GitHub's fresh runner does, so no job reads what the last one left", () => {
    const { run, placed } = switching();
    run("pc");
    const runnerDir = scratch("pc-runner-");
    const hook = join(runnerDir, "clear.sh");
    writeFileSync(hook, placed(`/home/ghrunner/runners/collod873-Lumaria/${HOST}-1/clear.sh`));
    chmodSync(hook, 0o755);
    const removed = join(runnerDir, "removed");
    script(join(runnerDir, "bin", "docker"), `case $1 in\n  ps) [[ $* == *"name=^database-${HOST}-1$"* ]] && printf 'c0ffee\\n' ;;\n  rm) printf '%s\\n' "$*" >>"${removed}" ;;\nesac\n`);
    const left = { HOME: join(runnerDir, "home"), TMPDIR: join(runnerDir, "tmp"), GITHUB_WORKSPACE: join(runnerDir, "_work", "Lumaria", "Lumaria") };
    const env = { ...left, PATH: `${join(runnerDir, "bin")}:${process.env.PATH}` };
    for (const dir of Object.values(left)) {
      mkdirSync(join(dir, ".claude", "projects"), { recursive: true });
      writeFileSync(join(dir, ".claude", "projects", "memory.md"), "the last ticket's notes");
    }

    expect(execute(hook, runnerDir, env).status).toBe(0);
    for (const dir of Object.values(left)) expect(readdirSync(dir), dir).toEqual([]);
    expect(readFileSync(removed, "utf8")).toBe("rm --force c0ffee\n");

    const outside = execute(hook, runnerDir, { ...env, HOME: "/home/collin" });
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("/home/collin is outside this runner");
  });

  it("leaves a mid-job PC runner on its old setup rather than kill the job under it, and gives it the new one once the job ends", () => {
    const { run, sudo, placed } = switching({ runners: [pcRunner(`${HOST}-1`, "online", true), pcRunner(`${HOST}-2`)] });
    const dropIn = `/etc/systemd/system/actions.runner.collod873-Lumaria.${HOST}-1.service.d/pc-runner.conf`;

    const result = run("pc");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`; ${HOST}-1 kept their old setup mid-job: run this again once they finish`);
    expect(sudo().filter((call) => call.includes(`${HOST}-1 && `) && call.includes("svc.sh"))).toEqual([]);
    expect(() => placed(dropIn)).toThrow();
    const before = sudo().length;

    expect(run("pc").stdout).not.toContain("mid-job");
    expect(sudo().slice(before)).toContain(`bash -c cd /home/ghrunner/runners/collod873-Lumaria/${HOST}-1 && systemctl daemon-reload && ./svc.sh stop >/dev/null && ./svc.sh start >/dev/null`);
    expect(placed(dropIn)).toContain("Slice=pc-runners.slice");
  });

  it("holds every PC runner's jobs together under a 10 GB cap with no swap, so a runaway job is killed alone and the runner stays up for the next", () => {
    const { run, sudo, placed } = switching();

    run("pc");

    expect(placed("/etc/systemd/system/pc-runners.slice").split("\n")).toEqual(["[Slice]", "MemoryHigh=9G", "MemoryMax=10G", "MemorySwapMax=0", ""]);
    for (let n = 1; n <= PC_RUNNER_COUNT; n += 1) {
      expect(placed(`/etc/systemd/system/actions.runner.collod873-Lumaria.${HOST}-${n}.service.d/pc-runner.conf`).split("\n")).toEqual(["[Service]", "Slice=pc-runners.slice", "OOMPolicy=continue", "KillMode=mixed", ""]);
    }
    expect(sudo()).toContain("bash -c systemctl daemon-reload");
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
    expect(run("github").stdout).toBe(`runner: ${REPO} already runs on GitHub's runners, 0 PC runners stopped\n`);
  });

  it("stops the repo's idle PC runners when it goes back to GitHub, leaving one mid-job to finish", () => {
    const { run, sudo } = switching({ variable: "pc", runners: [pcRunner(`${HOST}-1`), pcRunner(`${HOST}-2`, "online", true), pcRunner("imac-1")] });

    const result = run("github");

    expect(result.stdout).toContain("1 PC runners stopped, 1 still mid-job");
    expect(sudo()).toEqual([`bash -c cd /home/ghrunner/runners/collod873-Lumaria/${HOST}-1 && ./svc.sh stop >/dev/null`]);
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
