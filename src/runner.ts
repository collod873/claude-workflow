import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname } from "node:os";

const VARIABLE = "CI_RUNNER";
const LABEL = "pc";
const PC_RUNNERS = 4;
const USER = "ghrunner";
const HOME = `/home/${USER}`;
const NODE = `${HOME}/node`;
const GH = `${HOME}/gh`;
const PATH = `${NODE}/bin:${GH}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const NODE_RELEASES = "https://nodejs.org/dist";
const GH_RELEASES = "https://github.com/cli/cli/releases/download";
const RUNNER_RELEASES = "https://github.com/actions/runner/releases/download";
const WAIT_SECONDS = Number(process.env.RUNNER_WAIT_SECONDS ?? "60");
const PROC = process.env.RUNNER_PROC ?? "/proc";
const UNITS = "/etc/systemd/system";
const unitsOf = (repo: string) => `actions.runner.${repo.replace("/", "-")}.`;
const ONE_JOB = "ACTIONS_RUNNER_INPUT_ONCE=true";
const confinement = (unit: string) =>
  ["[Service]", "OOMPolicy=continue", "KillMode=mixed", `Environment=${ONE_JOB}`, "Restart=always", "RestartSec=2", `ExecCondition=/usr/bin/systemctl is-enabled --quiet ${unit}`, ""].join("\n");
const EARLYOOM = "/etc/default/earlyoom";
const earlyoom = 'EARLYOOM_ARGS="-r 3600 -m 10,5 -s 10,5"\n';
const NOT_FOUND = /\(HTTP 404\)|not found/i;

class Refused extends Error {}

type Mode = "pc" | "github";

const clearing = (repo: string, name: string, unit: string) =>
  [
    "#!/bin/bash",
    "set -euo pipefail",
    'own="$(cd "$(dirname "$0")" && pwd)"',
    "temp=\"$(sed -n 's/^TMPDIR=//p' \"$own/.env\")\"",
    'cgroup="/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)"',
    `if [[ $cgroup == */${unit} ]]; then`,
    '  keep=" $$ "',
    "  at=$$",
    "  while [[ $at -gt 1 ]]; do at=$(awk '/^PPid:/ {print $2}' \"/proc/$at/status\"); keep+=\"$at \"; done",
    '  for pid in $(cat "$cgroup/cgroup.procs"); do [[ $keep == *" $pid "* ]] || kill -KILL "$pid" 2>/dev/null || true; done',
    "fi",
    'for left in "$HOME" "$TMPDIR" "$GITHUB_WORKSPACE"; do',
    "  [[ $left == \"$own\"/* || $left == \"$temp\" ]] || { printf 'clear: %s is outside this runner, so it is not cleared\\n' \"$left\" >&2; exit 1; }",
    '  find "$left" -mindepth 1 -delete',
    "done",
    `docker ps --all --quiet --filter 'name=^database-${repo.replace("/", "-")}-${name}$' | xargs --no-run-if-empty docker rm --force >/dev/null`,
    "",
  ].join("\n");

function run(command: string, args: string[], input?: string): string {
  const ran = spawnSync(command, args, { encoding: "utf8", input });
  if (ran.status !== 0) throw new Refused((ran.stderr || ran.stdout).trim().split("\n")[0] || `${command} ${args.join(" ")} failed`);
  return ran.stdout;
}

const gh = (args: string[]) => run("gh", args);
const asRunnerUser = (script: string, input?: string) => run("sudo", ["-u", USER, "bash", "-c", script], input);
const asRoot = (script: string, input?: string) => run("sudo", ["bash", "-c", script], input);
const quoted = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

type Runner = { id: number; name: string; status: string; busy: boolean; labels: { name: string }[] };

const onPc = (runner: Runner) => runner.labels.some(({ name }) => name === LABEL);

function onRepo(repo: string) {
  const runners = () => (JSON.parse(gh(["api", `repos/${repo}/actions/runners`])) as { runners: Runner[] }).runners;
  const pcRunners = () => runners().filter(onPc);
  const read = (variable: string) => {
    try {
      return gh(["variable", "get", variable, "-R", repo]).trim();
    } catch (error) {
      if (error instanceof Refused && NOT_FOUND.test(error.message)) return undefined;
      throw error;
    }
  };
  const current = (): Mode => (read(VARIABLE) === LABEL ? "pc" : "github");
  const isPrivate = () => (JSON.parse(gh(["api", `repos/${repo}`])) as { private: boolean }).private;
  return { runners, pcRunners, current, isPrivate };
}

function provisionUser(): void {
  try {
    run("id", [USER]);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    asRoot(`useradd --create-home --shell /bin/bash --groups docker ${USER}`);
  }
}

function provisionNode(): void {
  const releases = JSON.parse(run("curl", ["-fsSL", `${NODE_RELEASES}/index.json`])) as { version: string; lts: string | false }[];
  const lts = releases.find(({ lts }) => lts !== false)?.version;
  if (lts === undefined) throw new Refused("nodejs.org lists no LTS release to give the PC runners");
  const tarball = `${NODE_RELEASES}/${lts}/node-${lts}-linux-x64.tar.xz`;
  asRunnerUser(`[ -x ${NODE}/bin/node ] || { mkdir -p ${NODE} && curl -fsSL ${tarball} | tar -xJ --strip-components 1 -C ${NODE}; }`);
}

function provisionGh(): void {
  const version = gh(["api", "repos/cli/cli/releases/latest", "--jq", ".tag_name"]).trim().replace(/^v/, "");
  const tarball = `${GH_RELEASES}/v${version}/gh_${version}_linux_amd64.tar.gz`;
  asRunnerUser(`${GH}/bin/gh --version 2>/dev/null | grep -qF 'gh version ${version} ' || { rm -rf ${GH}.next && mkdir -p ${GH}.next && curl -fsSL ${tarball} | tar -xz --strip-components 1 -C ${GH}.next && rm -rf ${GH} && mv ${GH}.next ${GH}; }`);
}

const dirOf = (repo: string, name: string) => `${HOME}/runners/${repo.replace("/", "-")}/${name}`;
const tempOf = (repo: string, name: string) => `${HOME}/tmp/${createHash("sha256").update(`${repo}/${name}`).digest("hex").slice(0, 8)}`;
const unitOf = (repo: string, name: string) => `${unitsOf(repo)}${name}.service`;

function install(repo: string, name: string, labels: string): void {
  const dir = dirOf(repo, name);
  const version = gh(["api", "repos/actions/runner/releases/latest", "--jq", ".tag_name"]).trim().replace(/^v/, "");
  const tarball = `${RUNNER_RELEASES}/v${version}/actions-runner-linux-x64-${version}.tar.gz`;
  const token = gh(["api", "-X", "POST", `repos/${repo}/actions/runners/registration-token`, "--jq", ".token"]).trim();
  asRunnerUser(
    [
      `mkdir -p ${dir}`,
      `cd ${dir}`,
      `{ [ -x ./config.sh ] || curl -fsSL ${tarball} | tar -xz; }`,
      `./config.sh --unattended --replace --url https://github.com/${repo} --token ${quoted(token)} --name ${quoted(name)} --labels ${labels} >/dev/null`,
    ].join(" && "),
  );
  asRoot(`cd ${dir} && ./bin/installdependencies.sh >/dev/null && ./svc.sh install ${USER} >/dev/null`);
}

