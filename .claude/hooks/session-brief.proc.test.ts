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
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const hooksDir = fileURLToPath(new URL(".", import.meta.url));
const hookPath = join(hooksDir, "session-brief.py");
const rosterPath = join(hooksDir, "roster.json");
const endHookPath = join(hooksDir, "session-end.py");

const STUB_GH = `#!/usr/bin/env python3
import json
import os
import re
import sys

args = sys.argv[1:]
joined = " ".join(args)


def env_json(name, default):
    try:
        return json.loads(os.environ.get(name, default) or default)
    except json.JSONDecodeError:
        return json.loads(default)


def has(*seq):
    seq = list(seq)
    return any(args[i:i + len(seq)] == seq for i in range(len(args)))


def flag(name):
    for i, a in enumerate(args):
        if a == name and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return None


def issue_number():
    m = re.search(r"/issues/(\\d+)", joined)
    if m:
        return m.group(1)
    for a in args:
        token = a.lstrip("#")
        if token.isdigit():
            return token
    return None


def label_names(issue):
    names = []
    for label in issue.get("labels", []) or []:
        if isinstance(label, dict):
            names.append(label.get("name"))
        else:
            names.append(label)
    return names


def assignee_logins(issue):
    logins = []
    for who in issue.get("assignees", []) or []:
        if isinstance(who, dict):
            logins.append(who.get("login"))
        else:
            logins.append(who)
    return logins


issues = env_json("STUB_GH_ISSUES", "[]")

if has("repo", "view"):
    print(json.dumps({"nameWithOwner": "stub/repo", "name": "repo", "owner": {"login": "stub"}}))
elif "sub_issues" in joined or "sub-issue" in joined or "timeline" in joined:
    print("[]")
elif "blocked_by" in joined or "dependencies" in joined:
    number = issue_number()
    table = env_json("STUB_GH_BLOCKED", "{}")
    print(json.dumps(table.get(number, []) if number else []))
elif "/comments" in joined or has("issue", "comment"):
    number = issue_number()
    table = env_json("STUB_GH_COMMENTS", "{}")
    print(json.dumps(table.get(number, []) if number else []))
elif has("issue", "view"):
    number = issue_number()
    found = [i for i in issues if str(i.get("number")) == str(number)]
    print(json.dumps(found[0] if found else {}))
else:
    selected = issues
    label = flag("--label") or flag("-l")
    if label:
        selected = [i for i in selected if label in label_names(i)]
    state = (flag("--state") or "").lower()
    if state in ("open", "closed"):
        selected = [i for i in selected if i.get("state", "open") == state]
    assignee = flag("--assignee")
    if assignee:
        selected = [i for i in selected if assignee in assignee_logins(i)]
    if "no:assignee" in (flag("--search") or ""):
        selected = [i for i in selected if not assignee_logins(i)]
    print(json.dumps(selected))
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

const REFUSAL_REASON = "the claim names the immutable set";
const REFUSAL_COMMENT = `Refused at the to-build door: ${REFUSAL_REASON}.`;

const NEEDS_HUMAN_ISSUE = {
  number: 604,
  title: "wire the symlinks",
  state: "open",
  url: "https://github.com/stub/repo/issues/604",
  html_url: "https://github.com/stub/repo/issues/604",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "needs-human" }],
  assignees: [{ login: "owner" }],
  body: ["## What to build", "", "Wire the symlinks.", "", REFUSAL_COMMENT, ""].join("\n"),
  comments: [{ author: { login: "workflow-bot" }, body: REFUSAL_COMMENT }],
};

const BLOCKER_ISSUE = {
  number: 613,
  title: "land the run-row reader",
  state: "open",
  url: "https://github.com/stub/repo/issues/613",
  html_url: "https://github.com/stub/repo/issues/613",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [],
  assignees: [],
  body: "## What to build\n\nLand it.\n",
};

const BLOCKED_BY_HAND_ISSUE = {
  number: 611,
  title: "rewire the dotfiles",
  state: "open",
  url: "https://github.com/stub/repo/issues/611",
  html_url: "https://github.com/stub/repo/issues/611",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }, { name: "blocked" }],
  assignees: [],
  body: "## What to build\n\nRewire them.\n\nBlocked by #613\n",
};

const READY_BY_HAND_ISSUE = {
  number: 612,
  title: "move the run rows",
  state: "open",
  url: "https://github.com/stub/repo/issues/612",
  html_url: "https://github.com/stub/repo/issues/612",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [],
  body: "## What to build\n\nMove them.\n",
};

const ASSIGNED_BY_HAND_ISSUE = {
  number: 621,
  title: "relink the settings file",
  state: "open",
  url: "https://github.com/stub/repo/issues/621",
  html_url: "https://github.com/stub/repo/issues/621",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: "someone-else" }],
  body: "## What to build\n\nRelink it.\n",
};

const UNASSIGNED_BY_HAND_ISSUE = {
  number: 622,
  title: "prune the stale worktrees",
  state: "open",
  url: "https://github.com/stub/repo/issues/622",
  html_url: "https://github.com/stub/repo/issues/622",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [],
  body: "## What to build\n\nPrune them.\n",
};

const UNCHANGED_BY_HAND_ISSUE = {
  number: 631,
  title: "keep the run rows where they are",
  state: "open",
  url: "https://github.com/stub/repo/issues/631",
  html_url: "https://github.com/stub/repo/issues/631",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [],
  body: "## What to build\n\nKeep them.\n",
};

const REMOVED_BY_HAND_ISSUE = {
  number: 632,
  title: "retire the pasted closing message",
  state: "open",
  url: "https://github.com/stub/repo/issues/632",
  html_url: "https://github.com/stub/repo/issues/632",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [],
  body: "## What to build\n\nRetire it.\n",
};

const RESTATED_BY_HAND_ISSUE = {
  number: 633,
  title: "relabel the dotfiles ticket",
  state: "open",
  url: "https://github.com/stub/repo/issues/633",
  html_url: "https://github.com/stub/repo/issues/633",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [],
  body: "## What to build\n\nRelabel it.\n",
};

const RESTATED_BY_HAND_ISSUE_NOW_CLAIMED = {
  ...RESTATED_BY_HAND_ISSUE,
  assignees: [{ login: "owner" }],
};

const ADDED_BY_HAND_ISSUE = {
  number: 634,
  title: "sweep the stale worktrees",
  state: "open",
  url: "https://github.com/stub/repo/issues/634",
  html_url: "https://github.com/stub/repo/issues/634",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [],
  body: "## What to build\n\nSweep them.\n",
};

const WORKSTATION_CLAIMED_ISSUE = {
  number: 641,
  title: "relink the run-row reader",
  state: "open",
  url: "https://github.com/stub/repo/issues/641",
  html_url: "https://github.com/stub/repo/issues/641",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: "owner" }],
  body: "## What to build\n\nRelink it.\n",
};

const OTHER_WORKSTATION_CLAIMED_ISSUE = {
  number: 642,
  title: "repoint the chezmoi symlinks",
  state: "open",
  url: "https://github.com/stub/repo/issues/642",
  html_url: "https://github.com/stub/repo/issues/642",
  repository_url: "https://api.github.com/repos/stub/repo",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: "owner" }],
  body: "## What to build\n\nRepoint them.\n",
};

const DELTA_SNAPSHOT = {
  repo: "stub/repo",
  session_id: "sb-previous-session",
  tickets: [
    OPEN_PRD_ISSUE,
    UNCHANGED_BY_HAND_ISSUE,
    REMOVED_BY_HAND_ISSUE,
    RESTATED_BY_HAND_ISSUE,
  ],
  claimed: null,
};

const REMOVED_ONLY_SNAPSHOT = {
  repo: "stub/repo",
  session_id: "sb-previous-session",
  tickets: [OPEN_PRD_ISSUE, UNCHANGED_BY_HAND_ISSUE, REMOVED_BY_HAND_ISSUE],
  claimed: null,
};

const WORKSTATION_CLAIM_SNAPSHOT = {
  repo: "stub/repo",
  session_id: "sb-previous-session",
  tickets: [OPEN_PRD_ISSUE, WORKSTATION_CLAIMED_ISSUE, OTHER_WORKSTATION_CLAIMED_ISSUE],
  claimed: WORKSTATION_CLAIMED_ISSUE,
};

const EVERY_SECTION_ISSUES = [
  OPEN_PRD_ISSUE,
  NEEDS_HUMAN_ISSUE,
  UNASSIGNED_BY_HAND_ISSUE,
  WORKSTATION_CLAIMED_ISSUE,
];

const EVERY_SECTION_SNAPSHOT = {
  repo: "stub/repo",
  session_id: "sb-previous-session",
  tickets: [...EVERY_SECTION_ISSUES, REMOVED_BY_HAND_ISSUE],
  claimed: WORKSTATION_CLAIMED_ISSUE,
};

const OVERFLOWING_NEEDS_HUMAN_ISSUES = Array.from({ length: 40 }, (_, index) => {
  const number = 5001 + index;
  return {
    number,
    title: `stalled at the door ${index + 1}`,
    state: "open",
    url: `https://github.com/stub/repo/issues/${number}`,
    html_url: `https://github.com/stub/repo/issues/${number}`,
    repository_url: "https://api.github.com/repos/stub/repo",
    labels: [{ name: "needs-human" }],
    assignees: [],
    body: `## What to build\n\nDo the thing.\n\n${REFUSAL_COMMENT}\n`,
  };
});

