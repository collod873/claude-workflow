import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const HOOKS = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_DIR = path.resolve(HOOKS, "..");
const REPO = existsSync(path.join(CLAUDE_DIR, "bin"))
  ? CLAUDE_DIR
  : path.resolve(CLAUDE_DIR, "..");

function ticketBody(claim: string): string {
  return `## Acceptance criteria\n\n- [ ] it works - check: \`false\`\n\n## Files claimed\n\n- ${claim}\n`;
}

function specBody(): string {
  return (
    "## Problem Statement\n\nA spec whose children are sliced by hand.\n\n" +
    "## Acceptance criteria\n\n- [ ] the spec keeps its label - check: `false`\n"
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

test(
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

test("#479.3: the spec subcommand's help names the --by-hand flag", () => {
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

const FILE_ISSUE = fileURLToPath(new URL("../../bin/file-issue", import.meta.url));

const FAKE_GH = [
  "#!/usr/bin/env python3",
  "import json, os, sys",
  "argv = sys.argv[1:]",
  "with open(os.environ['FAKE_GH_LOG'], 'a') as log:",
  "    log.write(json.dumps(argv) + '\\n')",
  "if argv[:2] == ['api', 'repos/{owner}/{repo}/issues'] or argv[:2] == ['issue', 'list']:",
  "    sys.stdout.write(os.environ['FAKE_GH_ISSUES'])",
  "elif argv[:2] == ['issue', 'create']:",
  "    sys.stdout.write(os.environ['FAKE_GH_ISSUE_URL'])",
  "",
].join("\n");

const CLAIMED = ".Workflow/agent-workflows/shared/labels.ts";

const TICKET_BODY = [
  "## Acceptance criteria",
  "",
  `- [ ] \`${CLAIMED}\` is claimed at filing - check: \`false\``,
  "",
  "## Files claimed",
  "",
  `- ${CLAIMED}`,
  "",
].join("\n");

const OPEN_ISSUES = [
  {
    number: 40,
    id: 4040,
    body: `## Acceptance criteria\n\n- [ ] it lands - check: \`true\`\n\n## Files claimed\n\n- ${CLAIMED}\n`,
    labels: [{ name: "ticket" }],
    assignees: [],
  },
  {
    number: 41,
    id: 4141,
    body: "## Acceptance criteria\n\n- [ ] it lands - check: `true`\n\n## Files claimed\n\n- docs/adr/0007-native-edges.md\n",
    labels: [{ name: "ticket" }],
    assignees: [],
  },
];

const BLOCKED_BY_RE = /\/dependencies\/blocked_by/;

const UNSHAPED = { number: 42, id: 4242, body: "Nothing shaped here yet.\n", labels: [], assignees: [] };

function callsFiling(args: string[]): string[][] {
  const dir = mkdtempSync(join(tmpdir(), "file-issue-overlap-"));
  try {
    const gh = join(dir, "fake-gh.py");
    writeFileSync(gh, FAKE_GH);
    chmodSync(gh, 0o755);

    const log = join(dir, "gh-calls.jsonl");
    const bodyFile = join(dir, "ticket.md");
    writeFileSync(bodyFile, TICKET_BODY);

    const run = spawnSync("python3", [FILE_ISSUE, ...args, "--body-file", bodyFile], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_SKILLS_GH: gh,
        FAKE_GH_LOG: log,
        FAKE_GH_ISSUES: JSON.stringify([...OPEN_ISSUES, UNSHAPED]),
        FAKE_GH_ISSUE_URL: "https://github.com/acme/widgets/issues/100\n",
      },
    });

    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

    return readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as string[]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.each([
  { verb: "ticket", args: ["ticket", "--title", "An overlapping ticket"] },
  { verb: "ticketify", args: ["ticketify", "42"] },
])("#602: `file-issue $verb` files a ticket whose claim overlaps an open issue's without touching a blocked_by path", ({ args }) => {
  const calls = callsFiling(args);

  expect(calls.some((call) => call[0] === "issue" && (call[1] === "create" || call[1] === "edit"))).toBe(true);
  expect(calls.filter((call) => call[0] === "api" && call.some((arg) => BLOCKED_BY_RE.test(arg)))).toEqual([]);
});