type Placing = { as: (script: string, input?: string) => string; path: string; text: string; mode: string };

const staged = (file: Placing) => ({ ...file, changed: file.as(`cat >${file.path}.next && chmod ${file.mode} ${file.path}.next && { cmp -s ${file.path}.next ${file.path} || echo changed; }`, file.text) !== "" });

const place = (file: Placing & { changed: boolean }) => file.as(file.changed ? `mv ${file.path}.next ${file.path}` : `rm ${file.path}.next`);

function provisionUserManager(): void {
  asRoot(`loginctl enable-linger ${USER}`);
}

function provisionEarlyoom(): void {
  asRoot("command -v earlyoom >/dev/null || apt-get install --yes earlyoom >/dev/null");
  const file = staged({ as: asRoot, path: EARLYOOM, text: earlyoom, mode: "644" });
  place(file);
  if (file.changed) asRoot("systemctl enable --quiet earlyoom && systemctl restart earlyoom");
}

const running = (repo: string, name: string) => spawnSync("systemctl", ["is-active", "--quiet", unitOf(repo, name)]).status === 0;

function takesOneJob(repo: string, name: string): boolean {
  const pid = spawnSync("systemctl", ["show", "--property", "MainPID", "--value", unitOf(repo, name)], { encoding: "utf8" }).stdout.trim();
  try {
    return asRoot(`cat ${PROC}/${pid}/environ`).split("\0").includes(ONE_JOB);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    return false;
  }
}

