import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { scratchDir } from "./scratch.fixture.ts";
import { readArgvLog } from "./stub-gh.fixture.ts";
import { makeTempRepo } from "./temp-repo.fixture.ts";

/**
 * @fixture Reached only from the suites, by design: a lane that ran `bin/close-ticket` through a
 * stub `gh` would be a lane that never talked to the tracker.
 */

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const CLOSE_TICKET = join(REPO_ROOT, "bin/close-ticket");

export function loadAsModule(name: string, path: string, sysPath?: string): string {
  const pathLine = sysPath === undefined ? "" : `sys.path.insert(0, ${JSON.stringify(sysPath)})`;
  return `
import importlib.util, json, sys
from importlib.machinery import SourceFileLoader
${pathLine}
loader = SourceFileLoader(${JSON.stringify(name)}, ${JSON.stringify(path)})
module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(module)
`;
}

export function python(script: string, input: string, env: Record<string, string | undefined> = {}): { stdout: string; stderr: string } {
  const run = spawnSync("python3", ["-c", script], {
    input,
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
  expect(run.status, run.stderr).toBe(0);
  return { stdout: run.stdout, stderr: run.stderr };
}

export function inCloseTicket(body: string, payload: unknown, env: Record<string, string | undefined> = {}): { stdout: string; stderr: string } {
  return python(
    `${loadAsModule("close_ticket", CLOSE_TICKET)}\npayload = json.load(sys.stdin)\n${body}\n`,
    JSON.stringify(payload),
    { VERIFY_WORKFLOW: "verify-caller.yml", ...env },
  );
}

export interface Route {
  contains: string[];
  respond: string;
}

export interface Tracker {
  path: string;
  calls: () => string[][];
}

export function trackerAnswering(routes: Route[]): Tracker {
  const dir = scratchDir("tracker-gh");
  const path = join(dir, "gh");
  const log = join(dir, "argv.jsonl");
  const script = `#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
with open(${JSON.stringify(log)}, "a") as f:
    f.write(json.dumps(args) + "\\n")
joined = " ".join(args)
routes = ${JSON.stringify(routes)}
for route in routes:
    if all(needle in joined for needle in route["contains"]):
        print(route["respond"])
        sys.exit(0)
print("{}")
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return { path, calls: () => readArgvLog(log) };
}

export function issueViewRoute(body: string): Route {
  return { contains: ["issue", "view"], respond: JSON.stringify({ body, comments: [] }) };
}

export interface PrRefNode {
  number: number;
  url: string;
  merged: boolean;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
}

export function closingPrRoute(nodes: PrRefNode[]): Route {
  return {
    contains: ["api", "graphql"],
    respond: JSON.stringify({
      data: { repository: { issue: { closedByPullRequestsReferences: { nodes } } } },
    }),
  };
}

export function mergedPr(number: number, oid: string, mergedAt = "2026-09-01T00:00:00Z"): PrRefNode {
  return { number, url: `https://github.com/acme/widgets/pull/${number}`, merged: true, mergedAt, mergeCommit: { oid } };
}

export function verifyRoutes(jobs: { name: string; status: string; conclusion: string | null }[], prUrl: string): Route[] {
  return [
    { contains: ["actions/workflows/verify-caller.yml/runs"], respond: JSON.stringify([{ id: 555, status: "completed" }]) },
    { contains: ["actions/runs/555/jobs"], respond: JSON.stringify(jobs.map((j, i) => ({ id: i + 1, ...j }))) },
    { contains: ["run", "view", "--job", "1", "--log"], respond: `judging ${prUrl} on implement/issue-999` },
  ];
}

export function checkoutWithCommits(commits: number): { checkout: string; shas: string[] } {
  const repo = makeTempRepo("close-ticket-repo");
  const shas: string[] = [];
  for (let n = 0; n < commits; n += 1) {
    repo.write(`file-${n}.txt`, `${n}\n`);
    shas.push(repo.commit(`commit ${n}`));
  }
  return { checkout: repo.dir, shas };
}

export interface CloseRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function closeTicket(args: string[], ghPath: string, env: Record<string, string | undefined> = {}): CloseRun {
  const run = spawnSync("python3", [CLOSE_TICKET, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, AGENT_SKILLS_GH: ghPath, VERIFY_WORKFLOW: "verify-caller.yml", ...env },
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}
