import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { REPO_ROOT } from "../../../.Workflow/agent-workflows/shared/repo-sources";
import { AGENT_SKILLS_PIN, VENDORED_COPIES } from "../../../.Workflow/agent-workflows/shared/vendored.fixture";

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("#374.1: .claude/hooks/lib/_hook.mjs and _hook.sh exist", () => {
  for (const copy of VENDORED_COPIES) {
    expect(existsSync(join(REPO_ROOT, copy.relative)), `${copy.relative} is missing`).toBe(true);
  }
});

test(`#382.1: .claude/hooks/lib/_hook.mjs and _hook.sh are byte-identical to ${AGENT_SKILLS_PIN} hooks/_hook.mjs and hooks/_hook.sh`, () => {
  for (const copy of VENDORED_COPIES) {
    const path = join(REPO_ROOT, copy.relative);
    expect(digest(path), `${copy.relative} is not the byte-identical ${copy.source} of ${AGENT_SKILLS_PIN}`).toBe(copy.sha256);
  }
});
