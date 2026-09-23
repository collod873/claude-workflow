import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { passingCriteria } from "./check-runner.ts";
import { checks, claims, ticketRefusals, withRenamedPath } from "./ticket-shape.ts";

const SETTLED = new Set(["success", "skipped", "neutral"]);
const CONFIG_FLAG = /--config[ \t]+(\S+)/;
const RENAME = /^R\d*\t([^\t]+)\t([^\t]+)$/;

interface CheckRun {
  name: string;
  conclusion: string | null;
}

type Resolution = { kind: "exists" } | { kind: "renamed"; to: string } | { kind: "gone" } | { kind: "unknown" };

const gh = (args: string[]) => spawnSync("gh", args, { encoding: "utf8" });
const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8", maxBuffer: Infinity });

function treeRefusals(): string[] {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  if (branch !== "main") return [`a build starts from main, and this tree is on ${branch}`];
  if (git(["status", "--porcelain"]).stdout.trim() !== "") return ["this tree carries uncommitted work, so a build would not start from main as it stands"];
  if (git(["fetch", "--quiet", "origin", "main"]).status !== 0) return ["origin/main could not be fetched, so nothing knows whether this tree is fresh"];
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

interface History {
  renamedTo: Map<string, string>;
  touched: Set<string>;
}

const PLAIN_STATUS = /^[AMD]\t(.+)$/;

function readHistory(): History {
  const renamedTo = new Map<string, string>();
  const touched = new Set<string>();
  for (const line of git(["log", "--name-status", "--format="]).stdout.split("\n")) {
    const rename = RENAME.exec(line);
    if (rename !== null) {
      touched.add(rename[1]);
      touched.add(rename[2]);
      if (!renamedTo.has(rename[1])) renamedTo.set(rename[1], rename[2]);
      continue;
    }
    const plain = PLAIN_STATUS.exec(line);
    if (plain !== null) touched.add(plain[1]);
  }
  return { renamedTo, touched };
}

function resolvePath(path: string, history: History): Resolution {
  if (existsSync(path)) return { kind: "exists" };
  let current = path;
  const seen = new Set<string>();
  while (history.renamedTo.has(current) && !seen.has(current)) {
    seen.add(current);
    current = history.renamedTo.get(current) as string;
  }
  if (current !== path) return existsSync(current) ? { kind: "renamed", to: current } : { kind: "gone" };
  return history.touched.has(path) ? { kind: "gone" } : { kind: "unknown" };
}

function repoIsBuilt(): boolean {
  return git(["ls-tree", "-r", "--name-only", "HEAD"]).stdout.trim() !== "";
}

interface StaleOutcome {
  body: string;
  notices: string[];
  refusals: string[];
}

function staleOutcome(body: string, ticket: string): StaleOutcome {
  let rewritten = body;
  const notices: string[] = [];
  const refusals: string[] = [];
  const history = readHistory();
  const built = repoIsBuilt();

  for (const claim of claims(body)) {
    const resolved = resolvePath(claim, history);
    if (resolved.kind === "renamed") {
      rewritten = withRenamedPath(rewritten, claim, resolved.to);
      notices.push(`'## Files claimed' names \`${claim}\`, which git records as renamed to \`${resolved.to}\`: rewritten`);
    } else if (resolved.kind === "gone") {
      refusals.push(`'## Files claimed' names \`${claim}\`, which git records as deleted`);
    }
  }

  for (const { at, command } of checks(body)) {
    const config = CONFIG_FLAG.exec(command)?.[1];
    if (config === undefined) continue;
    const resolved = resolvePath(config, history);
    if (resolved.kind === "renamed") {
      rewritten = withRenamedPath(rewritten, config, resolved.to);
      notices.push(`${at}'s check names \`--config ${config}\`, which git records as renamed to \`${resolved.to}\`: rewritten`);
    } else if (resolved.kind === "gone" || (resolved.kind === "unknown" && built)) {
      refusals.push(`${at}'s check names \`--config ${config}\`, which does not exist and git records no rename for`);
    }
  }

  if (notices.length > 0) gh(["issue", "edit", ticket, "--body", rewritten]);
  return { body: rewritten, notices, refusals };
}

function startRefusals(ticket: string): { notices: string[]; refusals: string[] } {
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return { notices: [], refusals: [`ticket ${ticket} could not be read, so nothing judged it`] };
  const body = asked.stdout;
  const shape = ticketRefusals(body);
  if (shape.length > 0) return { notices: [], refusals: shape };
  const tree = treeRefusals();
  if (tree.length > 0) return { notices: [], refusals: tree };
  const stale = staleOutcome(body, ticket);
  if (stale.refusals.length > 0) return { notices: stale.notices, refusals: stale.refusals };
  const red = redRefusals();
  if (red.length > 0) return { notices: stale.notices, refusals: red };
  return { notices: stale.notices, refusals: passingCriteria(stale.body, process.cwd()) };
}

if (import.meta.main) {
  const { notices, refusals } = startRefusals(process.argv[2]);
  for (const notice of notices) console.error(notice);
  for (const refusal of refusals) console.error(refusal);
  process.exit(refusals.length > 0 ? 1 : 0);
}
