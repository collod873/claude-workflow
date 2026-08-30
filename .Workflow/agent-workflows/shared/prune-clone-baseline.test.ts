import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_ARTIFACTS } from "../implement/regenerate-artifacts.ts";
import { BASELINE_RELATIVE_PATH } from "./clone-gate.ts";
import { CLONE_BASELINE_PATH, diffCloneBaseline } from "./prune-clone-baseline.ts";

describe("the clone-gate baseline as a regenerate && diff artifact", () => {
  it("is the one file bin/clone-gate reads, so pruning and judging cannot name two different baselines", () => {
    expect(CLONE_BASELINE_PATH).toBe(BASELINE_RELATIVE_PATH);
    const entry = GENERATED_ARTIFACTS.find((artifact) => artifact.generator.endsWith("prune-clone-baseline.ts"));
    expect(entry?.path).toBe(BASELINE_RELATIVE_PATH);
  });

  it("refuses to judge any other path, because a diff against a file the gate never reads is a green that proves nothing", () => {
    expect(diffCloneBaseline("/repo", "somewhere/else.json")).toBe(2);
  });

  /**
   * The generator must never be able to *add* to the baseline: that is the whole reason it is safe
   * for lane 05 to run it without asking (`regenerate-artifacts.ts`), and the reason the wiring
   * baseline is not on the same list. The seed flag is the only way in, so its absence here is the
   * property.
   */
  it("prunes and never seeds", () => {
    const source = readFileSync(fileURLToPath(new URL("./prune-clone-baseline.ts", import.meta.url)), "utf8");
    expect(source).toContain("--prune-baseline");
    expect(source).not.toContain("--seed-baseline");
  });
});
