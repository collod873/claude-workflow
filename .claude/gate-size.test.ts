import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_FILES } from "../.Workflow/agent-workflows/shared/gate-files";

/**
 * The fence (#360): the gate is a constant lanes may shrink and never grow. Its size is the sum of
 * the line counts of the files on `GATE_FILES`, measured after the cleanup that landed this test
 * and recorded below. A change that pushes the total past it fails here; a change that brings it
 * down may lower the number in the same commit. This is the one test that reads gate files as
 * text (`eslint.config.js` exempts it by name), and it reads only their length.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** The post-cleanup total, measured the day #360 landed. Lower it freely; raising it takes an ADR. */
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
