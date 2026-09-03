import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The one case in the lost-dispatch counter that lives in its entrypoint rather than in
 * `countLostDispatch`: the refusal to run at all without `SLICING_WORKFLOW`. That guard sits in
 * `main()`, which only a real process reaches, so this is the counter's one `.proc` test —
 * everything else is in `lost-dispatch.test.ts` against a `gh` stand-in.
 */
describe("countLostDispatch refuses to run without a slicing workflow named", () => {
  it("the entrypoint throws when SLICING_WORKFLOW is unset — a default here would silently misread every PRD", () => {
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
