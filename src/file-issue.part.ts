import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, LANDED_PR, execute, git, scratch, script, wellFormedNote } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export const wellFormedTicket = [
  "## Why",
  "",
  'The owner, in session: "a ticket is the only way in, so its shape is where intent survives".',
  "",
  "## Done when",
  "",
  "- Filing a misshapen body files nothing and names each defect.",
  "",
].join("\n");

export const misshapenSpec = "## Nothing to slice\n";

export const wellFormedBug = [
  "## Why",
  "",
  "The Signals of session 7a2c read:",
  "",
  '> hookkit: check-gate crashed 3 times: "TypeError: Cannot read properties of undefined (reading \'steps\')"',
  "",
  "## Done when",
  "",
  "- check-gate reads a contract with no steps and says so instead of crashing.",
  "",
].join("\n");

export function filing({
  gh,
  body,
  title = "A ticket the machine can build",
  sessionId,
  origin,
  ghRepo,
}: {
  gh: string;
  body: string;
  title?: string;
  sessionId?: string;
  origin?: string;
  ghRepo?: string;
}) {
  const root = scratch("file-issue-");
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "--quiet", "--initial-branch=main");
  if (origin !== undefined) git(repo, "remote", "add", "origin", origin);
  writeFileSync(join(repo, "body.md"), body);
  script(join(root, "bin", "gh"), gh);
  return {
    repo,
    run: (args = ["build", "--title", title, "--body-file", "body.md"]) =>
      execute(join(BIN, "file-issue"), repo, { PATH: `${join(root, "bin")}:${process.env.PATH}`, ...(sessionId === undefined ? {} : { CLAUDE_CODE_SESSION_ID: sessionId }), GH_REPO: ghRepo ?? "" }, args),
  };
}

const FILED = `printf '%s\\n' ${LANDED_PR}\n`;
const NOTE_CALL = ["idea", "--title", "What the audit found", "--body-file", "body.md"];

declarePart({
  part: {
    name: "bin/file-issue",
    file: "bin/file-issue",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 6,
    printsData: true,
  },
  scenarios: [
    { label: "filing a ticket", run: () => filing({ gh: FILED, body: wellFormedTicket }).run() },
    { label: "refusing a body with one defect", run: () => filing({ gh: FILED, body: wellFormedTicket.replace("## Why", "## Background") }).run() },
    { label: "refusing a body defective more ways than it shows", run: () => filing({ gh: FILED, body: misshapenSpec }).run(["spec", "--title", "A spec", "--body-file", "body.md"]) },
    { label: "refusing a call it does not file", run: () => filing({ gh: FILED, body: wellFormedTicket }).run(["judgement", "--title", "A judgement"]) },
    { label: "filing a note", run: () => filing({ gh: FILED, body: wellFormedNote }).run(NOTE_CALL) },
    { label: "refusing a note that says no why", run: () => filing({ gh: FILED, body: "Four proposals, with no heading over them.\n" }).run(NOTE_CALL) },
    { label: "showing its help", run: () => filing({ gh: FILED, body: wellFormedTicket }).run(["--help"]) },
  ],
});
