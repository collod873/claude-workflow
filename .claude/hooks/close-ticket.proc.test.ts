import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { GH_REPO_SLUG, ghStubHarness, namesRepo, type GhCall } from "./gh-stub-harness";

test("#418.3: close-ticket -R is unchanged by the shared fix", () => {
  const harness = ghStubHarness();
  const script = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(harness.binDir)})`,
    "import gh_support",
    `gh = gh_support.bind_gh(${JSON.stringify(harness.gh)}, ${JSON.stringify(GH_REPO_SLUG)})`,
    'view = gh("repo", "view", capture_output=True, text=True)',
    'close = gh("issue", "close", "418", capture_output=True, text=True)',
    "sys.stderr.write(view.stderr + close.stderr)",
    "sys.exit(view.returncode or close.returncode)",
  ].join("\n");

  const run = spawnSync("python3", ["-c", script], { env: harness.env(), encoding: "utf8" });
  const calls: GhCall[] = harness.calls();

  expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
    ["repo", "view"],
    ["issue", "close"],
  ]);

  expect(calls[0].argv).not.toContain("-R");
  expect(calls[0].argv).not.toContain("--repo");

  for (const call of calls) {
    expect(namesRepo(call), JSON.stringify(call.argv)).toBe(true);
  }

  expect(String(run.stderr)).not.toContain("unknown shorthand flag");
  expect(run.status, String(run.stderr)).toBe(0);
});

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR =
  [resolve(HOOKS_DIR, ".."), resolve(HOOKS_DIR, "../..")].find((candidate) =>
    existsSync(join(candidate, "bin")),
  ) ?? resolve(HOOKS_DIR, "../..");
const CLOSE_TICKET = join(REPO_DIR, "bin", "close-ticket");

const PARENT_REPO = "acme/widgets";
const CHILD_REPO = "other/lumaria";
const RECORD_BASE = "0ccb947fba609a5c8f6d65da3d8bd0d8238fde24";
const HEAD_ON_DEFAULT = "4405f5dbcc23c7b3458dc940f21cbf8dd943c141";
const HEAD_OFF_DEFAULT = "0f1e2d3c4b5a69788796a5b4c3d2e1f000112233";

const SPEC_BODY = [
  "## Problem Statement",
  "",
  "A spec refuses to close on a child the machine itself closed.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] the world is green - check: `echo spec-471-green`",
  "",
].join("\n");

const STUB_SOURCE = `#!/usr/bin/env python3
import json
import os
import sys

argv = sys.argv[1:]

with open(os.environ["STUB_LOG"], "a", encoding="utf-8") as handle:
    handle.write(json.dumps({"argv": argv}) + "\\n")

plan = json.loads(os.environ["STUB_PLAN"])

VALUE_FLAGS = (
    "--jq", "-q", "-H", "--header", "-f", "-F", "-X", "--method", "--template", "-t",
    "--body-file", "--input",
)


def jq_expression(args):
    for index, arg in enumerate(args):
        if arg in ("--jq", "-q") and index + 1 < len(args):
            expression = args[index + 1]
            if any(token in expression for token in "|[()"):
                return None
            return expression
    return None


def rest_path(args):
    skip = False
    for arg in args:
        if skip:
            skip = False
            continue
        if arg in VALUE_FLAGS:
            skip = True
            continue
        if arg.startswith("-"):
            continue
        return arg
    return ""


def emit(payload, expression=None):
    if expression and not expression.startswith("."):
        sys.stderr.write("failed to parse jq expression: function not defined: " + expression + "/0\\n")
        sys.exit(1)
    if expression:
        cursor = payload
        for key in [part for part in expression.split(".") if part]:
            cursor = cursor.get(key) if isinstance(cursor, dict) else None
        payload = cursor
    if isinstance(payload, str):
        sys.stdout.write(payload + "\\n")
    else:
        sys.stdout.write(json.dumps(payload) + "\\n")
    sys.exit(0)


if argv[:2] == ["issue", "view"]:
    emit({"state": "OPEN"} if "state" in argv else {"body": plan["body"]})
if argv[:2] == ["repo", "view"]:
    emit({"nameWithOwner": plan["repo"]})
if argv[:2] == ["issue", "comment"]:
    sys.stdin.read()
    emit("")
if argv[:2] == ["issue", "close"]:
    emit("")
if argv[:2] == ["api", "graphql"]:
    if "subIssues" in " ".join(argv):
        emit(plan["subIssues"])
    emit({"data": {"repository": {"issue": {"closedByPullRequestsReferences": {"nodes": []}}}}})
if argv[:1] == ["api"]:
    rest = argv[1:]
    path = rest_path(rest)
    if "actions/" in path:
        sys.stderr.write("stub: no workflow runs\\n")
        sys.exit(1)
    for pattern, payload in plan["api"].items():
        if pattern in path:
            emit(payload, jq_expression(rest))
    sys.stderr.write("stub: no canned response for " + path + "\\n")
    sys.exit(1)

