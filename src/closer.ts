import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "./check-runner.ts";
import { commentOnTicket } from "./post.ts";
import { totalOutside } from "./reads-outside-brief.ts";
import { checks, quoted } from "./ticket-shape.ts";

const MERGED = /^Merge pull request #(\d+) from \S+?(?:\/ticket\/(\d+))?$/;
const BUILDS = /^Builds #(\d+)[ \t]*$/m;

const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: "utf8", maxBuffer: Infinity });
const gh = (args: string[]) => run("gh", args);
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

function close(): number {
  const top = process.cwd();
  const subject = git(["log", "-1", "--format=%s", "HEAD"]).stdout.trim();
  const ticket = ticketBuilt(subject);
  if (ticket === undefined) return 0;
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) {
    console.error(`close: ticket ${ticket} could not be read, so nothing judged it`);
    return 1;
  }
  const gathered = verdicts(checks(asked.stdout).map(({ command }) => command), top);
  const pr = prNumber(subject);
  const prBody = pr === undefined ? undefined : ghText(["pr", "view", pr, "--json", "body", "--jq", ".body"]);
  const speed = speedReport(marksFor(ticket, pr), prBody === undefined ? undefined : totalOutside(prBody));
  const posted = commentOnTicket(ticket, record(ticket, gathered, speed), gh);
  if (posted.refusals.length > 0) {
    console.error(`close: #${ticket} got no closing record: ${quoted(posted.refusals[0])}`);
    return 1;
  }
  const done = gathered.length > 0 && gathered.every((verdict) => verdict.merge);
  if (done) {
    if (gh(["issue", "close", ticket]).status !== 0) {
      console.error(`close: #${ticket} is done but could not be closed${recorded(posted.said)}`);
      return 1;
    }
    console.log(`close: #${ticket} closed, every check green on the merge commit${recorded(posted.said)}`);
    return 0;
  }
  if (gh(["issue", "view", ticket, "--json", "state", "--jq", ".state"]).stdout.trim() === "CLOSED") gh(["issue", "reopen", ticket]);
  console.log(`close: #${ticket} left open, a check is red on the merge commit${recorded(posted.said)}`);
  return 0;
}

if (import.meta.main) process.exit(close());
