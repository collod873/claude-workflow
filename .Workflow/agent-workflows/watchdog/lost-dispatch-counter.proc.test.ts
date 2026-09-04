import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("countLostDispatch refuses to run without a slicing workflow named", () => {
  it("the entrypoint throws when SLICING_WORKFLOW is unset, since a default here would silently misread every PRD", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const script = join(here, "lost-dispatch-counter.ts");
    const result = spawnSync("npx", ["tsx", script], {
      encoding: "utf8",
      env: { ...process.env, PRD_NUMBER: "200", SLICING_WORKFLOW: "" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SLICING_WORKFLOW");
  });
});
