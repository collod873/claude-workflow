import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "./check-runner.ts";
import { splitInto, WAITING } from "./fixer.ts";
import { commentOnPr, commentOnTicket, commentsOn } from "./post.ts";
import { totalOutside } from "./reads-outside-brief.ts";
import { FOLLOW_UP_OF } from "./reviewer.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { checks, quoted, why } from "./ticket-shape.ts";

const MERGED = /^Merge pull request #(\d+) from \S+?(?:\/ticket\/(\d+))?$/;
const SPLIT_FROM = new RegExp(`^${FOLLOW_UP_OF}(\\d+): its fixer split it`, "m");
const NAMED = /^(?:[ ,]*#\d+)+/;
const BUILDS = /^Builds #(\d+)[ \t]*$/m;
const STAGE_LABELS = "1-defining,2-building,3-checking,4-reviewing,5-merging,fixing,needs-human";
const TICKET_BRANCH = /^ticket\/(\d+)$/;
const MACHINE_BRANCH = /^(ticket|land)\//;

const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: "utf8", maxBuffer: Infinity });
const gh = (args: string[]) => run("gh", args);
const quietGh = (args: string[]) => spawnSync("gh", args, { encoding: "utf8", env: { ...process.env, GH_TOKEN: process.env.QUIET_GH_TOKEN } });
const ticketState = (ticket: string) => gh(["issue", "view", ticket, "--json", "state,stateReason", "--jq", '.state + " " + .stateReason']).stdout.trim();
const git = (args: string[]) => run("git", args);

interface Verdict {
  command: string;
  base: boolean;
  merge: boolean;
  why: string;
}

interface Marks {
  filed?: string;
  firstCommit?: string;
  prOpened?: string;
  checksGreen?: string;
  merged?: string;
}

interface Wait {
  label: string;
  ms: number;
}

const STEPS: { key: keyof Marks; label: string }[] = [
  { key: "filed", label: "filed" },
  { key: "firstCommit", label: "first commit" },
  { key: "prOpened", label: "PR opened" },
  { key: "checksGreen", label: "checks green" },
  { key: "merged", label: "merged" },
];

function ticketBuilt(subject: string): string | undefined {
  const [, pr, branch] = MERGED.exec(subject) ?? [];
  if (branch !== undefined || pr === undefined) return branch;
  const asked = gh(["pr", "view", pr, "--json", "body", "--jq", ".body"]);
  return asked.status === 0 ? BUILDS.exec(asked.stdout)?.[1] : undefined;
}

const prNumber = (subject: string): string | undefined => MERGED.exec(subject)?.[1];

function ghText(args: string[]): string | undefined {
  const got = gh(args);
  return got.status === 0 ? got.stdout.trim() : undefined;
}

function gitText(args: string[]): string | undefined {
  const got = git(args);
  return got.status === 0 ? got.stdout.trim() : undefined;
}

function marksFor(ticket: string, pr: string | undefined): Marks {
  return {
    filed: ghText(["issue", "view", ticket, "--json", "createdAt", "--jq", ".createdAt"]),
    firstCommit: gitText(["log", "--format=%aI", "--reverse", "HEAD^1..HEAD^2"])?.split("\n").find((line) => line !== ""),
    prOpened: pr === undefined ? undefined : ghText(["pr", "view", pr, "--json", "createdAt", "--jq", ".createdAt"]),
    checksGreen: pr === undefined ? undefined : ghText(["pr", "checks", pr, "--json", "completedAt", "--jq", "[.[].completedAt] | sort | last"]),
    merged: gitText(["log", "-1", "--format=%cI", "HEAD"]),
  };
}

function waits(marks: Marks): Wait[] {
  const found: Wait[] = [];
  for (let at = 0; at < STEPS.length - 1; at++) {
    const from = marks[STEPS[at].key];
    const to = marks[STEPS[at + 1].key];
    if (from === undefined || to === undefined) continue;
    const ms = Date.parse(to) - Date.parse(from);
    if (Number.isNaN(ms)) continue;
    found.push({ label: `${STEPS[at].label} to ${STEPS[at + 1].label}`, ms });
  }
  return found;
}