const OVERFLOW_LINE_RE = /^\+(\d+) more$/;

type World = { root: string; home: string; repo: string; bin: string };

type FireOptions = {
  sessionId?: string;
  comments?: Record<string, unknown[]>;
  blocked?: Record<string, unknown[]>;
  env?: Record<string, string>;
};

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

function fire(world: World, issues: unknown[], options: FireOptions = {}) {
  return spawnSync("python3", [hookPath], {
    cwd: world.repo,
    encoding: "utf8",
    input: JSON.stringify({
      session_id: options.sessionId ?? "sb-test-1",
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
      STUB_GH_COMMENTS: JSON.stringify(options.comments ?? {}),
      STUB_GH_BLOCKED: JSON.stringify(options.blocked ?? {}),
      ...(options.env ?? {}),
    },
  });
}

function machineLocalDir(world: World): string {
  const dir = join(world.root, "machine-local");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshotPaths(world: World, stateDir: string): string[] {
  const project = basename(world.repo);
  const dirs = [
    stateDir,
    join(world.home, ".claude", "state"),
    join(world.home, ".claude", "logs"),
    join(world.repo, ".claude", "state"),
    join(world.repo, ".claude", "logs"),
  ];
  const names = [
    "session-snapshot.json",
    `session-snapshot-${project}.json`,
    "session-brief-snapshot.json",
    "session-end-snapshot.json",
    `${project}.json`,
  ];
  return dirs.flatMap((dir) => names.map((name) => join(dir, name)));
}

function fireWithMachineLocalState(
  world: World,
  issues: unknown[],
  snapshot: unknown | null,
  options: FireOptions = {},
) {
  const stateDir = machineLocalDir(world);
  const paths = snapshotPaths(world, stateDir);
  if (snapshot !== null) {
    for (const path of paths) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(snapshot, null, 2));
    }
  }
  return fire(world, issues, {
    ...options,
    env: {
      STOP_GATE_LOG_DIR: stateDir,
      SESSION_BRIEF_SNAPSHOT: paths[0],
      SESSION_SNAPSHOT_FILE: paths[0],
      ...(options.env ?? {}),
    },
  });
}

