import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "./check-runner.ts";
import { postClosing } from "./post.ts";
import { checks } from "./ticket-shape.ts";

const HEAD_BRANCH = /\bticket\/(\d+)\b/;
const PR_NUMBER = /#(\d+)/;
const BUILDS = /\bBuilds #(\d+)\b/;

const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: Infinity });
const gh = (args: string[]) => run("gh", args);
const git = (args: string[]) => run("git", args);

function ticketBuilt(message: string): string | undefined {
  const branch = HEAD_BRANCH.exec(message)?.[1];
  if (branch !== undefined) return branch;
  const pr = PR_NUMBER.exec(message)?.[1];
  if (pr === undefined) return undefined;
  const body = gh(["pr", "view", pr, "--json", "body", "--jq", ".body"]);
  return body.status === 0 ? BUILDS.exec(body.stdout)?.[1] : undefined;
}

interface Verdict {
  command: string;
  base: boolean;
  merge: boolean;
}

function worktreeAt(rev: string): string {
  const dir = mkdtempSync(join(tmpdir(), "close-base-"));
  rmSync(dir, { recursive: true, force: true });
  git(["worktree", "add", "--quiet", "--detach", dir, rev]);
  return dir;
}

function removeWorktree(dir: string): void {
  git(["worktree", "remove", "--force", dir]);
}

function verdicts(commands: string[]): Verdict[] {
  const base = worktreeAt("HEAD^1");
  const gathered = commands.map((command) => ({ command, base: runCheck(command, base).passed, merge: runCheck(command, process.cwd()).passed }));
  removeWorktree(base);
  return gathered;
}

function record(ticket: string, gathered: Verdict[]): string {
  const red = gathered.filter((verdict) => !verdict.merge);
  if (red.length > 0) {
    return [`#${ticket}'s checks are not all green on the merge commit:`, ...red.map(({ command }) => `- \`${command}\` is red on the merge commit`)].join("\n");
  }
  return [
    `#${ticket}'s checks all pass on the merge commit:`,
    ...gathered.map(({ command, base }) => `- \`${command}\` was ${base ? "green" : "red"} at base, green at merge`),
  ].join("\n");
}

function closeIfDone(): number {
  const message = git(["log", "-1", "--format=%B", "HEAD"]).stdout;
  const ticket = ticketBuilt(message);
  if (ticket === undefined) return 0;

  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) {
    console.error(`ticket ${ticket} could not be read, so nothing closed it`);
    return 0;
  }

  const gathered = verdicts(checks(asked.stdout).map(({ command }) => command));
  const { refusals } = postClosing(ticket, record(ticket, gathered), gh);
  for (const refusal of refusals) console.error(refusal);

  if (gathered.every((verdict) => verdict.merge)) gh(["issue", "close", ticket]);
  return 0;
}

if (import.meta.main) process.exit(closeIfDone());