function settle(repo: string, name: string, busy: boolean): "started" | "running" | "at-job-end" | "mid-job" {
  const dir = dirOf(repo, name);
  const dropIns = `${UNITS}/${unitOf(repo, name)}.d`;
  const temp = tempOf(repo, name);
  asRunnerUser(`mkdir -p ${dir}/home ${temp} ${dir}/toolcache`);
  asRoot(`mkdir -p ${dropIns}`);
  const clear = `${dir}/clear.sh`;
  const env = [`HOME=${dir}/home`, `TMPDIR=${temp}`, `RUNNER_TOOL_CACHE=${dir}/toolcache`, `AGENT_TOOLSDIRECTORY=${dir}/toolcache`, `ACTIONS_RUNNER_HOOK_JOB_STARTED=${clear}`, `ACTIONS_RUNNER_HOOK_JOB_COMPLETED=${clear}`, `XDG_RUNTIME_DIR=/run/user/${run("id", ["-u", USER]).trim()}`, "PIPELINE_JOB_OOMSCOREADJ=0", "LANG=C.UTF-8", ""].join("\n");
  const files = [
    staged({ as: asRunnerUser, path: clear, text: clearing(repo, name, unitOf(repo, name)), mode: "755" }),
    staged({ as: asRunnerUser, path: `${dir}/.env`, text: env, mode: "644" }),
    staged({ as: asRunnerUser, path: `${dir}/.path`, text: `${PATH}\n`, mode: "644" }),
    staged({ as: asRoot, path: `${dropIns}/pc-runner.conf`, text: confinement(unitOf(repo, name)), mode: "644" }),
  ];
  const changed = files.some((file) => file.changed);
  if (busy && !changed) {
    for (const file of files) place(file);
    return "running";
  }
  if (busy && !takesOneJob(repo, name)) return "mid-job";
  for (const file of files) place(file);
  if (busy) {
    asRoot(`systemctl daemon-reload && systemctl enable --quiet ${unitOf(repo, name)}`);
    return "at-job-end";
  }
  asRoot(`cd ${dir} && ${changed ? "systemctl daemon-reload && ./svc.sh stop >/dev/null && " : ""}systemctl enable --quiet ${unitOf(repo, name)} && ./svc.sh start >/dev/null`);
  return "started";
}

function turnOff(repo: string, extra: { name: string; busy: boolean }[]): string {
  for (const { name, busy } of extra) asRoot(`systemctl disable --quiet ${busy ? "" : "--now "}${unitOf(repo, name)}`);
  const busy = extra.filter(({ busy }) => busy);
  const untilStopped = busy.filter(({ name }) => running(repo, name) && !takesOneJob(repo, name)).map(({ name }) => name);
  if (extra.length === 0) return "";
  const atJobEnd = busy.length - untilStopped.length;
  return `, ${extra.length} turned off${atJobEnd > 0 ? `, ${atJobEnd} once its job ends` : ""}${untilStopped.length > 0 ? `; ${untilStopped.join(", ")} take jobs until stopped: run this again once they finish` : ""}`;
}

function stopIdle(repo: string, runners: Runner[]): string {
  const ours = runners.filter(({ name, status }) => name.startsWith(`${hostname().toLowerCase()}-`) && status === "online");
  for (const { name } of ours.filter(({ busy }) => !busy)) asRoot(`cd ${dirOf(repo, name)} && ./svc.sh stop >/dev/null`);
  const busy = ours.filter(({ busy }) => busy).length;
  return busy === 0 ? `${ours.length} PC runners stopped` : `${ours.length - busy} PC runners stopped, ${busy} still mid-job: run this again once it finishes`;
}

