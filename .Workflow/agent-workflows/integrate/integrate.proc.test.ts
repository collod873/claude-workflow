import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PR, TRUNK_SHA } from "./integrate-harness.fixture";

describe("integrate.ts's entrypoint", () => {
  it("refuses to start without VERIFY_WORKFLOW named — a default here would read every merge as unjudged forever", () => {
    const result = spawnSync("npx", ["tsx", join(import.meta.dirname, "integrate.ts"), PR, TRUNK_SHA], {
      encoding: "utf8",
      env: { ...process.env, VERIFY_WORKFLOW: "" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VERIFY_WORKFLOW");
  });
});
