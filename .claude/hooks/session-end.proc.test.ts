import { execFileSync, spawnSync } from "node:child_process";
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
const briefHookPath = fileURLToPath(new URL("session-brief.py", import.meta.url));

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
    if argv[:2] == ["repo", "view"]:
        payload = {"nameWithOwner": "acme/workstation"}
    elif "api" in argv and any(item.rstrip("/").endswith("user") for item in argv):
        payload = {"login": LOGIN}
    else:
        payload = selected(argv)
    print(rendered(argv, payload))
    return 0


sys.exit(main())
`;

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

test(
  "#442.1: running the hook writes a snapshot file naming the stubbed open issues and this session's claimed-and-open by-hand ticket",
  async () => {
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

    const logDir = join(repo, ".claude", "logs");
    const snapshotPath = join(logDir, "session-snapshot-acme__workstation.json");
    const deadline = Date.now() + 20_000;
    while (!existsSync(snapshotPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(existsSync(snapshotPath)).toBe(true);

    const snapshot = readFileSync(snapshotPath, "utf8");
    expect(snapshot).toContain("9142");
    expect(snapshot).toMatch(/91(00|01)/);
  },
  30_000,
);

test("#442.2: session-end.py is registered under SessionEnd in the hook roster", () => {
  const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as Record<string, string[]>;
  expect(roster.SessionEnd).toContain("session-end.py");
});

const SNAPSHOT_LOGIN = "octocat";

const SNAPSHOT_GH = `#!/usr/bin/env python3
import json
import os
import sys
import time

args = sys.argv[1:]

time.sleep(float(os.environ.get("STUB_GH_SLEEP") or "0"))


def env_json(name, default):
    raw = os.environ.get(name) or default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(default)


def flag(name):
    for index, item in enumerate(args):
        if item == name and index + 1 < len(args):
            return args[index + 1]
        if item.startswith(name + "="):
            return item.split("=", 1)[1]
    return None


def has(*seq):
    seq = list(seq)
    return any(args[index:index + len(seq)] == seq for index in range(len(args)))


def labels_of(issue):
    names = []
    for label in issue.get("labels") or []:
        names.append(label.get("name") if isinstance(label, dict) else label)
    return names


def logins_of(issue):
    names = []
    for who in issue.get("assignees") or []:
        names.append(who.get("login") if isinstance(who, dict) else who)
    return names


LOGIN = os.environ.get("STUB_GH_LOGIN") or "octocat"
REPO = os.environ.get("STUB_GH_REPO") or ""
ISSUES = env_json("STUB_GH_ISSUES", "[]")

if has("repo", "view"):
    if not REPO:
        sys.stderr.write("could not determine base repository" + chr(10))
        sys.exit(1)
    owner, _, name = REPO.partition("/")
    print(json.dumps({"nameWithOwner": REPO, "name": name, "owner": {"login": owner}}))
elif any(item.rstrip("/").endswith("user") for item in args):
    print(json.dumps({"login": LOGIN}))
elif has("api"):
    print("[]")
else:
    selected = list(ISSUES)
    label = flag("--label")
    if label:
        selected = [item for item in selected if label in labels_of(item)]
    state = (flag("--state") or "").lower()
    if state in ("open", "closed"):
        selected = [item for item in selected if (item.get("state") or "open").lower() == state]
    assignee = flag("--assignee")
    if assignee:
        who = LOGIN if assignee == "@me" else assignee
        selected = [item for item in selected if who in logins_of(item)]
    print(json.dumps(selected))
