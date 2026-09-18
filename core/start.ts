import { spawnSync } from "node:child_process";
import { passingCriteria } from "./check-runner.ts";
import { ticketRefusals } from "./ticket-shape.ts";

const SETTLED = new Set(["success", "skipped", "neutral"]);

interface CheckRun {
  name: string;
  conclusion: string | null;
}

const gh = (args: string[]) => spawnSync("gh", args, { encoding: "utf8" });
const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" });

function treeRefusals(): string[] {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  if (branch !== "main") return [`a build starts from main, and this tree is on ${branch}`];
  if (git(["status", "--porcelain"]).stdout.trim() !== "") return ["this tree carries uncommitted work, so a build would not start from main as it stands"];
  const counted = git(["rev-list", "--count", "HEAD..origin/main"]);
  if (counted.status !== 0) return ["origin/main could not be read, so nothing knows whether this tree is fresh"];
  const behind = Number(counted.stdout.trim());
  return behind === 0 ? [] : [`this tree is ${behind} commit${behind === 1 ? "" : "s"} behind origin/main`];
}

export function mainRefusals(answered: string): string[] {
  let ran: CheckRun[];
  try {
    ran = (JSON.parse(answered) as { check_runs: CheckRun[] }).check_runs;
  } catch {
    return ["GitHub's answer about main did not parse, so the ticket waits"];
  }
  return ran
    .filter((run) => run.conclusion !== null && !SETTLED.has(run.conclusion))
    .map((run) => `main is red: ${run.name} ${run.conclusion}`);
}

function redRefusals(): string[] {
  const asked = gh(["api", "repos/{owner}/{repo}/commits/main/check-runs"]);
  return asked.status === 0 ? mainRefusals(asked.stdout) : ["GitHub would not say whether main is green, so the ticket waits"];
}

function startRefusals(ticket: string): string[] {
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return [`ticket ${ticket} could not be read, so nothing judged it`];
  const body = asked.stdout;
  const shape = ticketRefusals(body);
  if (shape.length > 0) return shape;
  const tree = treeRefusals();
  if (tree.length > 0) return tree;
  const red = redRefusals();
  return red.length > 0 ? red : passingCriteria(body, process.cwd());
}

if (import.meta.main) {
  const refusals = startRefusals(process.argv[2]);
  for (const refusal of refusals) console.error(refusal);
  process.exit(refusals.length > 0 ? 1 : 0);
}
