import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAGES } from "./to-tickets";

const WORKFLOW_PATH = ".github/workflows/to-tickets.yml";

/**
 * A stage is registered in two files in two languages: the `STAGES` record's
 * keys here in TypeScript, and one `--stage <name>` step in the workflow
 * YAML. No compiler sees across that boundary, and the failure it hides is
 * silent — a stage declared but never invoked runs nowhere and reports
 * nothing. `tsc` covers the other half (a `STAGES` entry with no matching
 * `run` implementation fails to typecheck); this covers the half it cannot
 * see. Reads `Object.keys(STAGES)` directly, rather than a separately
 * maintained tuple, so a `STAGES` entry alone is what this test watches.
 */
describe("stage registration", () => {
  it("declares exactly the stages the workflow invokes", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const invoked = [...workflow.matchAll(/--stage\s+([a-z0-9-]+)/g)].map((match) => match[1]);

    expect(new Set(invoked)).toEqual(new Set(Object.keys(STAGES)));
  });
});
