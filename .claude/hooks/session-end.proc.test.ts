import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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

const hookPath = fileURLToPath(new URL("session-end.py", import.meta.url));
const rosterPath = fileURLToPath(new URL("roster.json", import.meta.url));

const trackerCliSource = `#!/usr/bin/env python3
import json
import subprocess
import sys

NEWLINE = chr(10)
LOGIN = "octocat"

ISSUES = [
    {
        "number": 9100,
        "title": "Sessions do not finish",
        "state": "OPEN",
        "labels": [{"name": "spec"}, {"name": "prd"}, {"name": "journey"}],
        "assignees": [],
        "body": "## Acceptance criteria" + NEWLINE + NEWLINE + "- [ ] I will know it works when a session is handed the next by-hand ticket",
    },
    {
        "number": 9101,
        "title": "Door stood this one down",
        "state": "OPEN",
        "labels": [{"name": "needs-human"}],
        "assignees": [],
        "body": "refused at the to-build door",
    },
    {
        "number": 9142,
        "title": "Rewire the workstation symlinks",
        "state": "OPEN",
        "labels": [{"name": "by-hand"}],
        "assignees": [{"login": LOGIN}],
        "body": "claimed by this session and left open",
    },
]


def value_of(argv, flag):
    if flag in argv:
        index = argv.index(flag)
        if index + 1 < len(argv):
            return argv[index + 1]
    for item in argv:
        if item.startswith(flag + "="):
            return item.split("=", 1)[1]
    return None


def selected(argv):
    rows = [dict(row) for row in ISSUES]
    state = value_of(argv, "--state") or "open"
    if state.lower() != "all":
        rows = [row for row in rows if row["state"].lower() == state.lower()]
    label = value_of(argv, "--label")
    if label:
        rows = [row for row in rows if label in [entry["name"] for entry in row["labels"]]]
    assignee = value_of(argv, "--assignee")
    if assignee:
        who = LOGIN if assignee == "@me" else assignee
        rows = [row for row in rows if who in [entry["login"] for entry in row["assignees"]]]
    return rows


def rendered(argv, payload):
    text = json.dumps(payload)
    expression = value_of(argv, "--jq") or value_of(argv, "-q")
    if not expression:
        return text
    try:
        done = subprocess.run(["jq", "-r", expression], input=text, capture_output=True, text=True)
    except OSError:
        return text
    if done.returncode != 0:
        return text
    return done.stdout.rstrip()


def main():
    argv = sys.argv[1:]
    if "api" in argv and any(item.rstrip("/").endswith("user") for item in argv):
        payload = {"login": LOGIN}
    else:
        payload = selected(argv)
    print(rendered(argv, payload))
    return 0


sys.exit(main())
`;

function filesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

function sessionRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "session-end-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  mkdirSync(join(repo, "bin"));
  const cliPath = join(repo, "bin", "gh");
  writeFileSync(cliPath, trackerCliSource);
  chmodSync(cliPath, 0o755);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return repo;
}

test.fails(
  "#442.1: running the hook writes a snapshot file under .claude/state/ naming the stubbed open issues and this session's claimed-and-open by-hand ticket",
  () => {
    const repo = sessionRepo();
    const payload = JSON.stringify({
      session_id: "session-442",
      transcript_path: join(repo, "transcript.jsonl"),
      cwd: repo,
      hook_event_name: "SessionEnd",
      reason: "clear",
    });

    try {
      execFileSync("python3", [hookPath], {
        cwd: repo,
        input: payload,
        env: {
          ...process.env,
          HOME: repo,
          CLAUDE_PROJECT_DIR: repo,
          GH_TOKEN: "stub-token",
          PATH: `${join(repo, "bin")}:${process.env.PATH ?? ""}`,
        },
      });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }

    const stateDir = join(repo, ".claude", "state");
    expect(existsSync(stateDir)).toBe(true);

    const snapshot = filesUnder(stateDir)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(snapshot).toContain("9142");
    expect(snapshot).toMatch(/91(00|01)/);
  },
);

test.fails("#442.2: session-end.py is registered under SessionEnd in the hook roster", () => {
  const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as Record<string, string[]>;
  expect(roster.SessionEnd).toContain("session-end.py");
});
