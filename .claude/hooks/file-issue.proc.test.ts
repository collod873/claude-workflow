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

function labelsAppliedWhenFiling(claim: string, extraArgs: string[]): string[] {
  const tmp = mkdtempSync(path.join(tmpdir(), "file-issue-venue-"));
  const bodyPath = path.join(tmp, "body.md");
  writeFileSync(bodyPath, ticketBody(claim));
  const argvLog = path.join(tmp, "argv.jsonl");

  execFileSync(
    "python3",
    [
      path.join(REPO, "bin", "file-issue"),
      "ticket",
      "--title",
      "A ticket",
      "--body-file",
      bodyPath,
      ...extraArgs,
    ],
    {
      cwd: REPO,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_SKILLS_GH: path.join(HOOKS, "stub_gh.py"),
        STUB_ARGV_LOG: argvLog,
        STUB_JSON: "https://github.com/acme/widgets/issues/1",
      },
    },
  );

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

test.fails(
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