sys.stderr.write("stub: unexpected call " + " ".join(argv) + "\\n")
sys.exit(1)
`;

function closingRecord(head: string): string {
  return [
    "## Closing record",
    "",
    "`" + RECORD_BASE + ".." + head + "`",
    "",
    "4 of 4 criteria verified · 0 unverified",
    "",
    "- the lane closes its own tickets (MET: `true` exit 0)",
    "",
  ].join("\n");
}

function closedChild(number: number, stateReason: string, comments: string[]) {
  return {
    number,
    state: "CLOSED",
    stateReason,
    repository: { nameWithOwner: CHILD_REPO, defaultBranchRef: { name: "main" } },
    closedByPullRequestsReferences: { nodes: [] },
    comments: { nodes: comments.map((body) => ({ body })) },
  };
}

function subIssuesPayload(children: ReturnType<typeof closedChild>[]) {
  return { data: { repository: { issue: { subIssues: { nodes: children } } } } };
}

function comparePlan(status: string): Record<string, unknown> {
  return {
    "/compare/": { status, ahead_by: 0, behind_by: 1 },
    ["repos/" + CHILD_REPO]: { default_branch: "main", full_name: CHILD_REPO },
    ["repos/" + PARENT_REPO]: { default_branch: "main", full_name: PARENT_REPO },
  };
}

function runSpecClose(
  issue: string,
  children: ReturnType<typeof closedChild>[],
  compareStatus: string,
) {
  const workspace = mkdtempSync(join(tmpdir(), "close-ticket-471-"));
  const stub = join(workspace, "stub-gh.py");
  writeFileSync(stub, STUB_SOURCE);
  chmodSync(stub, 0o755);
  const checkout = join(workspace, "checkout");
  mkdirSync(checkout);
  const log = join(workspace, "gh-calls.jsonl");

  const run = spawnSync(
    "python3",
    [CLOSE_TICKET, issue, "aaa1111..bbb2222", checkout, "--spec"],
    {
      env: {
        ...process.env,
        AGENT_SKILLS_GH: stub,
        STUB_LOG: log,
        STUB_PLAN: JSON.stringify({
          body: SPEC_BODY,
          repo: PARENT_REPO,
          subIssues: subIssuesPayload(children),
          api: comparePlan(compareStatus),
        }),
      },
      encoding: "utf8",
    },
  );

  const calls: string[][] = existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => (JSON.parse(line) as { argv: string[] }).argv)
    : [];

  return { run, calls };
}

test(
  "#471.1: --spec closes a spec whose child was closed with a `## Closing record` whose head sha is on the child repository's default branch, refuses one whose record head is not, and still refuses a `not planned` child that carries a record",
  () => {
    const onDefault = runSpecClose(
      "471",
      [closedChild(880, "COMPLETED", ["Working on it now.", closingRecord(HEAD_ON_DEFAULT)])],
      "behind",
    );
    expect(String(onDefault.run.status) + String(onDefault.run.stderr)).toContain("0");
    expect(onDefault.run.status, String(onDefault.run.stderr)).toBe(0);
    expect(onDefault.run.stdout).toContain("1 of 1 criteria verified");
    expect(onDefault.run.stdout).toContain("spec-471-green");
    expect(onDefault.calls.map((argv) => argv.slice(0, 2))).toContainEqual(["issue", "close"]);

    const offDefault = runSpecClose(
      "472",
      [closedChild(881, "COMPLETED", ["Working on it now.", closingRecord(HEAD_OFF_DEFAULT)])],
      "diverged",
    );
    expect(offDefault.run.status).not.toBe(0);
    expect(offDefault.run.stderr).toContain("#881");
    expect(offDefault.run.stderr).toContain("closed by hand, not by a merged PR");
    expect(offDefault.run.stdout).toBe("");
    expect(offDefault.calls.map((argv) => argv.slice(0, 2))).not.toContainEqual([
      "issue",
      "close",
    ]);
    expect(offDefault.calls.map((argv) => argv.slice(0, 2))).not.toContainEqual([
      "issue",
      "comment",
    ]);

    const notPlanned = runSpecClose(
      "473",
      [closedChild(882, "NOT_PLANNED", ["Working on it now.", closingRecord(HEAD_ON_DEFAULT)])],
      "behind",
    );
    expect(notPlanned.run.status).not.toBe(0);
    expect(notPlanned.run.stderr).toContain("#882");
    expect(notPlanned.run.stderr).toContain("not planned");
    expect(notPlanned.run.stdout).toBe("");
    expect(notPlanned.calls.map((argv) => argv.slice(0, 2))).not.toContainEqual([
      "issue",
      "close",
    ]);
  },
);

test(
  "#471.2: the sub-issue query carries each child's repository, so a cross-repository child's record is compared against its own default branch",
  () => {
    const { run, calls } = runSpecClose(
      "471",
      [closedChild(880, "COMPLETED", ["Working on it now.", closingRecord(HEAD_ON_DEFAULT)])],
      "behind",
    );

    const subIssueQuery =
      calls.find(
        (argv) => argv[0] === "api" && argv[1] === "graphql" && argv.join(" ").includes("subIssues"),
      ) ?? [];
    expect(subIssueQuery.join(" ")).toContain("subIssues");
    expect(subIssueQuery.join(" ")).toContain("nameWithOwner");

    const compareCalls = calls.filter(
      (argv) => argv[0] === "api" && argv.some((arg) => arg.includes("compare")),
    );
    expect(compareCalls.length).toBeGreaterThan(0);
    const comparePaths = compareCalls.map((argv) => argv.join(" ")).join("\n");
    expect(comparePaths).toContain(CHILD_REPO);
    expect(comparePaths).toContain(HEAD_ON_DEFAULT);
    expect(comparePaths).not.toContain(PARENT_REPO);

    expect(run.status, String(run.stderr)).toBe(0);
  },
);

test(
  "#471.3: the help text names the record as the second delivery route, in the paragraph that defines **delivered**",
  () => {
    const run = spawnSync("python3", [CLOSE_TICKET, "--help"], {
      env: { ...process.env },
      encoding: "utf8",
    });
    expect(run.status, String(run.stderr)).toBe(0);

    const help = String(run.stdout);
    expect(help).toContain("delivered by its own closing record");

    const paragraphs = help.split(/\n[ \t]*\n/);
    const definition = paragraphs.filter((paragraph) =>
      paragraph.includes("delivered by its own closing record"),
    );
    expect(definition.length).toBeGreaterThan(0);
    expect(definition.join("\n")).toContain("**delivered**");
  },
);
