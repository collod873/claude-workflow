import { spawnSync } from "node:child_process";
import { hostname } from "node:os";

const VARIABLE = "CI_RUNNER";
const LABEL = "pc";
const PC_RUNNERS = 2;
const USER = "ghrunner";
const HOME = `/home/${USER}`;
const NODE = `${HOME}/node`;
const GH = `${HOME}/gh`;
const PATH = `${NODE}/bin:${GH}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const NODE_RELEASES = "https://nodejs.org/dist";
const GH_RELEASES = "https://github.com/cli/cli/releases/download";
const RUNNER_RELEASES = "https://github.com/actions/runner/releases/download";
const WAIT_SECONDS = Number(process.env.RUNNER_WAIT_SECONDS ?? "60");
const UNITS = "/etc/systemd/system";
const SLICE = "pc-runners.slice";
const PC_RUNNERS_MEMORY_GB = 20;
const RUNNER_MEMORY_GB = 10;
const CHECK_SLOTS = 2;
const CHECK_SLOTS_DIR = `${HOME}/check-slots`;
const PC_RUNNERS_CPUS = 8;
const RUNNER_CPUS = 4;
const cpus = Number(spawnSync("nproc", { encoding: "utf8" }).stdout);
const firstCpu = Math.max(0, cpus - PC_RUNNERS_CPUS);
const slice = ["[Slice]", `MemoryMax=${PC_RUNNERS_MEMORY_GB}G`, "MemorySwapMax=0", `AllowedCPUs=${firstCpu}-${cpus - 1}`, ""].join("\n");
const cpusOf = (at: number) => {
  const start = Math.min(cpus - 1, firstCpu + (at % Math.max(1, PC_RUNNERS_CPUS / RUNNER_CPUS)) * RUNNER_CPUS);
  return `${start}-${Math.min(cpus - 1, start + RUNNER_CPUS - 1)}`;
};
const confinement = (at: number) => ["[Service]", `Slice=${SLICE}`, `MemoryMax=${RUNNER_MEMORY_GB}G`, "MemorySwapMax=0", `AllowedCPUs=${cpusOf(at)}`, "OOMPolicy=continue", "KillMode=mixed", ""].join("\n");
const EARLYOOM = "/etc/default/earlyoom";
const earlyoom = 'EARLYOOM_ARGS="-r 3600 -m 10,5 -s 10,5 --prefer ^(MainThread|Runner.Worker|node|python3)$ --avoid ^(claude|systemd|init|dockerd|containerd|sshd|login|zsh|bash)$"\n';
const NOT_FOUND = /\(HTTP 404\)|not found/i;

class Refused extends Error {}

type Mode = "pc" | "github";

const clearing = (name: string, unit: string) =>
  [
    "#!/bin/bash",
    "set -euo pipefail",
    'own="$(cd "$(dirname "$0")" && pwd)"',
    'cgroup="/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)"',
    `if [[ $cgroup == */${unit} ]]; then`,
    '  keep=" $$ "',
    "  at=$$",
    "  while [[ $at -gt 1 ]]; do at=$(awk '/^PPid:/ {print $2}' \"/proc/$at/status\"); keep+=\"$at \"; done",
    '  for pid in $(cat "$cgroup/cgroup.procs"); do [[ $keep == *" $pid "* ]] || kill -KILL "$pid" 2>/dev/null || true; done',
    "fi",
    'for left in "$HOME" "$TMPDIR" "$GITHUB_WORKSPACE"; do',
    "  [[ $left == \"$own\"/* ]] || { printf 'clear: %s is outside this runner, so it is not cleared\\n' \"$left\" >&2; exit 1; }",
    '  find "$left" -mindepth 1 -delete',
    "done",
    `docker ps --all --quiet --filter 'name=^database-${name}$' | xargs --no-run-if-empty docker rm --force >/dev/null`,
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

function onRepo(repo: string) {
  const pcRunners = () =>
    (JSON.parse(gh(["api", `repos/${repo}/actions/runners`])) as { runners: { name: string; status: string; busy: boolean; labels: { name: string }[] }[] }).runners.filter(({ labels }) => labels.some(({ name }) => name === LABEL));
  const online = () => pcRunners().filter(({ status }) => status === "online").length;
  const current = (): Mode => {
    try {
      return gh(["variable", "get", VARIABLE, "-R", repo]).trim() === LABEL ? "pc" : "github";
    } catch (error) {
      if (error instanceof Refused && NOT_FOUND.test(error.message)) return "github";
      throw error;
    }
  };
  const isPrivate = () => (JSON.parse(gh(["api", `repos/${repo}`])) as { private: boolean }).private;
  return { pcRunners, online, current, isPrivate };
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
const unitOf = (repo: string, name: string) => `actions.runner.${repo.replace("/", "-")}.${name}.service`;

function install(repo: string, name: string): void {
  const dir = dirOf(repo, name);
  const version = gh(["api", "repos/actions/runner/releases/latest", "--jq", ".tag_name"]).trim().replace(/^v/, "");
  const tarball = `${RUNNER_RELEASES}/v${version}/actions-runner-linux-x64-${version}.tar.gz`;
  const token = gh(["api", "-X", "POST", `repos/${repo}/actions/runners/registration-token`, "--jq", ".token"]).trim();
  asRunnerUser(
    [
      `mkdir -p ${dir}`,
      `cd ${dir}`,
      `{ [ -x ./config.sh ] || curl -fsSL ${tarball} | tar -xz; }`,
      `./config.sh --unattended --replace --url https://github.com/${repo} --token ${quoted(token)} --name ${quoted(name)} --labels ${LABEL} >/dev/null`,
    ].join(" && "),
  );
  asRoot(`cd ${dir} && ./bin/installdependencies.sh >/dev/null && ./svc.sh install ${USER} >/dev/null`);
}

