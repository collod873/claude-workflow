import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { REPO_ROOT } from "../../../.Workflow/agent-workflows/shared/repo-sources";
import { AGENT_SKILLS_PIN, VENDORED_COPIES } from "../../../.Workflow/agent-workflows/shared/vendored.fixture";
import { runRowThroughSeededLib } from "./_hook.fixture";

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

test("#379.2: a PreToolUse payload carrying tool_use_id yields a row with that key, and a Stop payload without one yields a row with no such key", () => {
  const preToolUse = runRowThroughSeededLib(
    { hook_event_name: "PreToolUse", session_id: "pre", cwd: REPO_ROOT, tool_use_id: "toolu_01Pre" },
    "allow",
  );
  expect(preToolUse).toMatchObject({ event: "PreToolUse", session_id: "pre", tool_use_id: "toolu_01Pre" });

  const stop = runRowThroughSeededLib({ hook_event_name: "Stop", session_id: "stop", cwd: REPO_ROOT }, "allow");
  expect(stop).toMatchObject({ event: "Stop", session_id: "stop" });
  expect(stop).not.toHaveProperty("tool_use_id");
});
