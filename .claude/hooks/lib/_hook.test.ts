import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { REPO_ROOT } from "../../../.Workflow/agent-workflows/shared/repo-sources";
import { runRowThroughSeededLib } from "./_hook.fixture";

test("#374.1: .claude/hooks/lib/_hook.mjs and _hook.sh exist", () => {
  for (const relative of [".claude/hooks/lib/_hook.mjs", ".claude/hooks/lib/_hook.sh"]) {
    expect(existsSync(join(REPO_ROOT, relative)), `${relative} is missing`).toBe(true);
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
