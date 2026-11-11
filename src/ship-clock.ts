import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { parse } from "yaml";
import { ENROLLED_CALLER, MACHINE_REPO } from "./post.ts";
import { UNITS } from "./runner.ts";

const CALLER = ".github/workflows/ship.yml";
const RUNNER_WATCH = "runner-watch.yml";
const SHARED_SHIP = "/claude-workflow/.github/workflows/ship.yml@";
const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const NOT_FOUND = /\(HTTP 404\)|Not Found/i;

class Refused extends Error {}

interface Caller {
  on?: { schedule?: { cron: string }[] };
  jobs?: Record<string, { uses?: string }>;
}

interface ShipClock {
  repo: string;
  hour: number;
  minute: number;
}

function run(command: string, args: string[], input?: string): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(command, args, { encoding: "utf8", input });
}

function gh(args: string[]): string {
  const ran = run("gh", args);
  if (ran.status !== 0) throw new Refused(`gh ${args.join(" ")}: ${ran.stderr.trim()}`);
  return ran.stdout;
}

function workflowOf(repo: string, path: string): string | undefined {
  const ran = run("gh", ["api", `repos/${repo}/contents/${path}`, "-H", "Accept: application/vnd.github.raw"]);
  if (ran.status !== 0) {
    if (NOT_FOUND.test(ran.stderr)) return undefined;
    throw new Refused(`reading ${repo}'s ${path}: ${ran.stderr.trim()}`);
  }
  return ran.stdout;
}

function callerOf(repo: string): Caller | undefined {
  const text = workflowOf(repo, CALLER);
  return text === undefined ? undefined : (parse(text) as Caller);
}

function clockOf(repo: string, caller: Caller): ShipClock | undefined {
  if (!Object.values(caller.jobs ?? {}).some(({ uses }) => uses?.includes(SHARED_SHIP))) return undefined;
  const crons = (caller.on?.schedule ?? []).map(({ cron }) => cron);
  const daily = crons.length === 1 ? DAILY.exec(crons[0] ?? "") : null;
  const minute = Number(daily?.[1]);
  const hour = Number(daily?.[2]);
  if (daily === null || minute > 59 || hour > 23) throw new Refused(`${repo}'s ${CALLER} schedules ${crons.map((cron) => `"${cron}"`).join(", ") || "no cron"}, and a ship clock takes one daily "M H * * *" cron`);
  return { repo, hour, minute };
}

const unitOf = (repo: string) => `ship-${repo.replace("/", "-")}`;
const twoDigits = (value: number) => String(value).padStart(2, "0");
const timeOf = ({ hour, minute }: ShipClock) => `${twoDigits(hour)}:${twoDigits(minute)}`;

function serviceText(clock: ShipClock, user: string, ghPath: string): string {
  return ["[Unit]", `Description=Dispatch ${clock.repo}'s daily Ship`, "Wants=network-online.target", "After=network-online.target", "", "[Service]", "Type=oneshot", `User=${user}`, `ExecStart=${ghPath} workflow run ship.yml -R ${clock.repo}`, ""].join("\n");
}

function timerText(clock: ShipClock): string {
  return ["[Unit]", `Description=${clock.repo}'s daily Ship at ${timeOf(clock)} UTC`, "", "[Timer]", `OnCalendar=*-*-* ${timeOf(clock)}:00 UTC`, "Persistent=true", "", "[Install]", "WantedBy=timers.target", ""].join("\n");
}

const MACHINE_CLOCK = "machine-clock";

function machineServiceText(enrolled: string[], user: string, ghPath: string): string {
  const dispatches = [...enrolled.map((repo) => `ExecStart=-${ghPath} workflow run ${ENROLLED_CALLER} -R ${repo} -f ticket=0`), `ExecStart=-${ghPath} workflow run ${RUNNER_WATCH} -R ${MACHINE_REPO} -f minutes=false`];
  return ["[Unit]", "Description=Dispatch each enrolled repo's reconcile and the runner watch", "Wants=network-online.target", "After=network-online.target", "", "[Service]", "Type=oneshot", `User=${user}`, ...dispatches, ""].join("\n");
}

function machineTimerText(): string {
  return ["[Unit]", "Description=Reconcile and runner watch every 15 minutes", "", "[Timer]", "OnCalendar=*:0/15", "Persistent=true", "", "[Install]", "WantedBy=timers.target", ""].join("\n");
}

function place(path: string, text: string): void {
  const ran = run("sudo", ["bash", "-c", `cat >${path}`], text);
  if (ran.status !== 0) throw new Refused(`writing ${path}: ${ran.stderr.trim()}`);
}

function shipClock(): number {
  try {
    const ghPath = run("bash", ["-c", "command -v gh"]).stdout.trim();
    if (ghPath === "") throw new Refused("gh is not on PATH, and each timer dispatches with it");
    const repos = gh(["repo", "list", "--no-archived", "--limit", "1000", "--json", "nameWithOwner", "--jq", ".[].nameWithOwner"]).split("\n").filter(Boolean);
    const clocks = repos.flatMap((repo) => {
      const caller = callerOf(repo);
      const clock = caller === undefined ? undefined : clockOf(repo, caller);
      return clock === undefined ? [] : [clock];
    });
    const enrolled = repos.filter((repo) => workflowOf(repo, `.github/workflows/${ENROLLED_CALLER}`) !== undefined);
    const user = userInfo().username;
    for (const clock of clocks) {
      place(`${UNITS}/${unitOf(clock.repo)}.service`, serviceText(clock, user, ghPath));
      place(`${UNITS}/${unitOf(clock.repo)}.timer`, timerText(clock));
    }
    place(`${UNITS}/${MACHINE_CLOCK}.service`, machineServiceText(enrolled, user, ghPath));
    place(`${UNITS}/${MACHINE_CLOCK}.timer`, machineTimerText());
    const timers = [...clocks.map(({ repo }) => `${unitOf(repo)}.timer`), `${MACHINE_CLOCK}.timer`];
    const enabled = run("sudo", ["bash", "-c", `systemctl daemon-reload && systemctl enable --now ${timers.join(" ")}`], "");
    if (enabled.status !== 0) throw new Refused(`enabling the timers: ${enabled.stderr.trim()}`);
    for (const clock of clocks) console.log(`ship-clock: ${clock.repo} dispatches Ship daily at ${timeOf(clock)} UTC`);
    console.log(`ship-clock: every 15 minutes the machine clock dispatches reconcile in ${enrolled.join(", ") || "no repo"} and the runner watch in ${MACHINE_REPO}`);
    return 0;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(`ship-clock: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(shipClock());
