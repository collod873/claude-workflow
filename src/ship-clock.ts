import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { parse } from "yaml";
import { UNITS } from "./runner.ts";

const CALLER = ".github/workflows/ship.yml";
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

function callerOf(repo: string): Caller | undefined {
  const ran = run("gh", ["api", `repos/${repo}/contents/${CALLER}`, "-H", "Accept: application/vnd.github.raw"]);
  if (ran.status !== 0) {
    if (NOT_FOUND.test(ran.stderr)) return undefined;
    throw new Refused(`reading ${repo}'s ${CALLER}: ${ran.stderr.trim()}`);
  }
  return parse(ran.stdout) as Caller;
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
  return ["[Unit]", `Description=Dispatch ${clock.repo}'s daily Ship`, "", "[Service]", "Type=oneshot", `User=${user}`, `ExecStart=${ghPath} workflow run ship.yml -R ${clock.repo}`, ""].join("\n");
}

function timerText(clock: ShipClock): string {
  return ["[Unit]", `Description=${clock.repo}'s daily Ship at ${timeOf(clock)} UTC`, "", "[Timer]", `OnCalendar=*-*-* ${timeOf(clock)}:00 UTC`, "Persistent=true", "", "[Install]", "WantedBy=timers.target", ""].join("\n");
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
    if (clocks.length === 0) throw new Refused(`no repo's ${CALLER} calls the shared Ship, so there is nothing to dispatch`);
    const user = userInfo().username;
    for (const clock of clocks) {
      place(`${UNITS}/${unitOf(clock.repo)}.service`, serviceText(clock, user, ghPath));
      place(`${UNITS}/${unitOf(clock.repo)}.timer`, timerText(clock));
    }
    const enabled = run("sudo", ["bash", "-c", `systemctl daemon-reload && systemctl enable --now ${clocks.map(({ repo }) => `${unitOf(repo)}.timer`).join(" ")}`], "");
    if (enabled.status !== 0) throw new Refused(`enabling the timers: ${enabled.stderr.trim()}`);
    for (const clock of clocks) console.log(`ship-clock: ${clock.repo} dispatches Ship daily at ${timeOf(clock)} UTC`);
    return 0;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(`ship-clock: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(shipClock());
