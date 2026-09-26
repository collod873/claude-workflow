import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { passingCriteria } from "./check-runner.ts";
import { STOPS, type Stopped } from "./stops.ts";
import { checks, claims, ticketRefusals, withRenamedPath } from "./ticket-shape.ts";

const CONFIG_FLAG = /--config[ \t]+(\S+)/;
const RENAME = /^R\d*\t([^\t]+)\t([^\t]+)$/;

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

interface History {
  renamedTo: Map<string, string>;
  touched: Set<string>;
}

const PLAIN_STATUS = /^[AMD]\t(.+)$/;

function readHistory(): History {
  const renamedTo = new Map<string, string>();
  const touched = new Set<string>();
  for (const line of git(["log", "--name-status", "--format="]).stdout.split("\n")) {
    const [, from, to] = RENAME.exec(line) ?? [];
    if (from !== undefined && to !== undefined) {
      touched.add(from);
      touched.add(to);
      if (!renamedTo.has(from)) renamedTo.set(from, to);
      continue;
    }
    const [, plain] = PLAIN_STATUS.exec(line) ?? [];
    if (plain !== undefined) touched.add(plain);
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

function startRefusals(ticket: string): { notices: string[]; stopped?: Stopped } {
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return { notices: [], stopped: { stop: "unread", refusals: [`ticket ${ticket} could not be read, so nothing judged it`] } };
  const body = asked.stdout;
  const shape = ticketRefusals(body);
  if (shape.length > 0) return { notices: [], stopped: { stop: "shape", refusals: shape } };
  const tree = treeRefusals();
  if (tree.length > 0) return { notices: [], stopped: { stop: "unfreshTree", refusals: tree } };
  const stale = staleOutcome(body, ticket);
  if (stale.refusals.length > 0) return { notices: stale.notices, stopped: { stop: "stale", refusals: stale.refusals } };
  const passing = passingCriteria(stale.body, process.cwd());
  return { notices: stale.notices, stopped: passing.length > 0 ? { stop: "alreadyPasses", refusals: passing } : undefined };
}

if (import.meta.main) {
  const ticket = process.argv[2];
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  const { notices, stopped } = startRefusals(ticket);
  for (const notice of notices) console.error(notice);
  for (const refusal of stopped?.refusals ?? []) console.error(refusal);
  if (stopped !== undefined) console.log(STOPS[stopped.stop]);
  process.exit(stopped === undefined ? 0 : 1);
}
