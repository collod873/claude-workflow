import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

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
  `- [ ] \`${CLAIMED}\` is edged at filing - check: \`true\``,
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

const BLOCKED_BY_RE = /\/issues\/(\d+)\/dependencies\/blocked_by$/;

test("#559.5: `file-issue ticket` wires the same blocked_by edges at filing that ticketify wires, from one loop both kinds reach", () => {
  const dir = mkdtempSync(join(tmpdir(), "file-issue-collision-"));
  try {
    const gh = join(dir, "fake-gh.py");
    writeFileSync(gh, FAKE_GH);
    chmodSync(gh, 0o755);

    const log = join(dir, "gh-calls.jsonl");
    const bodyFile = join(dir, "ticket.md");
    writeFileSync(bodyFile, TICKET_BODY);

    const run = spawnSync(
      "python3",
      [FILE_ISSUE, "ticket", "--title", "A colliding ticket", "--body-file", bodyFile],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_SKILLS_GH: gh,
          FAKE_GH_LOG: log,
          FAKE_GH_ISSUES: JSON.stringify(OPEN_ISSUES),
          FAKE_GH_ISSUE_URL: "https://github.com/acme/widgets/issues/100\n",
        },
      },
    );

    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

    const calls: string[][] = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as string[]);

    const edges = calls.filter((call) => call.some((arg) => BLOCKED_BY_RE.test(arg)));

    expect(edges).toHaveLength(1);
    expect(edges[0].flatMap((arg) => BLOCKED_BY_RE.exec(arg)?.[1] ?? [])).toEqual(["100"]);
    expect(edges[0].join(" ")).toContain("issue_id=4040");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
