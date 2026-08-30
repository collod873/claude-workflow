import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `shape.ts`'s own copies of `handoffPath`/`preservingRaw`/`rawResponsePath`
 * are gone now that `runStage` (`shared/stage.ts`) does that job for any
 * call site that names its `stage` — asserted against the source text
 * because there is nothing left at runtime that would fail if a copy crept
 * back in (a second implementation with the same shape is not a type error).
 */

const SHAPE_TS = ".Workflow/agent-workflows/shape/shape.ts";
const source = readFileSync(SHAPE_TS, "utf8");

function bodyOf(functionName: string): string {
  const start = source.indexOf(`function ${functionName}(`);
  expect(start, `${functionName} is not defined in ${SHAPE_TS}`).not.toBe(-1);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end);
}

describe("shape.ts's handoff path", () => {
  it("imports handoffPath from the shared module", () => {
    expect(source).toMatch(/import\s*\{\s*handoffPath\s*\}\s*from\s*["']\.\.\/shared\/handoff-path["']/);
  });

  it("keeps no local DEFAULT_HANDOFF_PATH", () => {
    expect(source).not.toContain("DEFAULT_HANDOFF_PATH");
  });

  it("keeps no local preservingRaw", () => {
    expect(source).not.toContain("preservingRaw");
  });

  it("keeps no local rawResponsePath", () => {
    expect(source).not.toContain("rawResponsePath");
  });
});

describe("each stage's runStage call supplies its own stage name", () => {
  it.each([
    ["runSweep", "sweep"],
    ["runShaper", "shaper"],
    ["runRefuter", "refuter"],
  ])("%s passes stage: \"%s\"", (functionName, stage) => {
    expect(bodyOf(functionName)).toMatch(new RegExp(`stage:\\s*["']${stage}["']`));
  });
});
