import { describe, expect, it } from "vitest";
import {
  closedIssues,
  deliveredChild,
  mergesOnDefaultBranch,
  runSpecPass,
  specIssue,
  type PassResult,
  type Scenario,
} from "./238-reconcile-closer.fixture";

const SPEC = 900;

/** Every body this run wrote to the tracker, however it was handed to `gh`. */
function writtenBodies(result: PassResult): string[] {
  const bodies: string[] = [];
  for (const call of result.calls) {
    call.forEach((arg, index) => {
      if (typeof arg !== "string") return;
      if (arg === "--body" || arg === "-b") {
        const next = call[index + 1];
        if (typeof next === "string") bodies.push(next);
        return;
      }
      const marker = arg.indexOf("body=");
      if (marker !== -1) bodies.push(arg.slice(marker + "body=".length));
    });
  }
  return bodies;
}

describe("#238 — the pass and the closer reading the same check differently", () => {
  /**
   * Acceptance criterion, verbatim:
   *
   * "A pass/closer disagreement rewrites the verdict naming both, leaves the spec open, writes no `needs-human` — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`"
   */
  it("rewrites the verdict naming both runs, leaves the spec open and writes no needs-human when the pass reads the check green and the closer reads it red", () => {
    const [merge] = mergesOnDefaultBranch(1);

    // The spec's own check is `true`, so the pass's evaluation is green; the injected closer reports
    // a red run of the same command. That disagreement is the whole scenario.
    const disagreeing: Scenario = {
      spec: specIssue(SPEC, "true"),
      children: [deliveredChild(801, SPEC, merge, 700)],
      closer: { exitCode: 1, output: "the check came back red" },
    };

    const result = runSpecPass(disagreeing);

    expect(result.closerCalls, "both preconditions held, so the closer was invoked").toHaveLength(1);

    const verdict = writtenBodies(result).find((body) => body.includes("prd-check:v1"));
    expect(verdict, "the pass owns one verdict comment per spec and rewrites it whole").toBeTruthy();
    expect(verdict, "the closer's run is named").toMatch(/clos(er|e-ticket)/i);
    expect(verdict, "the pass's own run exited 0").toMatch(/\b0\b/);
    expect(verdict, "the closer's run exited 1").toMatch(/\b1\b/);

    expect(closedIssues(result), "a disagreement leaves the spec open").not.toContain(SPEC);
    expect(
      JSON.stringify(result.calls),
      "nothing is stuck, so no `needs-human` is written",
    ).not.toContain("needs-human");
  }, 300_000);
});
