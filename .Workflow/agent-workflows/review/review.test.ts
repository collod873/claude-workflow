import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { keepSurvivingFindings } from "./review";
import type { Finding } from "./structural-refusal";

/**
 * Two things this ticket adds: the filter that stands between the reviewer's raw findings and
 * anything downstream, and the workflow trigger that fires the reviewer at all. Each gets its own
 * `describe` because they are independent claims — a broken trigger with a correct filter still
 * ships a lane that never runs, and a correct trigger with a broken filter still floods the owner.
 */

const DIFF = `diff --git a/src/widget.ts b/src/widget.ts
@@ -10,3 +10,4 @@ src/widget.ts:12
+export function widget() {
+  return undefined;
+}
`;

describe("keepSurvivingFindings", () => {
  it("drops a finding that fails either of ADR-0036's structural-refusal conditions", () => {
    const noLocation: Finding = { message: "This function is confusing." };
    const restatesGreen: Finding = {
      message: "src/widget.ts:12 violates no-unused-vars, which eslint already flags",
    };

    expect(keepSurvivingFindings([noLocation, restatesGreen], DIFF, ["no-unused-vars"])).toEqual([]);
  });

  it("keeps a finding that fails neither condition", () => {
    const survivor: Finding = {
      message: "src/widget.ts:12 returns undefined on the empty-cart path",
    };

    expect(keepSurvivingFindings([survivor], DIFF, ["no-unused-vars"])).toEqual([survivor]);
  });

  it("keeps only the survivors out of a mixed batch, in order", () => {
    const survivor: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };
    const refusedNoLocation: Finding = { message: "This is confusing." };
    const anotherSurvivor: Finding = { message: "src/widget.ts:12 also never checks for null" };

    expect(
      keepSurvivingFindings([refusedNoLocation, survivor, anotherSurvivor], DIFF, []),
    ).toEqual([survivor, anotherSurvivor]);
  });
});

const REVIEW_YML_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.github/workflows/review.yml",
);

describe("review.yml's trigger", () => {
  const workflow = parse(readFileSync(REVIEW_YML_PATH, "utf8")) as {
    on: { workflow_run?: { workflows: string[]; types: string[] }; pull_request?: unknown };
    jobs: { review: { if?: string } };
  };

  it("fires on a completed workflow_run of Verify", () => {
    expect(workflow.on.workflow_run).toBeDefined();
    expect(workflow.on.workflow_run?.workflows).toEqual(["Verify"]);
    expect(workflow.on.workflow_run?.types).toEqual(["completed"]);
  });

  it("carries no pull_request trigger", () => {
    expect(workflow.on.pull_request).toBeUndefined();
  });

  it("only reviews a successful conclusion", () => {
    expect(workflow.jobs.review.if).toBe("github.event.workflow_run.conclusion == 'success'");
  });
});
