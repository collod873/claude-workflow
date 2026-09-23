import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "./check-runner.ts";
import { postClosing } from "./post.ts";
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

function ticketBuilt(subject: string): string | undefined {
  const [, pr, branch] = MERGED.exec(subject) ?? [];
  if (branch !== undefined || pr === undefined) return branch;
  const asked = gh(["pr", "view", pr, "--json", "body", "--jq", ".body"]);
  return asked.status === 0 ? BUILDS.exec(asked.stdout)?.[1] : undefined;
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

function record(ticket: string, gathered: Verdict[]): string {
  if (gathered.length === 0) return `#${ticket} carries no check, so nothing proves it done on the merge commit; left open`;
  const red = gathered.filter((verdict) => !verdict.merge);
  if (red.length > 0) {
    return [`#${ticket} is not done: a check is red on the merge commit`, "", ...red.map(({ command, why }) => `- \`${command}\` ${why} on the merge commit`)].join("\n");
  }
  return [
    `#${ticket} is done: every check is green on the merge commit`,
    "",
    ...gathered.map(({ command, base }) => `- \`${command}\` was ${base ? "already green" : "red"} at base, green at merge`),
  ].join("\n");
}

const recorded = (said: string) => (said === "" ? "" : `; record ${said}`);

function close(): number {
  const top = process.cwd();
  const ticket = ticketBuilt(git(["log", "-1", "--format=%s", "HEAD"]).stdout.trim());
  if (ticket === undefined) return 0;
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) {
    console.error(`close: ticket ${ticket} could not be read, so nothing judged it`);
    return 1;
  }
  const gathered = verdicts(checks(asked.stdout).map(({ command }) => command), top);
  const posted = postClosing(ticket, record(ticket, gathered), gh);
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