type Placing = { as: (script: string, input?: string) => string; path: string; text: string; mode: string };

const staged = (file: Placing) => ({ ...file, changed: file.as(`cat >${file.path}.next && chmod ${file.mode} ${file.path}.next && { cmp -s ${file.path}.next ${file.path} || echo changed; }`, file.text) !== "" });

const place = (file: Placing & { changed: boolean }) => file.as(file.changed ? `mv ${file.path}.next ${file.path}` : `rm ${file.path}.next`);

function provisionSlice(): void {
  const file = staged({ as: asRoot, path: `${UNITS}/${SLICE}`, text: slice, mode: "644" });
  place(file);
  if (file.changed) asRoot("systemctl daemon-reload");
}

function provisionEarlyoom(): void {
  asRoot("command -v earlyoom >/dev/null || apt-get install --yes earlyoom >/dev/null");
  const file = staged({ as: asRoot, path: EARLYOOM, text: earlyoom, mode: "644" });
  place(file);
  if (file.changed) asRoot("systemctl enable --quiet earlyoom && systemctl restart earlyoom");
}

const running = (repo: string, name: string) => spawnSync("systemctl", ["is-active", "--quiet", unitOf(repo, name)]).status === 0;

function settle(repo: string, name: string, at: number, busy: boolean): "started" | "mid-job" {
  const dir = dirOf(repo, name);
  const dropIns = `${UNITS}/${unitOf(repo, name)}.d`;
  asRunnerUser(`mkdir -p ${dir}/home ${dir}/tmp ${dir}/toolcache ${CHECK_SLOTS_DIR}`);
  asRoot(`mkdir -p ${dropIns}`);
  const clear = `${dir}/clear.sh`;
  const env = [`HOME=${dir}/home`, `TMPDIR=${dir}/tmp`, `RUNNER_TOOL_CACHE=${dir}/toolcache`, `AGENT_TOOLSDIRECTORY=${dir}/toolcache`, `ACTIONS_RUNNER_HOOK_JOB_STARTED=${clear}`, `ACTIONS_RUNNER_HOOK_JOB_COMPLETED=${clear}`, `CHECK_SLOTS=${CHECK_SLOTS}`, `CHECK_SLOTS_DIR=${CHECK_SLOTS_DIR}`, "LANG=C.UTF-8", ""].join("\n");
  const files = [
    staged({ as: asRunnerUser, path: clear, text: clearing(name, unitOf(repo, name)), mode: "755" }),
    staged({ as: asRunnerUser, path: `${dir}/.env`, text: env, mode: "644" }),
    staged({ as: asRunnerUser, path: `${dir}/.path`, text: `${PATH}\n`, mode: "644" }),
    staged({ as: asRoot, path: `${dropIns}/pc-runner.conf`, text: confinement(at), mode: "644" }),
  ];
  const changed = files.some((file) => file.changed);
  if (changed && busy) return "mid-job";
  for (const file of files) place(file);
  asRoot(`cd ${dir} && ${changed ? "systemctl daemon-reload && ./svc.sh stop >/dev/null && " : ""}systemctl enable --quiet ${unitOf(repo, name)} && ./svc.sh start >/dev/null`);
  return "started";
}