`;

const ALPHA_TICKET = {
  number: 8401,
  title: "Rewire the alpha symlinks",
  state: "open",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: SNAPSHOT_LOGIN }],
  body: "## What to build\n\nRewire them.\n",
};

const ALPHA_TICKET_RELABELLED = {
  ...ALPHA_TICKET,
  labels: [{ name: "by-hand" }, { name: "blocked" }],
};

const BETA_TICKET = {
  number: 8402,
  title: "Rewire the beta symlinks",
  state: "open",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: SNAPSHOT_LOGIN }],
  body: "## What to build\n\nRewire them.\n",
};

const SLOW_TICKET = {
  number: 8403,
  title: "Prune the slow worktrees",
  state: "open",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: SNAPSHOT_LOGIN }],
  body: "## What to build\n\nPrune them.\n",
};

const TIDY_TICKET = {
  number: 8404,
  title: "Move the run rows",
  state: "open",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: SNAPSHOT_LOGIN }],
  body: "## What to build\n\nMove them.\n",
};

type Stage = { root: string; home: string; logDir: string; bin: string };

type EndOptions = { sessionId?: string; sleepSeconds?: number };

function makeStage(): Stage {
  const root = mkdtempSync(join(tmpdir(), "se484-"));
  const home = join(root, "home");
  const logDir = join(root, "logs");
  const bin = join(root, "bin");
  for (const dir of [home, logDir, bin]) {
    mkdirSync(dir, { recursive: true });
  }
  const gh = join(bin, "gh");
  writeFileSync(gh, SNAPSHOT_GH);
  chmodSync(gh, 0o755);
  return { root, home, logDir, bin };
}

function makeRepo(stage: Stage, nameWithOwner: string): string {
  const repo = join(stage.root, nameWithOwner.replace("/", "__"));
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return repo;
}

function stubEnv(
  stage: Stage,
  repo: string,
  nameWithOwner: string,
  issues: unknown[],
  sleepSeconds = 0,
): Record<string, string> {
  return {
    ...process.env,
    HOME: stage.home,
    PATH: `${stage.bin}:${process.env.PATH ?? ""}`,
    CLAUDE_PROJECT_DIR: repo,
    STOP_GATE_LOG_DIR: stage.logDir,
    AGENT_SKILLS_GH: join(stage.bin, "gh"),
    GH_TOKEN: "stub-token",
    STUB_GH_REPO: nameWithOwner,
    STUB_GH_ISSUES: JSON.stringify(issues),
    STUB_GH_LOGIN: SNAPSHOT_LOGIN,
    STUB_GH_SLEEP: String(sleepSeconds),
  } as Record<string, string>;
}

function endSession(
  stage: Stage,
  repo: string,
  nameWithOwner: string,
  issues: unknown[],
  options: EndOptions = {},
): number {
  const started = Date.now();
  spawnSync("python3", [hookPath], {
    cwd: repo,
    stdio: ["pipe", "ignore", "ignore"],
    input: JSON.stringify({
      session_id: options.sessionId ?? "se-484",
      transcript_path: join(repo, "transcript.jsonl"),
      cwd: repo,
      hook_event_name: "SessionEnd",
      reason: "clear",
    }),
    env: stubEnv(stage, repo, nameWithOwner, issues, options.sleepSeconds ?? 0),
  });
  return Date.now() - started;
}

function runBrief(
  stage: Stage,
  repo: string,
  nameWithOwner: string,
  issues: unknown[],
  sessionId: string,
) {
  return spawnSync("python3", [briefHookPath], {
    cwd: repo,
    encoding: "utf8",
    input: JSON.stringify({
      session_id: sessionId,
      transcript_path: join(repo, "transcript.jsonl"),
      cwd: repo,
      hook_event_name: "SessionStart",
      source: "startup",
    }),
    env: stubEnv(stage, repo, nameWithOwner, issues),
  });
}

function jsonFilesUnder(root: string): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...jsonFilesUnder(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

function snapshotFiles(stage: Stage): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const root of [stage.logDir, join(stage.home, ".claude")]) {
    for (const file of jsonFilesUnder(root)) {
      if (seen.has(file)) continue;
      seen.add(file);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      if (
        data !== null &&
        typeof data === "object" &&
        Array.isArray((data as { tickets?: unknown }).tickets)
      ) {
        found.push({ path: file, text });
      }
    }
  }
  return found;
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = probe();
    if (found !== undefined) return found;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function landedSnapshots(stage: Stage, atLeast: number, timeoutMs: number, what: string) {
  return waitFor(
    () => {
      const found = snapshotFiles(stage);
      return found.length >= atLeast ? found : undefined;
    },
    timeoutMs,
    what,
  );
}

function briefLinesOf(run: { stdout: string | null }): string[] {
  const raw = run.stdout ?? "";
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  let text = raw;
  try {
    const parsed = JSON.parse(trimmed) as {
      hookSpecificOutput?: { additionalContext?: unknown };
    };
    const context = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof context === "string") text = context;
  } catch {
    text = raw;
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

test(
  "#484.2: two session ends in two different repositories leave two snapshot files, and each repository's brief reads only its own",
  async () => {
    const stage = makeStage();
    const alpha = makeRepo(stage, "acme/alpha");
    const beta = makeRepo(stage, "acme/beta");

    endSession(stage, alpha, "acme/alpha", [ALPHA_TICKET], { sessionId: "se-484-alpha" });
    endSession(stage, beta, "acme/beta", [BETA_TICKET], { sessionId: "se-484-beta" });

    const files = await landedSnapshots(stage, 2, 20_000, "two session-end snapshot files");

    expect(new Set(files.map((file) => file.path)).size).toBe(2);
    expect(files.filter((file) => file.text.includes("8401"))).toHaveLength(1);
    expect(files.filter((file) => file.text.includes("8402"))).toHaveLength(1);

    const alphaBrief = runBrief(
      stage,
      alpha,
      "acme/alpha",
      [ALPHA_TICKET_RELABELLED],
      "se-484-alpha-next",
    );
    expect(alphaBrief.status).toBe(0);
    const alphaLines = briefLinesOf(alphaBrief);
    expect(alphaLines.filter((line) => line.includes("#8401") && /claimed/i.test(line))).toHaveLength(
      1,
    );
    expect(alphaLines.filter((line) => line.includes("#8402"))).toHaveLength(0);

    const betaBrief = runBrief(stage, beta, "acme/beta", [BETA_TICKET], "se-484-beta-next");
    expect(betaBrief.status).toBe(0);
    const betaLines = briefLinesOf(betaBrief);
    expect(betaLines.filter((line) => line.includes("#8402") && /claimed/i.test(line))).toHaveLength(
      1,
    );
    expect(betaLines.filter((line) => line.includes("#8401"))).toHaveLength(0);
  },
  60_000,
);

test(
  "#484.3: session-end.py exits within 1 s when every gh call sleeps 5 s, and the snapshot still appears once the calls return",
  async () => {
    const stage = makeStage();
    const repo = makeRepo(stage, "acme/slow");

    const elapsed = endSession(stage, repo, "acme/slow", [SLOW_TICKET], {
      sessionId: "se-484-slow",
      sleepSeconds: 5,
    });
    expect(elapsed).toBeLessThan(1000);

    const files = await landedSnapshots(stage, 1, 90_000, "the snapshot the slow gh calls write");
    expect(files.filter((file) => file.text.includes("8403"))).toHaveLength(1);
  },
  150_000,
);

test("#484.4: session-end.py no longer writes under .claude/state/", async () => {
  const stage = makeStage();
  const repo = makeRepo(stage, "acme/tidy");

  endSession(stage, repo, "acme/tidy", [TIDY_TICKET], { sessionId: "se-484-tidy" });
  await landedSnapshots(stage, 1, 20_000, "the session-end snapshot");

  expect(existsSync(join(repo, ".claude", "state"))).toBe(false);
  expect(existsSync(join(stage.home, ".claude", "state"))).toBe(false);
}, 60_000);
