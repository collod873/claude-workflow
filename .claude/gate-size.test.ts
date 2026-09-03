import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_FILES } from "../.Workflow/agent-workflows/shared/gate-files";

const REPO_ROOT = resolve(import.meta.dirname, "..");

const GATE_LINE_CAP = 1157;

function lineCount(path: string): number {
  return readFileSync(join(REPO_ROOT, path), "utf8").split("\n").length;
}

describe("the gate's size (#360)", () => {
  it("names only files that exist, so a moved gate file cannot slip out of the sum", () => {
    for (const path of GATE_FILES) {
      expect(() => lineCount(path), `${path} is on GATE_FILES but not in the tree`).not.toThrow();
    }
  });

  it("stays at or under the total recorded when the gate was cut to a constant", () => {
    const total = GATE_FILES.reduce((sum, path) => sum + lineCount(path), 0);

    expect(total, `the gate is ${total} lines, past the ${GATE_LINE_CAP} recorded for #360`).toBeLessThanOrEqual(GATE_LINE_CAP);
  });
});
