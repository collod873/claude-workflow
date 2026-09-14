import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const binDir = join(repoRoot, "bin");

const VALIDATE_PROBE = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "import ticket_shape",
  "body = sys.argv[2]",
  "try:",
  "    ticket_shape.validate('ticket', body)",
  "    print(json.dumps({'raised': False, 'message': None}))",
  "except ticket_shape.ValidationError as e:",
  "    print(json.dumps({'raised': True, 'message': str(e)}))",
].join("\n");

function runValidateProbe(body: string): { raised: boolean; message: string | null } {
  const out = execFileSync(
    "python3",
    ["-c", VALIDATE_PROBE, binDir, body],
    { cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  return JSON.parse(out) as { raised: boolean; message: string | null };
}

const ASTERISK_BODY = [
  "## Acceptance criteria",
  "",
  "- [ ] the suite passes - check: `true`",
  "",
  "## Files claimed",
  "",
  "- src/*.ts",
  "",
].join("\n");

const QUESTION_BODY = [
  "## Acceptance criteria",
  "",
  "- [ ] the suite passes - check: `true`",
  "",
  "## Files claimed",
  "",
  "- src/router?.ts",
  "",
].join("\n");

const LANE_PREFIX = ".Workflow/agent-workflows/";
const ISSUE_538_GLOB_CLAIMS = [
  "dispatch/*.ts",
  "spec/**/*.ts",
  "shape/*.ts",
  "watchdog/*.ts",
  "integrate/*.ts",
  "acceptance/*.ts",
  "review/*.ts",
  "to-tickets/*.ts",
].map((pattern) => `${LANE_PREFIX}${pattern}`);

const ISSUE_538_BODY = [
  "## Acceptance criteria",
  "",
  "- [ ] the deadlock clears - check: `true`",
  "",
  "## Files claimed",
  "",
  ...ISSUE_538_GLOB_CLAIMS.map((path) => `- ${path}`),
  "",
].join("\n");

test(
  "#579.1: validate refuses a Files claimed entry containing * or ?, naming the entry and saying a claim is one file",
  () => {
    const asterisk = runValidateProbe(ASTERISK_BODY);
    expect(asterisk.raised).toBe(true);
    const asteriskMessage = asterisk.message ?? "";
    expect(asteriskMessage).toContain("src/*.ts");
    expect(asteriskMessage.toLowerCase()).toContain("one file");

    const question = runValidateProbe(QUESTION_BODY);
    expect(question.raised).toBe(true);
    const questionMessage = question.message ?? "";
    expect(questionMessage).toContain("src/router?.ts");
    expect(questionMessage.toLowerCase()).toContain("one file");
  },
);

test(
  "#579.3: #538's own claim list is refused by the validator, since it is the body that produced the deadlock",
  () => {
    const result = runValidateProbe(ISSUE_538_BODY);
    expect(result.raised).toBe(true);
  },
);