function waitOnline(online: () => number, wanted: number): number {
  const until = Date.now() + WAIT_SECONDS * 1000;
  let count = online();
  while (count < wanted && Date.now() < until) {
    spawnSync("sleep", ["2"]);
    count = online();
  }
  return count;
}

function toPc(repo: string, asked: number | undefined): string {
  const on = onRepo(repo);
  if (!on.isPrivate()) throw new Refused(`${repo} is public, so a PC runner would run strangers' PRs on this PC; it stays on GitHub's runners`);
  const host = hostname().toLowerCase();
  const all = on.runners();
  const runners = all.filter(onPc);
  const wanted = asked ?? (runners.filter(({ name, status }) => name.startsWith(`${host}-`) && status === "online").length || PC_RUNNERS);
  const registered = new Map(runners.map(({ name, busy }) => [name, busy]));
  const names = Array.from({ length: wanted }, (_, at) => `${host}-${at + 1}`);
  const missing = names.filter((name) => !registered.has(name));
  const extra = all.filter(({ name }) => name.startsWith(`${host}-`) && !names.includes(name));
  provisionUser();
  provisionNode();
  provisionGh();
  provisionUserManager();
  provisionEarlyoom();
  for (const name of missing) install(repo, name, LABEL);
  const settled = names.map((name) => ({ name, as: settle(repo, name, registered.get(name) === true && running(repo, name)) }));
  const named = (as: string) => settled.filter((runner) => runner.as === as).map(({ name }) => name);
  const atJobEnd = named("at-job-end");
  const midJob = named("mid-job");
  const off = turnOff(repo, extra);
  const count = waitOnline(() => on.pcRunners().filter(({ name, status }) => names.includes(name) && status === "online").length, wanted);
  if (count === 0) throw new Refused(`no PC runner of ${repo} came online within ${WAIT_SECONDS}s, so it stays where it was: start them with \`sudo systemctl start 'actions.runner.*'\``);
  if (on.current() !== "pc") gh(["variable", "set", VARIABLE, "-R", repo, "--body", LABEL]);
  const installed = missing.length > 0 ? `, ${missing.length} installed` : "";
  const settling = atJobEnd.length > 0 ? `; ${atJobEnd.join(", ")} take the new setup when their job ends` : "";
  const waiting = midJob.length > 0 ? `; ${midJob.join(", ")} kept their old setup mid-job, since it takes jobs until stopped: run this again once they finish` : "";
  const up = count < wanted ? `${count} of ${wanted} PC runners online, the rest still starting` : `${count} PC runners online`;
  return `${repo} runs on this PC from its next job, ${up}${installed}${off}${settling}${waiting}`;
}

function toGithub(repo: string): string {
  const on = onRepo(repo);
  const already = on.current() === "github";
  if (!already) gh(["variable", "delete", VARIABLE, "-R", repo]);
  const stopped = stopIdle(repo, on.runners());
  return already ? `${repo} already runs on GitHub's runners, ${stopped}` : `${repo} runs on GitHub's runners from its next job, ${stopped}; a job already queued for the PC waits until it is switched back`;
}

function where(repo: string): string {
  const on = onRepo(repo);
  const pc = on.pcRunners();
  return `${repo} runs on ${on.current() === "pc" ? "this PC" : "GitHub's runners"}, ${pc.filter(({ status }) => status === "online").length} of ${pc.length} PC runners online`;
}

function runner(repo: string, mode: string | undefined, count: string | undefined): number {
  try {
    console.log(`runner: ${mode === "pc" ? toPc(repo, count === undefined ? undefined : Number(count)) : mode === "github" ? toGithub(repo) : where(repo)}`);
    return 0;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(`runner: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) {
  const [repo, mode, count] = process.argv.slice(2);
  if (repo === undefined) throw new Error("no repo in the arguments");
  process.exit(runner(repo, mode, count));
}
