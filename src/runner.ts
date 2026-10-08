import { spawnSync } from "node:child_process";
import { hostname } from "node:os";

const VARIABLE = "CI_RUNNER";
const LABEL = "pc";
const PC_RUNNERS = 2;
const USER = "ghrunner";
const HOME = `/home/${USER}`;
const NODE = `${HOME}/node`;
const PATH = `${NODE}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const NODE_RELEASES = "https://nodejs.org/dist";
const RUNNER_RELEASES = "https://github.com/actions/runner/releases/download";
const WAIT_SECONDS = Number(process.env.RUNNER_WAIT_SECONDS ?? "60");
const NOT_FOUND = /\(HTTP 404\)|not found/i;

class Refused extends Error {}

type Mode = "pc" | "github";

function run(command: string, args: string[]): string {
  const ran = spawnSync(command, args, { encoding: "utf8" });
  if (ran.status !== 0) throw new Refused((ran.stderr || ran.stdout).trim().split("\n")[0] || `${command} ${args.join(" ")} failed`);
  return ran.stdout;
}

const gh = (args: string[]) => run("gh", args);
const asRunnerUser = (script: string) => run("sudo", ["-u", USER, "bash", "-c", script]);
const asRoot = (script: string) => run("sudo", ["bash", "-c", script]);
const quoted = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

function onRepo(repo: string) {
  const pcRunners = () =>
    (JSON.parse(gh(["api", `repos/${repo}/actions/runners`])) as { runners: { name: string; status: string; labels: { name: string }[] }[] }).runners.filter(({ labels }) => labels.some(({ name }) => name === LABEL));
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

function install(repo: string, name: string): void {
  const dir = `${HOME}/runners/${repo.replace("/", "-")}/${name}`;
  const version = gh(["api", "repos/actions/runner/releases/latest", "--jq", ".tag_name"]).trim().replace(/^v/, "");
  const tarball = `${RUNNER_RELEASES}/v${version}/actions-runner-linux-x64-${version}.tar.gz`;
  const token = gh(["api", "-X", "POST", `repos/${repo}/actions/runners/registration-token`, "--jq", ".token"]).trim();
  asRunnerUser(
    [
      `mkdir -p ${dir}/home ${dir}/toolcache`,
      `cd ${dir}`,
      `{ [ -x ./config.sh ] || curl -fsSL ${tarball} | tar -xz; }`,
      `./config.sh --unattended --replace --url https://github.com/${repo} --token ${quoted(token)} --name ${quoted(name)} --labels ${LABEL} >/dev/null`,
      `printf '%s\\n' HOME=${dir}/home RUNNER_TOOL_CACHE=${dir}/toolcache AGENT_TOOLSDIRECTORY=${dir}/toolcache LANG=C.UTF-8 >.env`,
      `printf '%s\\n' ${PATH} >.path`,
    ].join(" && "),
  );
  asRoot(`cd ${dir} && ./bin/installdependencies.sh >/dev/null && ./svc.sh install ${USER} >/dev/null && ./svc.sh start >/dev/null`);
}

function waitOnline(online: () => number): number {
  const until = Date.now() + WAIT_SECONDS * 1000;
  let count = online();
  while (count === 0 && Date.now() < until) {
    spawnSync("sleep", ["2"]);
    count = online();
  }
  return count;
}

function toPc(repo: string): string {
  const on = onRepo(repo);
  if (!on.isPrivate()) throw new Refused(`${repo} is public, so a PC runner would run strangers' PRs on this PC; it stays on GitHub's runners`);
  const host = hostname().toLowerCase();
  const registered = new Set(on.pcRunners().map(({ name }) => name));
  const missing = Array.from({ length: PC_RUNNERS }, (_, at) => `${host}-${at + 1}`).filter((name) => !registered.has(name));
  if (missing.length > 0) {
    provisionUser();
    provisionNode();
    for (const name of missing) install(repo, name);
  }
  const count = waitOnline(on.online);
  if (count === 0) throw new Refused(`no PC runner of ${repo} came online within ${WAIT_SECONDS}s, so it stays where it was: start them with \`sudo systemctl start 'actions.runner.*'\``);
  if (on.current() !== "pc") gh(["variable", "set", VARIABLE, "-R", repo, "--body", LABEL]);
  return `${repo} runs on this PC from its next job, ${count} PC runners online${missing.length > 0 ? `, ${missing.length} installed` : ""}`;
}

function toGithub(repo: string): string {
  if (onRepo(repo).current() === "github") return `${repo} already runs on GitHub's runners`;
  gh(["variable", "delete", VARIABLE, "-R", repo]);
  return `${repo} runs on GitHub's runners from its next job; a job already queued for the PC still waits for it`;
}

function where(repo: string): string {
  const on = onRepo(repo);
  return `${repo} runs on ${on.current() === "pc" ? "this PC" : "GitHub's runners"}, ${on.online()} of ${on.pcRunners().length} PC runners online`;
}

function runner(repo: string, mode: string | undefined): number {
  try {
    console.log(`runner: ${mode === "pc" ? toPc(repo) : mode === "github" ? toGithub(repo) : where(repo)}`);
    return 0;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(`runner: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) {
  const [repo, mode] = process.argv.slice(2);
  if (repo === undefined) throw new Error("no repo in the arguments");
  process.exit(runner(repo, mode));
}
