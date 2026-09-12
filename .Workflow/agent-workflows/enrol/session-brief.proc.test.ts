import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BY_HAND_LABEL, labelsOf, NEEDS_HUMAN_LABEL } from "../shared/labels";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const HOOK = join(REPO_ROOT, ".claude/hooks/session-brief.py");

const STUB_GH = `#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
joined = " ".join(args)


def flag(name):
    for i, a in enumerate(args):
        if a == name and i + 1 < len(args):
            return args[i + 1]
    return None


issues = json.loads(os.environ.get("STUB_GH_ISSUES") or "[]")

if args[:2] == ["repo", "view"]:
    print(json.dumps({"nameWithOwner": "stub/repo"}))
elif "/comments" in joined:
    number = joined.split("/issues/")[1].split("/")[0]
    table = json.loads(os.environ.get("STUB_GH_COMMENTS") or "{}")
    print(json.dumps(table.get(number, [])))
elif args[:1] == ["api"]:
    print("[]")
else:
    label = flag("--label")
    selected = [i for i in issues if not label or label in [l["name"] for l in i.get("labels", [])]]
    print(json.dumps(selected))
`;

interface StubIssue {
  number: number;
  title: string;
  state: string;
  labels: { name: string }[];
  assignees: { login: string }[];
  body: string;
}

function issue(number: number, label: string): StubIssue {
  return {
    number,
    title: `held by ${label}`,
    state: "open",
    labels: [{ name: label }, { name: "ticket" }],
    assignees: [],
    body: `## What to build\n\nSomething.\n\nStopped because of ${label}.\n`,
  };
}

function fire(issues: StubIssue[], comments: Record<string, unknown[]> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "sb-red-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  for (const dir of [home, repo, bin]) mkdirSync(dir);
  writeFileSync(join(bin, "gh"), STUB_GH);
  chmodSync(join(bin, "gh"), 0o755);
  execFileSync("git", ["init", "-q"], { cwd: repo, stdio: ["ignore", "ignore", "ignore"] });

  const run = spawnSync("python3", [HOOK], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input: JSON.stringify({ session_id: "sb-red-1", cwd: repo, hook_event_name: "SessionStart", source: "startup" }),
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      CLAUDE_PROJECT_DIR: repo,
      STUB_GH_ISSUES: JSON.stringify(issues),
      STUB_GH_COMMENTS: JSON.stringify(comments),
    },
  });
  expect(run.status).toBe(0);
  const trimmed = run.stdout.trim();
  if (trimmed === "") return "";
  return String((JSON.parse(trimmed) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "");
}

const listed = labelsOf("owner").filter((label) => label !== BY_HAND_LABEL);

describe("the session brief names every issue the owner holds, by its label (#521)", () => {
  it("lists one line per open issue wearing a red-family label, naming the label", () => {
    const issues = listed.map((label, index) => issue(900 + index, label));

    const brief = fire(issues);

    for (const [index, label] of listed.entries()) {
      const line = brief.split("\n").find((each) => each.includes(`#${900 + index}`));
      expect(line, `no line for ${label}`).toBeDefined();
      if (label === NEEDS_HUMAN_LABEL) expect(line).toContain("needs a human");
      else expect(line).toContain(label);
      expect(line).toContain(`Stopped because of ${label}`);
    }
  });

  it("puts the latest comment's first line after the label, the way needs-human always has", () => {
    const brief = fire([issue(950, "2-questions-open")], { "950": [{ body: "Answer question 3 and it slices.\nMore." }] });

    const line = brief.split("\n").find((each) => each.includes("#950")) ?? "";
    expect(line).toContain("2-questions-open");
    expect(line).toContain("Answer question 3 and it slices.");
    expect(line).not.toContain("More.");
  });

  it("leaves by-hand to its own next-ticket line rather than listing every one", () => {
    const brief = fire([issue(960, BY_HAND_LABEL), issue(961, BY_HAND_LABEL)]);

    expect(brief).toContain("Next by-hand ticket: #960");
    expect(brief).not.toContain("#961");
    expect(brief).not.toContain("Waiting on you:");
  });

  it("prints no waiting section when nothing is red", () => {
    const brief = fire([{ ...issue(970, "5-building"), labels: [{ name: "5-building" }] }]);

    expect(brief).not.toContain("Waiting on you:");
  });
});
