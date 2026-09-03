import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { scratchDir } from "./scratch.fixture.ts";
import { readArgvLog } from "./stub-gh.fixture.ts";
import { makeTempRepo } from "./temp-repo.fixture.ts";

/**
 * The seams `bin/close-ticket`'s two suites drive the real script through — `close-ticket.proc.test.ts`
 * (its functions, loaded as a module, and the whole close end to end) and `render-body.proc.test.ts`
 * (lane 03's rendered body, closed by the script that reads it).
 *
 * Every helper here spawns something: the Python interpreter over the real script, or the script
 * itself against a `gh` this file controls. That is the whole reason they live in a fixture rather
 * than the suites — a `*.test.ts` may not import `node:child_process`, and the two suites had each
 * grown their own copy of the module loader, the checkout builder and the `gh` stub before the
 * clone gate lost its baseline (#360).
 *
 * @fixture Reached only from the suites, by design: a lane that ran `bin/close-ticket` through a
 * stub `gh` would be a lane that never talked to the tracker.
 */

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const CLOSE_TICKET = join(REPO_ROOT, "bin/close-ticket");

/**
 * Python that loads a suffix-less script as module `name`, bound to `module`.
 *
 * Named through an explicit loader: the script has no `.py` suffix, and `spec_from_file_location`
 * alone declines to guess a loader for that. `sysPath`, when given, is prepended so a script that
 * imports a sibling off its own directory (`close-gate.py`'s `_hook`) resolves it when loaded as a
 * module rather than run.
 */
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

/** Runs `python -c script` with `input` on stdin and `env` over the worker's, asserting it exited 0. */
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

/**
 * Loads `bin/close-ticket` as a module and runs `body` against it, JSON in (`payload`), JSON out.
 *
 * `VERIFY_WORKFLOW` is pinned to `verify-caller.yml` here rather than left to whatever the test
 * runner's own environment happens to carry — `verify_workflow_file()`'s workstation default and
 * its runner refusal each get their own cases, driven with their own explicit `env`, so every other
 * case exercises the ordinary, explicitly-configured path instead of that fallback.
 */
export function inCloseTicket(body: string, payload: unknown, env: Record<string, string | undefined> = {}): { stdout: string; stderr: string } {
  return python(
    `${loadAsModule("close_ticket", CLOSE_TICKET)}\npayload = json.load(sys.stdin)\n${body}\n`,
    JSON.stringify(payload),
    { VERIFY_WORKFLOW: "verify-caller.yml", ...env },
  );
}

/** One answer a `trackerAnswering` stub gives: the first route whose every `contains` substring appears in the space-joined argv wins. */
export interface Route {
  contains: string[];
  respond: string;
}

export interface Tracker {
  /** Absolute path to the stub, for `AGENT_SKILLS_GH`. */
  path: string;
  /** Every invocation's argv, oldest first — read from a log, because the calls are made by a child process. */
  calls: () => string[][];
}

/**
 * A `gh` whose answer depends on *which* subcommand was called. `stub-gh.fixture.ts`'s `stubGh`
 * answers every call identically, which is enough for a single `issue view` read but not for
 * `fetch_closing_pr`/`fetch_verify_verdict` (#306), each of which makes several different calls in
 * sequence and needs a different answer to each. `routes` is tried in order; the winner's `respond`
 * is printed verbatim. A call matching nothing gets `{}`.
 *
 * Written in Python rather than bash so a body carrying backticks — every criterion does, by
 * construction — reaches the script intact: bash would run one as a command substitution, silently
 * handing close-ticket a body with the marker's quoting removed, which is the very defect
 * `render-body.proc.test.ts` exists to catch.
 */
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

/** The `issue view --json body,comments` answer for a ticket whose body is `body` and which has no comments. */
export function issueViewRoute(body: string): Route {
  return { contains: ["issue", "view"], respond: JSON.stringify({ body, comments: [] }) };
}

/** One `closedByPullRequestsReferences` node, in the shape `fetch_closing_pr` reads. */
export interface PrRefNode {
  number: number;
  url: string;
  merged: boolean;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
}

/** The `api graphql` answer to `fetch_closing_pr`'s query, with `nodes` as the issue's `closedByPullRequestsReferences`. */
export function closingPrRoute(nodes: PrRefNode[]): Route {
  return {
    contains: ["api", "graphql"],
    respond: JSON.stringify({
      data: { repository: { issue: { closedByPullRequestsReferences: { nodes } } } },
    }),
  };
}

/** A pull request node that merged at `mergedAt` with merge commit `oid`. */
export function mergedPr(number: number, oid: string, mergedAt = "2026-09-01T00:00:00Z"): PrRefNode {
  return { number, url: `https://github.com/acme/widgets/pull/${number}`, merged: true, mergedAt, mergeCommit: { oid } };
}

/**
 * The three-call sequence `fetch_verify_verdict` makes: the workflow's run list, that run's jobs,
 * and the Immutability job's log — which names `prUrl`, so the verdict applies to it.
 */
export function verifyRoutes(jobs: { name: string; status: string; conclusion: string | null }[], prUrl: string): Route[] {
  return [
    { contains: ["actions/workflows/verify-caller.yml/runs"], respond: JSON.stringify([{ id: 555, status: "completed" }]) },
    { contains: ["actions/runs/555/jobs"], respond: JSON.stringify(jobs.map((j, i) => ({ id: i + 1, ...j }))) },
    { contains: ["run", "view", "--job", "1", "--log"], respond: `judging ${prUrl} on implement/issue-999` },
  ];
}

/** A repository at a fresh temp path with `commits` commits on it, newest SHA last. */
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

/**
 * One real `bin/close-ticket` invocation against the `gh` at `ghPath`. `VERIFY_WORKFLOW` is pinned
 * the same way `inCloseTicket` pins it, and for the same reason.
 */
export function closeTicket(args: string[], ghPath: string, env: Record<string, string | undefined> = {}): CloseRun {
  const run = spawnSync("python3", [CLOSE_TICKET, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, AGENT_SKILLS_GH: ghPath, VERIFY_WORKFLOW: "verify-caller.yml", ...env },
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}