function human(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function speedReport(marks: Marks, readsOutside: number | undefined): string {
  const found = waits(marks);
  const lines = ["Speed report", ""];
  if (found.length === 0) {
    lines.push("- timing not available");
  } else {
    const total = found.reduce((sum, wait) => sum + wait.ms, 0);
    const longest = found.reduce((slowest, wait) => (wait.ms > slowest.ms ? wait : slowest));
    lines.push(...found.map((wait) => `- ${wait.label}: ${human(wait.ms)}`));
    lines.push(`- total, filed to merged: ${human(total)}`);
    lines.push(`- longest wait: ${human(longest.ms)}, ${longest.label}`);
  }
  if (readsOutside !== undefined) lines.push(`- reads outside the brief: ${readsOutside}`);
  return lines.join("\n");
}

function atBase(top: string): string {
  const dir = mkdtempSync(join(tmpdir(), "close-base-"));
  rmSync(dir, { recursive: true, force: true });
  git(["worktree", "add", "--quiet", "--detach", dir, "HEAD^1"]);
  if (existsSync(join(top, "node_modules")) && existsSync(dir)) symlinkSync(join(top, "node_modules"), join(dir, "node_modules"));
  return dir;
}

function verdicts(commands: string[], top: string): Verdict[] {
  const base = atBase(top);
  const gathered = commands.map((command) => {
    const merged = runCheck(command, top);
    return { command, base: runCheck(command, base).passed, merge: merged.passed, why: merged.why };
  });
  git(["worktree", "remove", "--force", base]);
  return gathered;
}

function record(ticket: string, gathered: Verdict[], speed: string): string {
  if (gathered.length === 0) return `#${ticket} carries no check, so nothing proves it done on the merge commit; left open\n\n${speed}`;
  const red = gathered.filter((verdict) => !verdict.merge);
  if (red.length > 0) {
    return [`#${ticket} is not done: a check is red on the merge commit`, "", ...red.map(({ command, why }) => `- \`${command}\` ${why} on the merge commit`), "", speed].join("\n");
  }
  return [
    `#${ticket} is done: every check is green on the merge commit`,
    "",
    ...gathered.map(({ command, base }) => `- \`${command}\` was ${base ? "already green" : "red"} at base, green at merge`),
    "",
    speed,
  ].join("\n");
}

const recorded = (said: string) => (said === "" ? "" : `; record ${said}`);

function behindPrs(): { number: string; headRefName: string }[] {
  const listed = gh(["pr", "list", "--state", "open", "--json", "number,headRefName,mergeStateStatus"]);
  if (listed.status !== 0) return [];
  try {
    return (JSON.parse(listed.stdout) as { number: number; headRefName: string; mergeStateStatus: string }[])
      .filter((pr) => MACHINE_BRANCH.test(pr.headRefName) && (pr.mergeStateStatus === "BEHIND" || pr.mergeStateStatus === "DIRTY"))
      .map((pr) => ({ number: String(pr.number), headRefName: pr.headRefName }));
  } catch {
    return [];
  }
}

function bringUpToDate(): void {
  for (const { number, headRefName } of behindPrs()) {
    const updated = gh(["pr", "update-branch", number]);
    if (updated.status === 0) continue;
    const reason = (updated.stderr || updated.stdout).trim().split("\n")[0];
    const ticket = TICKET_BRANCH.exec(headRefName)?.[1];
    if (ticket === undefined) commentOnPr(number, `PR #${number} could not be brought up to date with main: ${reason}`, gh);
    else commentOnTicket(ticket, `#${ticket}'s PR #${number} could not be brought up to date with main: ${reason}`, gh);
  }
}

function wokenFromSplit(ticket: string, body: string): string {
  const parent = SPLIT_FROM.exec(why(body))?.[1];
  if (parent === undefined) return "";
  if (!(ghText(["issue", "view", parent, "--json", "labels", "--jq", ".labels[].name"]) ?? "").split("\n").includes(WAITING)) return "";
  const split = commentsOn(parent, gh)?.find((said) => said.startsWith(splitInto(parent)));
  const pieces = [...(NAMED.exec(split?.slice(splitInto(parent).length).trimStart() ?? "")?.[0] ?? "").matchAll(/#(\d+)/g)].map(([, number]) => number);
  if (pieces.length === 0) return `; #${parent} waits, and no split record names what for`;
  const open = pieces.filter((piece) => piece !== ticket && ticketState(piece) !== "CLOSED COMPLETED");
  if (open.length > 0) return `; #${parent} still waits for ${open.map((piece) => `#${piece}`).join(", ")}`;
  const woke = gh(["issue", "edit", parent, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${parent} builds now, its split tickets all merged` : `; #${parent} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function close(): Stop | undefined {
  const top = process.cwd();
  bringUpToDate();
  const subject = git(["log", "-1", "--format=%s", "HEAD"]).stdout.trim();
  const ticket = ticketBuilt(subject);
  if (ticket === undefined) return undefined;
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return stoppedAt("unread", `close: ticket ${ticket} could not be read, so nothing judged it`);
  const gathered = verdicts(checks(asked.stdout).map(({ command }) => command), top);
  const pr = prNumber(subject);
  const prBody = pr === undefined ? undefined : ghText(["pr", "view", pr, "--json", "body", "--jq", ".body"]);
  const speed = speedReport(marksFor(ticket, pr), prBody === undefined ? undefined : totalOutside(prBody));
  const posted = commentOnTicket(ticket, record(ticket, gathered, speed), gh);
  if (posted.refusals.length > 0) return stoppedAt("unrecorded", `close: #${ticket} got no closing record: ${quoted(posted.refusals[0])}`);
  const done = gathered.length > 0 && gathered.every((verdict) => verdict.merge);
  if (done) {
    const state = ticketState(ticket);
    gh(["issue", "edit", ticket, "--remove-label", STAGE_LABELS]);
    if (state !== "CLOSED COMPLETED") {
      if (state.startsWith("CLOSED")) quietGh(["issue", "reopen", ticket]);
      if (quietGh(["issue", "close", ticket, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `close: #${ticket} is done but could not be closed${recorded(posted.said)}`);
    }
    console.log(`close: #${ticket} closed as completed, every check green on the merge commit${recorded(posted.said)}${wokenFromSplit(ticket, asked.stdout)}`);
    return undefined;
  }
  if (ticketState(ticket).startsWith("CLOSED")) gh(["issue", "reopen", ticket]);
  console.log(`close: #${ticket} left open, a check is red on the merge commit${recorded(posted.said)}`);
  return undefined;
}

if (import.meta.main) process.exit(exitFor(close()));
