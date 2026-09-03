import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PR, TRUNK_SHA } from "./integrate-harness.fixture";

/**
 * `integrate.ts`'s entrypoint, driven as the real process `integrate.yml` runs — the one refusal
 * that lives in `main()` rather than in `runIntegrate`, and so cannot be reached through the
 * harness. Nothing here reaches `gh` or `git`: the refusal lands before either is called.
 */
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