function turnOff(repo: string, extra: { name: string; busy: boolean }[]): string {
  for (const { name, busy } of extra) asRoot(`systemctl disable --quiet ${busy ? "" : "--now "}${unitOf(repo, name)}`);
  const busy = extra.filter(({ busy }) => busy).length;
  if (extra.length === 0) return "";
  return busy === 0 ? `, ${extra.length} turned off` : `, ${extra.length} turned off, ${busy} once its job ends`;
}

function stopIdle(repo: string, runners: { name: string; status: string; busy: boolean }[]): string {
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
  const runners = on.pcRunners();
  const wanted = asked ?? (runners.filter(({ name, status }) => name.startsWith(`${host}-`) && status === "online").length || PC_RUNNERS);
  const registered = new Map(runners.map(({ name, busy }) => [name, busy]));
  const names = Array.from({ length: wanted }, (_, at) => `${host}-${at + 1}`);
  const missing = names.filter((name) => !registered.has(name));
  const extra = runners.filter(({ name }) => name.startsWith(`${host}-`) && !names.includes(name));
  provisionUser();
  provisionNode();
  provisionGh();
  provisionSlice();
  provisionEarlyoom();
  for (const name of missing) install(repo, name);
  const midJob = names.filter((name, at) => settle(repo, name, at, registered.get(name) === true && running(repo, name)) === "mid-job");
  const off = turnOff(repo, extra);
  const count = waitOnline(() => on.pcRunners().filter(({ name, status }) => names.includes(name) && status === "online").length, wanted);
  if (count === 0) throw new Refused(`no PC runner of ${repo} came online within ${WAIT_SECONDS}s, so it stays where it was: start them with \`sudo systemctl start 'actions.runner.*'\``);
  if (on.current() !== "pc") gh(["variable", "set", VARIABLE, "-R", repo, "--body", LABEL]);
  const installed = missing.length > 0 ? `, ${missing.length} installed` : "";
  const waiting = midJob.length > 0 ? `; ${midJob.join(", ")} kept their old setup mid-job: run this again once they finish` : "";
  const up = count < wanted ? `${count} of ${wanted} PC runners online, the rest still starting` : `${count} PC runners online`;
  return `${repo} runs on this PC from its next job, ${up}${installed}${off}${waiting}`;
}

function toGithub(repo: string): string {
  const on = onRepo(repo);
  const already = on.current() === "github";
  if (!already) gh(["variable", "delete", VARIABLE, "-R", repo]);
  const stopped = stopIdle(repo, on.pcRunners());
  return already ? `${repo} already runs on GitHub's runners, ${stopped}` : `${repo} runs on GitHub's runners from its next job, ${stopped}; a job already queued for the PC waits until it is switched back`;
}

function where(repo: string): string {
  const on = onRepo(repo);
  return `${repo} runs on ${on.current() === "pc" ? "this PC" : "GitHub's runners"}, ${on.online()} of ${on.pcRunners().length} PC runners online`;
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
