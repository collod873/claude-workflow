import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const hooksDir = fileURLToPath(new URL(".", import.meta.url));
const hookPath = join(hooksDir, "session-brief.py");
const rosterPath = join(hooksDir, "roster.json");

const STUB_GH = `#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
joined = " ".join(args)
issues = json.loads(os.environ.get("STUB_GH_ISSUES", "[]"))

if args[:1] == ["repo"]:
    print(json.dumps({"nameWithOwner": "stub/repo", "name": "repo", "owner": {"login": "stub"}}))
elif "sub_issues" in joined or "sub-issue" in joined or "timeline" in joined:
    print("[]")
else:
    print(json.dumps(issues))
`;

const FIRST_CRITERION = "Opening a fresh session hands me the next by-hand ticket";
const SECOND_CRITERION = "A found gap is filed under a parent criterion or dropped";
const FIRST_CHECK = "npm run lane-map";

const OPEN_PRD_ISSUE = {
  number: 501,
  title: "Journey: the session is a lane",
  state: "open",
  url: "https://github.com/stub/repo/issues/501",
  html_url: "https://github.com/stub/repo/issues/501",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "prd" }],
  assignees: [],
  body: [
    "## Problem Statement",
    "",
    "Multi-session goals do not finish.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] " + FIRST_CRITERION + " - check: `" + FIRST_CHECK + "`",
    "- [ ] " + SECOND_CRITERION + " - check: `npm test`",
    "",
  ].join("\n"),
};

type World = { root: string; home: string; repo: string; bin: string };

function makeWorld(): World {
  const root = mkdtempSync(join(tmpdir(), "sb-hook-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  mkdirSync(home);
  mkdirSync(repo);
  mkdirSync(bin);
  const gh = join(bin, "gh");
  writeFileSync(gh, STUB_GH);
  chmodSync(gh, 0o755);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return { root, home, repo, bin };
}

function fire(world: World, issues: unknown[]) {
  return spawnSync("python3", [hookPath], {
    cwd: world.repo,
    encoding: "utf8",
    input: JSON.stringify({
      session_id: "sb-test-1",
      transcript_path: join(world.root, "transcript.jsonl"),
      cwd: world.repo,
      hook_event_name: "SessionStart",
      source: "startup",
    }),
    env: {
      ...process.env,
      HOME: world.home,
      PATH: `${world.bin}:${process.env.PATH ?? ""}`,
      CLAUDE_PROJECT_DIR: world.repo,
      STUB_GH_ISSUES: JSON.stringify(issues),
    },
  });
}

function countRunRows(dir: string): number {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countRunRows(full);
      continue;
    }
    if (!entry.isFile()) continue;
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    total += entry.name.includes("session-brief")
      ? lines.length
      : lines.filter((line) => line.includes("session-brief")).length;
  }
  return total;
}

test.fails(
  "#440.1: a stubbed repo with one open prd issue prints its first criterion's sentence with any check-marker stripped; none open prints nothing",
  () => {
    const withPrd = fire(makeWorld(), [OPEN_PRD_ISSUE]);
    expect(withPrd.stdout).toContain(FIRST_CRITERION);
    expect(withPrd.stdout).not.toContain(FIRST_CHECK);
    expect(withPrd.stdout).not.toContain("check:");
    expect(withPrd.stdout).not.toContain(SECOND_CRITERION);

    const noPrd = fire(makeWorld(), []);
    expect(noPrd.status).toBe(0);
    expect(noPrd.stdout.trim()).toBe("");
  },
);

test.fails("#440.2: session-brief.py is registered under SessionStart in the hook roster", () => {
  const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as Record<string, string[]>;
  expect(roster.SessionStart).toContain("session-brief.py");
});

test.fails("#440.3: the hook writes its own run row on every fire", () => {
  const world = makeWorld();

  fire(world, [OPEN_PRD_ISSUE]);
  const afterFirstFire = countRunRows(world.home) + countRunRows(world.repo);
  expect(afterFirstFire).toBeGreaterThanOrEqual(1);

  fire(world, [OPEN_PRD_ISSUE]);
  const afterSecondFire = countRunRows(world.home) + countRunRows(world.repo);
  expect(afterSecondFire).toBeGreaterThan(afterFirstFire);
});
