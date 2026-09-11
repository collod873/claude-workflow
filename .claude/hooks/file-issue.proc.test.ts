import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const HOOKS = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_DIR = path.resolve(HOOKS, "..");
const REPO = existsSync(path.join(CLAUDE_DIR, "bin"))
  ? CLAUDE_DIR
  : path.resolve(CLAUDE_DIR, "..");

function ticketBody(claim: string): string {
  return `## Acceptance criteria\n\n- [ ] it works - check: \`true\`\n\n## Files claimed\n\n- ${claim}\n`;
}

function specBody(): string {
  return (
    "## Problem Statement\n\nA spec whose children are sliced by hand.\n\n" +
    "## Acceptance criteria\n\n- [ ] the spec keeps its label - check: `true`\n"
  );
}

function labelsFrom(argvLog: string): string[] {
  const calls = readFileSync(argvLog, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => (JSON.parse(line) as { argv: string[] }).argv);

  const labels = new Set<string>();
  for (const argv of calls) {
    argv.forEach((token, index) => {
      if (token !== "--label" && token !== "--add-label") return;
      for (const name of (argv[index + 1] ?? "").split(",")) {
        if (name.trim()) labels.add(name.trim());
      }
    });
  }
  return [...labels];
}

function runFileIssue(args: string[], argvLog: string): string {
  return execFileSync("python3", [path.join(REPO, "bin", "file-issue"), ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_SKILLS_GH: path.join(HOOKS, "stub_gh.py"),
      STUB_ARGV_LOG: argvLog,
      STUB_JSON: "https://github.com/acme/widgets/issues/1",
    },
  });
}

function labelsAppliedWhenFiling(claim: string, extraArgs: string[]): string[] {
  const tmp = mkdtempSync(path.join(tmpdir(), "file-issue-venue-"));
  const bodyPath = path.join(tmp, "body.md");
  writeFileSync(bodyPath, ticketBody(claim));
  const argvLog = path.join(tmp, "argv.jsonl");

  runFileIssue(
    ["ticket", "--title", "A ticket", "--body-file", bodyPath, ...extraArgs],
    argvLog,
  );

  return labelsFrom(argvLog);
}

function labelsAppliedFilingSpec(extraArgs: string[]): string[] {
  const tmp = mkdtempSync(path.join(tmpdir(), "file-issue-spec-"));
  const bodyPath = path.join(tmp, "spec.md");
  writeFileSync(bodyPath, specBody());
  const argvLog = path.join(tmp, "argv.jsonl");

  runFileIssue(
    ["spec", "--title", "The merge journey", "--body-file", bodyPath, ...extraArgs],
    argvLog,
  );

  return labelsFrom(argvLog);
}

test(
  "#438.1: `file-issue ticket` adds `by-hand` alongside `ticket` when the claim is workstation or cross-repo, else no such label",
  () => {
    const workstation = labelsAppliedWhenFiling("~/.claude/settings.json", []);
    expect(workstation).toContain("ticket");
    expect(workstation).toContain("by-hand");

    const crossRepo = labelsAppliedWhenFiling("bin/file-issue", ["-R", "acme/widgets"]);
    expect(crossRepo).toContain("ticket");
    expect(crossRepo).toContain("by-hand");

    const ordinary = labelsAppliedWhenFiling("bin/file-issue", []);
    expect(ordinary).toContain("ticket");
    expect(ordinary).not.toContain("by-hand");
  },
);

test.fails(
  "#479.2: `file-issue spec --by-hand` creates the issue carrying both `prd` and `by-hand`, and without the flag `prd` alone",
  () => {
    const byHand = labelsAppliedFilingSpec(["--by-hand"]);
    expect(byHand).toContain("prd");
    expect(byHand).toContain("by-hand");

    const ordinary = labelsAppliedFilingSpec([]);
    expect(ordinary).toContain("prd");
    expect(ordinary).not.toContain("by-hand");
  },
);

test.fails("#479.3: the spec subcommand's help names the --by-hand flag", () => {
  const help = execFileSync(
    "python3",
    [path.join(REPO, "bin", "file-issue"), "spec", "--help"],
    {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, AGENT_SKILLS_GH: path.join(HOOKS, "stub_gh.py") },
    },
  );

  expect(help).toContain("--by-hand");
});
