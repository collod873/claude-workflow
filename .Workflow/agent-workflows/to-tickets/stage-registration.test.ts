import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAGE_NAMES } from "./to-tickets";

const WORKFLOW_PATH = ".github/workflows/to-tickets.yml";

/**
 * A stage is registered in two files in two languages: `STAGE_NAMES` here in
 * TypeScript, and one `--stage <name>` step in the workflow YAML. No compiler
 * sees across that boundary, and the failure it hides is silent — a stage
 * declared but never invoked runs nowhere and reports nothing. `tsc` covers
 * the other half (a name with no `case` in `runNamedStage` is a
 * `noImplicitReturns` error); this covers the half it cannot see.
 */
describe("stage registration", () => {
  it("declares exactly the stages the workflow invokes", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const invoked = [...workflow.matchAll(/--stage\s+([a-z0-9-]+)/g)].map((match) => match[1]);

    expect(new Set(invoked)).toEqual(new Set(STAGE_NAMES));
  });
});
