import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, PC_HOST as HOST, PC_REPO as REPO, PC_RUNNER_COUNT, PC_RUNS_ON, pcRunner, QUICK_RUNNER_COUNT, quickRunners, QUICK_RUNS_ON, scratch, script, switching, workflowJobs } from "./scenarios.ts";

const SOCKET_PATH_MAX = 107;

describe("bin/runner moves a private repo's jobs between this PC and GitHub's runners", () => {
  it("sends a repo's next jobs to the PC once its PC runners are online, installing none it already has", () => {
    const { run, variable, sudo } = switching({ runners: [...Array.from({ length: PC_RUNNER_COUNT }, (_, at) => pcRunner(`${HOST}-${at + 1}`)), ...quickRunners()] });

    expect(run("pc")).toEqual({ status: 0, stdout: `runner: ${REPO} runs on this PC from its next job, 2 PC runners online, 4 quick runners online\n`, stderr: "" });
    expect(variable()).toBe("pc");
    expect(sudo().filter((call) => call.includes("config.sh"))).toEqual([]);
  });

  it("installs the PC runners a repo is missing, each its own service with its own home and temp, and labels them pc", () => {
    const { run, variable, sudo, placed } = switching({ userExists: false });

    const result = run("pc");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`runner: ${REPO} runs on this PC from its next job, 2 PC runners online, 4 quick runners online, 6 installed\n`);
    expect(variable()).toBe("pc");
    const calls = sudo();
    expect(calls[0]).toMatch(/useradd .*--groups docker ghrunner$/);
    expect(calls.join("\n")).toMatch(/node-v\d+\.\d+\.\d+-linux-x64\.tar\.xz/);
    for (let n = 1; n <= PC_RUNNER_COUNT; n += 1) {
      const dir = `/home/ghrunner/runners/collod873-Lumaria/${HOST}-${n}`;
      expect(calls.some((call) => call.includes(`cd ${dir} &&`) && call.includes(`--name '${HOST}-${n}' --labels pc`))).toBe(true);
      expect(calls.some((call) => call.includes(`cd ${dir} &&`) && call.includes("svc.sh install ghrunner"))).toBe(true);
    }
    const dir = `/home/ghrunner/runners/collod873-Lumaria/${HOST}-2`;
    expect(placed(`${dir}/.env`).split("\n")).toEqual(expect.arrayContaining([`HOME=${dir}/home`, `ACTIONS_RUNNER_HOOK_JOB_STARTED=${dir}/clear.sh`, `ACTIONS_RUNNER_HOOK_JOB_COMPLETED=${dir}/clear.sh`, "CHECK_SLOTS=2", "CHECK_SLOTS_DIR=/home/ghrunner/check-slots"]));
  });

  it("gives each PC runner its own temp folder short enough that a socket a job opens under it fits Linux's 107 characters, however long the repo's name", () => {
    const { run, placed } = switching({ userExists: false });
    run("pc");

    const temps = Array.from({ length: PC_RUNNER_COUNT }, (_, at) => /^TMPDIR=(.+)$/m.exec(placed(`/home/ghrunner/runners/collod873-Lumaria/${HOST}-${at + 1}/.env`))?.[1] ?? "");

    expect(new Set(temps).size).toBe(PC_RUNNER_COUNT);
    for (const temp of temps) {
      expect(temp).not.toContain("Lumaria");
      expect(`${temp}/runs-1001/0d5ca037/tsx-1001/4194304.pipe`.length).toBeLessThanOrEqual(SOCKET_PATH_MAX);
    }
  });

  it("installs only the PC runners a repo lacks, so a repo with two asked for four gains the other two", () => {
    const { run, sudo } = switching({ runners: [pcRunner(`${HOST}-1`), pcRunner(`${HOST}-2`), ...quickRunners()] });

    expect(run("pc", "4").stdout).toContain(", 2 installed");
    expect(sudo().filter((call) => call.includes("config.sh")).map((call) => /--name '([^']+)'/.exec(call)?.[1])).toEqual([3, 4].map((n) => `${HOST}-${n}`));
  });

  it("keeps only as many PC runners as asked, turning the rest off for good and letting a mid-job one finish first", () => {
    const { run, sudo } = switching({ runners: [...Array.from({ length: 6 }, (_, at) => pcRunner(`${HOST}-${at + 1}`, "online", at === 2)), ...quickRunners()] });
    const unit = (n: number) => `actions.runner.collod873-Lumaria.${HOST}-${n}.service`;

    const result = run("pc", "1");

    expect(result.stdout).toBe(`runner: ${REPO} runs on this PC from its next job, 1 PC runners online, 4 quick runners online, 5 turned off, 1 once its job ends\n`);
    const calls = sudo();
    expect(calls.filter((call) => call.includes("systemctl disable"))).toEqual([2, 3, 4, 5, 6].map((n) => `bash -c systemctl disable --quiet ${n === 3 ? "" : "--now "}${unit(n)}`));
    expect(calls.filter((call) => call.includes("svc.sh start") && !call.includes("-quick-"))).toHaveLength(1);
    expect(calls.some((call) => call.includes(`systemctl enable --quiet ${unit(1)}`))).toBe(true);
  });

  it("restarts a PC runner only when its setup changed, so a flip never kills a job it is running", () => {
    const { run, sudo } = switching();
    run("pc");
    const before = sudo().length;

    run("pc");

    const again = sudo().slice(before);
    expect(again.filter((call) => call.includes("svc.sh start"))).toHaveLength(PC_RUNNER_COUNT + QUICK_RUNNER_COUNT);
    expect(again.filter((call) => call.includes("svc.sh stop"))).toEqual([]);
  });

  it("starts and ends every job on a cleared home, temp and workspace with its runner's Postgres gone, as GitHub's fresh runner does, so no job reads what the last one left, while killing nothing outside its runner's service", () => {
    const { run, placed } = switching();
    run("pc");
    const runnerDir = scratch("pc-runner-");
    const hook = join(runnerDir, "clear.sh");
    writeFileSync(hook, placed(`/home/ghrunner/runners/collod873-Lumaria/${HOST}-1/clear.sh`));
    chmodSync(hook, 0o755);
    const removed = join(runnerDir, "removed");
    script(join(runnerDir, "bin", "docker"), `case $1 in\n  ps) [[ $* == *"name=^database-collod873-Lumaria-${HOST}-1$"* ]] && printf 'c0ffee\\n' ;;\n  rm) printf '%s\\n' "$*" >>"${removed}" ;;\nesac\n`);
    const temp = scratch("pc-temp-");
    writeFileSync(join(runnerDir, ".env"), `HOME=${join(runnerDir, "home")}\nTMPDIR=${temp}\n`);
    const left = { HOME: join(runnerDir, "home"), TMPDIR: temp, GITHUB_WORKSPACE: join(runnerDir, "_work", "Lumaria", "Lumaria") };
    const env = { ...left, PATH: `${join(runnerDir, "bin")}:${process.env.PATH}` };
    for (const dir of Object.values(left)) {
      mkdirSync(join(dir, ".claude", "projects"), { recursive: true });
      writeFileSync(join(dir, ".claude", "projects", "memory.md"), "the last ticket's notes");
    }

    expect(execute(hook, runnerDir, env).status).toBe(0);
    for (const dir of Object.values(left)) expect(readdirSync(dir), dir).toEqual([]);
    expect(readFileSync(removed, "utf8")).toBe("rm --force c0ffee\n");

    const neighbour = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    expect(execute(hook, runnerDir, env).status).toBe(0);
    expect(() => process.kill(neighbour.pid ?? 0, 0)).not.toThrow();
    neighbour.kill("SIGKILL");

    const outside = execute(hook, runnerDir, { ...env, HOME: "/home/collin" });
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("/home/collin is outside this runner");

    const sharedTemp = execute(hook, runnerDir, { ...env, TMPDIR: "/tmp" });
    expect(sharedTemp.status).toBe(1);
    expect(sharedTemp.stderr).toContain("/tmp is outside this runner");
  });

  it("leaves a mid-job PC runner on its old setup rather than kill the job under it, and gives it the new one once the job ends", () => {
    const { run, sudo, placed, jobsEnded } = switching({ runners: [pcRunner(`${HOST}-1`, "online", true), pcRunner(`${HOST}-2`)] });
    const dropIn = `/etc/systemd/system/actions.runner.collod873-Lumaria.${HOST}-1.service.d/pc-runner.conf`;

    const result = run("pc");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`; ${HOST}-1 kept their old setup mid-job: run this again once they finish`);
    expect(sudo().filter((call) => call.includes(`${HOST}-1 && `) && call.includes("svc.sh"))).toEqual([]);
    expect(() => placed(dropIn)).toThrow();
    jobsEnded();
    const before = sudo().length;

    expect(run("pc").stdout).not.toContain("mid-job");
    expect(sudo().slice(before).some((call) => call.includes(`${HOST}-1 &&`) && call.includes("svc.sh stop") && call.includes("svc.sh start"))).toBe(true);
    expect(placed(dropIn)).toContain("Slice=pc-runners.slice");
  });

  it("gives a runner stopped by hand its new setup at once, though GitHub still shows it mid-job", () => {
    const { run, placed } = switching({ runners: [pcRunner(`${HOST}-1`, "online", true), pcRunner(`${HOST}-2`), ...quickRunners()], stoppedByHand: [`${HOST}-1`] });

    expect(run("pc").stdout).toBe(`runner: ${REPO} runs on this PC from its next job, 2 PC runners online, 4 quick runners online\n`);
    expect(placed(`/etc/systemd/system/actions.runner.collod873-Lumaria.${HOST}-1.service.d/pc-runner.conf`)).toContain("Slice=pc-runners.slice");
  });

  it("counts a repo's PC runners online only once every one asked for is up, and says how many are still starting", () => {
    const { run } = switching({ runners: [...[1, 2, 3, 4].map((n) => pcRunner(`${HOST}-${n}`, "offline")), ...quickRunners()], slowToStart: [`${HOST}-3`, `${HOST}-4`] });

    expect(run("pc", "4").stdout).toBe(`runner: ${REPO} runs on this PC from its next job, 2 of 4 PC runners online, the rest still starting, 4 quick runners online\n`);
  });

  it("keeps as many PC runners as are already online when no count is given, so a repo on four is not cut back to the default", () => {
    const { run, sudo } = switching({ runners: [...[1, 2, 3, 4].map((n) => pcRunner(`${HOST}-${n}`)), ...quickRunners()] });

    expect(run("pc").stdout).toBe(`runner: ${REPO} runs on this PC from its next job, 4 PC runners online, 4 quick runners online\n`);
    expect(sudo().filter((call) => call.includes("systemctl disable"))).toEqual([]);
  });

  it("gives every PC runner GitHub's current gh ahead of Ubuntu's, which lacks commands the closer runs", () => {
    const { run, sudo, placed } = switching();

    run("pc");

    expect(sudo().join("\n")).toMatch(/github\.com\/cli\/cli\/releases\/download\/v\d+\.\d+\.\d+\/gh_[\d.]+_linux_amd64\.tar\.gz/);
    const path = placed(`/home/ghrunner/runners/collod873-Lumaria/${HOST}-1/.path`).trim().split(":");
    expect(path.indexOf("/home/ghrunner/gh/bin")).toBeGreaterThanOrEqual(0);
    expect(path.indexOf("/home/ghrunner/gh/bin")).toBeLessThan(path.indexOf("/usr/bin"));
  });

  it("sets earlyoom and each runner's jobs so the process using the most memory is killed when memory runs out, whether or not it is a runner's job, so a rebuilt PC gets the same order", () => {
    const { run, sudo, placed } = switching();

    run("pc");

    const args = placed("/etc/default/earlyoom");
    expect(args).not.toMatch(/--prefer|--avoid/);
    expect(placed(`/home/ghrunner/runners/collod873-Lumaria/${HOST}-1/.env`).split("\n")).toContain("PIPELINE_JOB_OOMSCOREADJ=0");
    expect(sudo().some((call) => call.includes("apt-get install") && call.includes("earlyoom"))).toBe(true);
    expect(sudo().some((call) => call.includes("restart earlyoom"))).toBe(true);
    const before = sudo().length;

    run("pc");

    expect(sudo().slice(before).filter((call) => call.includes("restart earlyoom"))).toEqual([]);
  });

  it("holds every PC runner's jobs together under a 20 GB cap with no swap on the PC's last 8 CPUs, and each runner to 10 GB on 4 of them, so a build sizes its workers to 4 and a runaway job is killed rather than slowed", () => {
    const { run, sudo, placed } = switching();

    run("pc");

    expect(placed("/etc/systemd/system/pc-runners.slice").split("\n")).toEqual(expect.arrayContaining(["MemoryMax=20G", "MemorySwapMax=0", "AllowedCPUs=8-15"]));
    for (const [n, cpus] of [[1, "8-11"], [2, "12-15"]] as const) {
      expect(placed(`/etc/systemd/system/actions.runner.collod873-Lumaria.${HOST}-${n}.service.d/pc-runner.conf`).split("\n")).toEqual(expect.arrayContaining(["Slice=pc-runners.slice", "MemoryMax=10G", "MemorySwapMax=0", `AllowedCPUs=${cpus}`, "OOMPolicy=continue"]));
    }
    expect(sudo()).toContain("bash -c systemctl daemon-reload");
  });

  it("installs quick runners beside the build runners, labelled pc-quick alone, under their own small cap outside the build runners' 20 GB, and points the repo's quick jobs at them", () => {
    const { run, sudo, placed, quickVariable } = switching({ userExists: false });

    expect(run("pc").status).toBe(0);

    const configs = sudo().filter((call) => call.includes("config.sh"));
    for (let n = 1; n <= QUICK_RUNNER_COUNT; n += 1) expect(configs.some((call) => call.includes(`--name '${HOST}-quick-${n}' --labels pc-quick `))).toBe(true);
    expect(placed("/etc/systemd/system/pc-quick-runners.slice").split("\n")).toEqual(expect.arrayContaining(["MemoryMax=8G", "MemorySwapMax=0", "AllowedCPUs=0-7"]));
    expect(placed(`/etc/systemd/system/actions.runner.collod873-Lumaria.${HOST}-quick-1.service.d/pc-runner.conf`).split("\n")).toEqual(expect.arrayContaining(["Slice=pc-quick-runners.slice", "MemoryMax=3G", "MemorySwapMax=0", "AllowedCPUs=0-7"]));
    expect(quickVariable()).toBe("pc-quick");
  });

  it("labels every build runner pc-quick as well, so a quick job still runs when no quick runner is online, and never a build on a quick runner", () => {
    const { run, sudo, gh } = switching({ userExists: false, runners: [pcRunner(`${HOST}-1`, "online", false, ["pc"]), pcRunner("imac-1", "offline", false, ["pc"])] });

    expect(run("pc", "2").status).toBe(0);

    expect(sudo().some((call) => call.includes(`--name '${HOST}-2' --labels pc,pc-quick `))).toBe(true);
    const labelled = gh().filter((call) => call.includes("/labels"));
    expect(labelled).toEqual([`${HOST}-1`, "imac-1"].map((name) => `api -X POST repos/${REPO}/actions/runners/${pcRunner(name).id}/labels -f labels[]=pc-quick`));
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

  it("sends a repo's next jobs back to GitHub's runners, quick ones too, and says so when they already go there", () => {
    const { run, variable, quickVariable } = switching({ variable: "pc", quickVariable: "pc-quick" });

    expect(run("github").stdout).toMatch(/^runner: collod873\/Lumaria runs on GitHub's runners from its next job/);
    expect(variable()).toBeUndefined();
    expect(quickVariable()).toBeUndefined();
    expect(run("github").stdout).toBe(`runner: ${REPO} already runs on GitHub's runners, 0 PC runners stopped\n`);
  });

  it("stops the repo's idle PC runners when it goes back to GitHub, leaving one mid-job to finish", () => {
    const { run, sudo } = switching({ variable: "pc", runners: [pcRunner(`${HOST}-1`), pcRunner(`${HOST}-2`, "online", true), pcRunner(`${HOST}-quick-1`, "online", false, ["pc-quick"]), pcRunner("imac-1")] });

    const result = run("github");

    expect(result.stdout).toContain("2 PC runners stopped, 1 still mid-job");
    expect(sudo()).toEqual([`${HOST}-1`, `${HOST}-quick-1`].map((name) => `bash -c cd /home/ghrunner/runners/collod873-Lumaria/${name} && ./svc.sh stop >/dev/null`));
  });

  it("says where a repo's jobs run without changing it", () => {
    const { run, gh } = switching({ variable: "pc", runners: [pcRunner(`${HOST}-1`), pcRunner(`${HOST}-2`, "offline")] });

    expect(run().stdout).toBe(`runner: ${REPO} runs on this PC, 1 of 2 PC runners online, 0 of 0 quick runners\n`);
    expect(gh().filter((call) => /variable (set|delete)/.test(call))).toEqual([]);
  });
});

describe("the machine's jobs run where the repo's switch says, a quick job never queued behind a build", () => {
  const readiesTree = (uses: string | undefined) => uses === "./.github/actions/pinned" || uses === "./.github/actions/database";

  it("runs every job that readies the tree's toolchain or a database on the build runners, and every other on the quick lane, which falls back to the build runners and then to GitHub's", () => {
    const quick: string[] = [];
    for (const file of ["tickets.yml", "specs.yml"]) {
      for (const [name, job] of Object.entries(workflowJobs(file))) {
        const builds = job.steps.some(({ uses }) => readiesTree(uses));
        expect(job["runs-on"], `${file} ${name}`).toBe(builds ? PC_RUNS_ON : QUICK_RUNS_ON);
        if (!builds) quick.push(name);
      }
    }
    expect(quick).toEqual(expect.arrayContaining(["review", "meters", "which", "close", "strip", "dispatch-rerun", "ended", "resumed", "asked"]));
  });
});
