import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";
import { REPO_ROOT } from "../shared/repo-sources";

function trackerFakeMentions(relativePath: string): string {
  const run = spawnSync("grep", ["-c", "tracker.fake", join(REPO_ROOT, relativePath)], { encoding: "utf8" });
  return run.stdout.trim();
}

test("#619.1: shape.test.ts no longer imports tracker.fake", () => {
  expect(trackerFakeMentions(".Workflow/agent-workflows/shape/shape.test.ts")).toBe("0");
});
