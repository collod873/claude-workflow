import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const hooksDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(hooksDir, "..", "..");
const fileIssue = join(repoRoot, "bin", "file-issue");
const ghStubPath = join(hooksDir, "stub_gh.py");

const TICKET_CLAIMING_CI = [
  "## Acceptance criteria",
  "",
  "- [ ] the lane runs green - check: `true`",
  "",
  "## Files claimed",
  "",
  "- .github/workflows/ci.yml",
  "",
].join("\n");

test.fails(
  "#425.1: a ticket body claiming .github/workflows/ci.yml is refused by file-issue ticket before gh is called, and the refusal names the path",
  () => {
    const tmp = mkdtempSync(join(tmpdir(), "file-issue-425-"));
    const bodyFile = join(tmp, "ticket-body.md");
    const ghLog = join(tmp, "gh-calls.jsonl");
    writeFileSync(bodyFile, TICKET_CLAIMING_CI);

    const result = spawnSync(
      "python3",
      [fileIssue, "ticket", "--title", "A ticket", "--body-file", bodyFile],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, AGENT_SKILLS_GH: ghStubPath, STUB_ARGV_LOG: ghLog },
      },
    );

    const ghCalls = existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim() : "";

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".github/workflows/ci.yml");
    expect(ghCalls).toBe("");
  },
);
