import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { GH_REPO_SLUG, ghStubHarness, namesRepo, type GhCall } from "./gh-stub-harness";

const TICKET_BODY =
  "## Acceptance criteria\n\n" +
  "- [ ] `bin/gh_support.py` binds the repository once - check: `python3 .claude/hooks/test_file_issue.py`\n\n" +
  "## Files claimed\n\n- bin/gh_support.py\n";

const QUESTION_BODY = "## Question\n\nShould the repository bind through the environment?\n";

const SPEC_BODY =
  "## Problem Statement\n\n`gh api` has no -R.\n\n" +
  "## Acceptance criteria\n\n" +
  "- [ ] the file-issue suite passes - check: `python3 .claude/hooks/test_file_issue.py`\n";

function fileIssue(args: string[], opts: { body?: string; issues?: unknown; url?: string } = {}) {
  const harness = ghStubHarness();
  const argv = [join(harness.binDir, "file-issue"), ...args];
  if (opts.body !== undefined) {
    const bodyPath = join(harness.dir, "body.md");
    writeFileSync(bodyPath, opts.body);
    argv.push("--body-file", bodyPath);
  }
  const run = spawnSync("python3", argv, {
    cwd: harness.work,
    env: harness.env({
      STUB_ISSUES: JSON.stringify(opts.issues ?? []),
      STUB_URL: opts.url ?? "https://github.com/acme/widgets/issues/9",
    }),
    encoding: "utf8",
  });
  const calls: GhCall[] = harness.calls();
  return { run, calls };
}

test.fails(
  "#418.1: file-issue ticketify <n> -R owner/repo completes: no gh api argv carries -R, and the repository still reaches every gh call",
  () => {
    const issues = [
      {
        number: 20,
        id: 2020,
        body: "Some fuzzy description.\n",
        labels: [{ name: "fuzzy" }],
        assignees: [],
      },
      {
        number: 15,
        id: 1515,
        body: "## Files claimed\n\n- bin/gh_support.py\n",
        labels: [],
        assignees: [],
      },
    ];

    const { run, calls } = fileIssue(["ticketify", "20", "-R", GH_REPO_SLUG], {
      body: TICKET_BODY,
      issues,
    });

    expect(String(run.stderr)).not.toContain("unknown shorthand flag");
    expect(run.status, String(run.stderr)).toBe(0);

    const apiCalls = calls.filter((call) => call.argv[0] === "api");
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const call of apiCalls) {
      expect(call.argv).not.toContain("-R");
      expect(call.argv).not.toContain("--repo");
    }

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(namesRepo(call), JSON.stringify(call.argv)).toBe(true);
    }
  },
);

test.fails(
  "#418.2: note, question, spec and ticket under -R still name the repository on every gh call",
  () => {
    const kinds: Array<{ args: string[]; body?: string }> = [
      { args: ["note", "--title", "A note"] },
      { args: ["question", "--title", "A question"], body: QUESTION_BODY },
      { args: ["spec", "--title", "Widgets"], body: SPEC_BODY },
      { args: ["ticket", "--title", "A ticket"], body: TICKET_BODY },
    ];

    for (const kind of kinds) {
      const { run, calls } = fileIssue([...kind.args, "-R", GH_REPO_SLUG], { body: kind.body });
      expect(calls.length, `${kind.args[0]}: ${String(run.stderr)}`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.env.GH_REPO, `${kind.args[0]}: ${JSON.stringify(call.argv)}`).toBe(
          GH_REPO_SLUG,
        );
      }
    }
  },
);