function briefText(run: { stdout: string | null }): string {
  const raw = run.stdout ?? "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    const parsed = JSON.parse(trimmed) as {
      hookSpecificOutput?: { additionalContext?: unknown };
    };
    const context = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof context === "string") return context;
  } catch {
    return raw;
  }
  return raw;
}

function briefLines(run: { stdout: string | null }): string[] {
  return briefText(run)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function linesBeforeTheFirstCriterion(run: { stdout: string | null }): string[] {
  const lines = briefLines(run);
  const criterionAt = lines.findIndex((line) => line.includes(FIRST_CRITERION));
  const head = criterionAt === -1 ? lines : lines.slice(0, criterionAt);
  return head.filter((line) => !line.endsWith(":"));
}

function naming(lines: string[], ticket: string): string[] {
  return lines.filter((line) => line.includes(ticket));
}

function otherLiveSessionLines(run: { stdout: string | null }): string[] {
  return briefLines(run).filter((line) => /session/i.test(line) && /live|other/i.test(line));
}

function indexOfLineNaming(lines: string[], needle: string): number {
  return lines.findIndex((line) => line.includes(needle));
}

function contentLines(run: { stdout: string | null }): string[] {
  return briefLines(run).filter((line) => !OVERFLOW_LINE_RE.test(line));
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

test(
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

test("#440.2: session-brief.py is registered under SessionStart in the hook roster", () => {
  const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as Record<string, string[]>;
  expect(roster.SessionStart).toContain("session-brief.py");
});

test("#440.3: the hook writes its own run row on every fire", () => {
  const world = makeWorld();

  fire(world, [OPEN_PRD_ISSUE]);
  const afterFirstFire = countRunRows(world.home) + countRunRows(world.repo);
  expect(afterFirstFire).toBeGreaterThanOrEqual(1);

  fire(world, [OPEN_PRD_ISSUE]);
  const afterSecondFire = countRunRows(world.home) + countRunRows(world.repo);
  expect(afterSecondFire).toBeGreaterThan(afterFirstFire);
});

test(
  "#441.1: a stubbed needs-human-labeled issue produces one line naming it and its refusal reason",
  () => {
    const run = fire(makeWorld(), [OPEN_PRD_ISSUE, NEEDS_HUMAN_ISSUE], {
      comments: { "604": NEEDS_HUMAN_ISSUE.comments },
    });
    expect(run.status).toBe(0);

    const naming = briefLines(run).filter((line) => line.includes("#604"));
    expect(naming).toHaveLength(1);
    expect(naming[0]).toMatch(/the claim names the immutable set/i);
  },
);

test(
  "#441.2: a second live session's run row produces an other-live-sessions line, and none appears when this is the only session",
  () => {
    const shared = makeWorld();
    const first = fire(shared, [OPEN_PRD_ISSUE], { sessionId: "sb-alpha-1" });
    expect(first.status).toBe(0);
    const second = fire(shared, [OPEN_PRD_ISSUE], { sessionId: "sb-beta-2" });
    expect(second.status).toBe(0);
    expect(otherLiveSessionLines(second).length).toBeGreaterThanOrEqual(1);

    const alone = fire(makeWorld(), [OPEN_PRD_ISSUE], { sessionId: "sb-beta-2" });
    expect(alone.status).toBe(0);
    expect(briefLines(alone).length).toBeGreaterThan(0);
    expect(otherLiveSessionLines(alone)).toHaveLength(0);
  },
);

test(
  "#441.3: given two open unassigned by-hand issues where one is blocked, the brief names only the unblocked one",
  () => {
    const run = fire(
      makeWorld(),
      [OPEN_PRD_ISSUE, BLOCKED_BY_HAND_ISSUE, READY_BY_HAND_ISSUE, BLOCKER_ISSUE],
      { blocked: { "611": [BLOCKER_ISSUE] } },
    );
    expect(run.status).toBe(0);

    const text = briefText(run);
    expect(text).toContain("#612");
    expect(text).not.toContain("#611");
  },
);

test("#441.4: an assigned by-hand issue is never named in this section", () => {
  const run = fire(makeWorld(), [
    OPEN_PRD_ISSUE,
    ASSIGNED_BY_HAND_ISSUE,
    UNASSIGNED_BY_HAND_ISSUE,
  ]);
  expect(run.status).toBe(0);

  const text = briefText(run);
  expect(text).toContain("#622");
  expect(text).not.toContain("#621");
});

test(
  "#443.1: given a snapshot and a since-changed stubbed tracker, the brief's first lines are the delta, one per added, removed or changed-state ticket",
  () => {
    const run = fireWithMachineLocalState(
      makeWorld(),
      [
        OPEN_PRD_ISSUE,
        UNCHANGED_BY_HAND_ISSUE,
        RESTATED_BY_HAND_ISSUE_NOW_CLAIMED,
        ADDED_BY_HAND_ISSUE,
      ],
      DELTA_SNAPSHOT,
    );
    expect(run.status).toBe(0);
    expect(briefText(run)).toContain(FIRST_CRITERION);

    const delta = linesBeforeTheFirstCriterion(run);
    expect(naming(delta, "#632")).toHaveLength(1);
    expect(naming(delta, "#633")).toHaveLength(1);
    expect(naming(delta, "#634")).toHaveLength(1);
    expect(naming(delta, "#631")).toHaveLength(0);
    expect(naming(delta, "#501")).toHaveLength(0);
  },
);

test("#443.2: with no snapshot file present, no delta line is printed", () => {
  const withSnapshot = fireWithMachineLocalState(
    makeWorld(),
    [OPEN_PRD_ISSUE, UNCHANGED_BY_HAND_ISSUE],
    REMOVED_ONLY_SNAPSHOT,
  );
  expect(withSnapshot.status).toBe(0);
  expect(briefText(withSnapshot)).toContain(FIRST_CRITERION);
  expect(naming(linesBeforeTheFirstCriterion(withSnapshot), "#632")).toHaveLength(1);

  const withoutSnapshot = fireWithMachineLocalState(
    makeWorld(),
    [OPEN_PRD_ISSUE, UNCHANGED_BY_HAND_ISSUE],
    null,
  );
  expect(withoutSnapshot.status).toBe(0);
  expect(briefText(withoutSnapshot)).toContain(FIRST_CRITERION);
  expect(linesBeforeTheFirstCriterion(withoutSnapshot)).toHaveLength(0);
});

test(
  "#443.3: the workstation's own claimed-and-open by-hand ticket is named from its snapshot, and a same-account ticket from another workstation's is not",
  () => {
    const run = fireWithMachineLocalState(
      makeWorld(),
      [OPEN_PRD_ISSUE, WORKSTATION_CLAIMED_ISSUE, OTHER_WORKSTATION_CLAIMED_ISSUE],
      WORKSTATION_CLAIM_SNAPSHOT,
    );
    expect(run.status).toBe(0);

    const text = briefText(run);
    expect(text).toContain(FIRST_CRITERION);
    expect(text).toContain("#641");
    expect(text).not.toContain("#642");
  },
);

test(
  "#444.1: sections print in the fixed order, and a section that would push the brief past line 30 is dropped whole rather than half-printed",
  () => {
    const world = makeWorld();
    const comments = { "604": NEEDS_HUMAN_ISSUE.comments };

    const earlier = fireWithMachineLocalState(
      world,
      EVERY_SECTION_ISSUES,
      EVERY_SECTION_SNAPSHOT,
      { sessionId: "sb-order-alpha", comments },
    );
    expect(earlier.status).toBe(0);

    const run = fireWithMachineLocalState(
      world,
      EVERY_SECTION_ISSUES,
      EVERY_SECTION_SNAPSHOT,
      { sessionId: "sb-order-beta", comments },
    );
    expect(run.status).toBe(0);

    const lines = briefLines(run);
    const delta = indexOfLineNaming(lines, "#632");
    const criterion = indexOfLineNaming(lines, FIRST_CRITERION);
    const needsHuman = indexOfLineNaming(lines, "#604");
    const claimed = indexOfLineNaming(lines, "#641");
    const nextByHand = indexOfLineNaming(lines, "#622");
    const otherSessions = indexOfLineNaming(lines, "sb-order-alpha");

    for (const index of [delta, criterion, needsHuman, claimed, nextByHand, otherSessions]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(delta).toBeLessThan(criterion);
    expect(criterion).toBeLessThan(needsHuman);
    expect(needsHuman).toBeLessThan(claimed);
    expect(claimed).toBeLessThan(nextByHand);
    expect(nextByHand).toBeLessThan(otherSessions);

    const overflowing = fire(
      makeWorld(),
      [OPEN_PRD_ISSUE, UNASSIGNED_BY_HAND_ISSUE, ...OVERFLOWING_NEEDS_HUMAN_ISSUES],
      { comments },
    );
    expect(overflowing.status).toBe(0);

    const printed = contentLines(overflowing);
    expect(printed.length).toBeGreaterThan(0);
    expect(printed.length).toBeLessThanOrEqual(30);

    const text = briefText(overflowing);
    const halfPrinted = OVERFLOWING_NEEDS_HUMAN_ISSUES.filter((issue) =>
      text.includes(`#${issue.number}`),
    );
    expect(halfPrinted).toHaveLength(0);
  },
);

test(
  "#444.2: when lines are dropped the last printed line reads +N more, naming the dropped count",
  () => {
    const run = fire(
      makeWorld(),
      [OPEN_PRD_ISSUE, UNASSIGNED_BY_HAND_ISSUE, ...OVERFLOWING_NEEDS_HUMAN_ISSUES],
      { comments: { "604": NEEDS_HUMAN_ISSUE.comments } },
    );
    expect(run.status).toBe(0);

    const lines = briefLines(run);
    const last = lines[lines.length - 1] ?? "";
    expect(last).toMatch(OVERFLOW_LINE_RE);
    expect(lines.filter((line) => OVERFLOW_LINE_RE.test(line))).toHaveLength(1);

    const dropped = Number(OVERFLOW_LINE_RE.exec(last)?.[1]);
    expect(dropped).toBeGreaterThanOrEqual(OVERFLOWING_NEEDS_HUMAN_ISSUES.length);

    const nothingDropped = fire(makeWorld(), [OPEN_PRD_ISSUE, UNASSIGNED_BY_HAND_ISSUE]);
    expect(nothingDropped.status).toBe(0);
    expect(briefLines(nothingDropped).length).toBeGreaterThan(0);
    expect(briefLines(nothingDropped).filter((line) => OVERFLOW_LINE_RE.test(line))).toHaveLength(
      0,
    );
  },
);

const ROUND_TRIP_LOGIN = "octocat";
const ROUND_TRIP_REPO = "acme/alpha";
const ROUND_TRIP_TICKET_TAG = "#8501";

const ROUND_TRIP_GH = `#!/usr/bin/env python3
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

const ROUND_TRIP_TICKET = {
  number: 8501,
  title: "Rewire the alpha symlinks",
  state: "open",
  labels: [{ name: "by-hand" }],
  assignees: [{ login: ROUND_TRIP_LOGIN }],
  body: "## What to build\n\nRewire them.\n",
};

const ROUND_TRIP_TICKET_RELABELLED = {
  ...ROUND_TRIP_TICKET,
  labels: [{ name: "by-hand" }, { name: "blocked" }],
};

type RoundTripStage = { root: string; home: string; logDir: string; bin: string; repo: string };

function roundTripStage(): RoundTripStage {
  const root = mkdtempSync(join(tmpdir(), "sb484-"));
  const home = join(root, "home");
  const logDir = join(root, "logs");
  const bin = join(root, "bin");
  const repo = join(root, "repo");
  for (const dir of [home, logDir, bin, repo]) {
    mkdirSync(dir, { recursive: true });
  }
  const gh = join(bin, "gh");
  writeFileSync(gh, ROUND_TRIP_GH);
  chmodSync(gh, 0o755);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return { root, home, logDir, bin, repo };
}

function roundTripEnv(stage: RoundTripStage, issues: unknown[]): Record<string, string> {
  return {
    ...process.env,
    HOME: stage.home,
    STOP_GATE_LOG_DIR: stage.logDir,
    CLAUDE_PROJECT_DIR: stage.repo,
    PATH: `${stage.bin}:${process.env.PATH ?? ""}`,
    AGENT_SKILLS_GH: join(stage.bin, "gh"),
    GH_TOKEN: "stub-token",
    STUB_GH_SLEEP: "0",
    STUB_GH_LOGIN: ROUND_TRIP_LOGIN,
    STUB_GH_REPO: ROUND_TRIP_REPO,
    STUB_GH_ISSUES: JSON.stringify(issues),
  } as Record<string, string>;
}

function endRoundTripSession(stage: RoundTripStage, issues: unknown[]): void {
  spawnSync("python3", [endHookPath], {
    cwd: stage.repo,
    stdio: ["pipe", "ignore", "ignore"],
    input: JSON.stringify({
      session_id: "sb-484-end",
      transcript_path: join(stage.root, "transcript.jsonl"),
      cwd: stage.repo,
      hook_event_name: "SessionEnd",
      reason: "clear",
    }),
    env: roundTripEnv(stage, issues),
  });
}

function briefRoundTrip(stage: RoundTripStage, issues: unknown[]) {
  return spawnSync("python3", [hookPath], {
    cwd: stage.repo,
    encoding: "utf8",
    input: JSON.stringify({
      session_id: "sb-484-start",
      transcript_path: join(stage.root, "transcript.jsonl"),
      cwd: stage.repo,
      hook_event_name: "SessionStart",
      source: "startup",
    }),
    env: roundTripEnv(stage, issues),
  });
}

async function briefOnceTheDetachedSnapshotLands(
  stage: RoundTripStage,
  issues: unknown[],
  ticket: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const attempt = briefRoundTrip(stage, issues);
    if (briefLines(attempt).some((line) => line.includes(ticket))) return attempt;
    if (Date.now() >= deadline) return attempt;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.fails(
  "#484.1: running session-end.py then session-brief.py against the same stubbed gh and log dir, after a by-hand ticket changes labels between the two, prints that ticket's delta line and the claimed-ticket line",
  async () => {
    const stage = roundTripStage();
    endRoundTripSession(stage, [ROUND_TRIP_TICKET]);

    const run = await briefOnceTheDetachedSnapshotLands(
      stage,
      [ROUND_TRIP_TICKET_RELABELLED],
      ROUND_TRIP_TICKET_TAG,
      10_000,
    );
    expect(run.status).toBe(0);

    const namingTheTicket = naming(briefLines(run), ROUND_TRIP_TICKET_TAG);
    const claimedLines = namingTheTicket.filter((line) => /claimed/i.test(line));
    const deltaLines = namingTheTicket.filter((line) => !/claimed/i.test(line));

    expect(claimedLines).toHaveLength(1);
    expect(claimedLines[0]).toContain(ROUND_TRIP_TICKET.title);
    expect(deltaLines.length).toBeGreaterThanOrEqual(1);
  },
  40_000,
);
