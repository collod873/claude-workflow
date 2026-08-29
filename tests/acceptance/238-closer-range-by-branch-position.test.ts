import { describe, expect, it } from "vitest";
import {
  deliveredChild,
  mergesOnDefaultBranch,
  runSpecPass,
  specIssue,
  type Scenario,
} from "./238-reconcile-closer.fixture";

const SPEC = 900;

describe("#238 — the range the pass synthesises for the closer", () => {
  /**
   * Acceptance criterion, verbatim:
   *
   * "Range is `<first-merge>^..<last-merge>` by branch position not issue number; one child collapses to `<merge>^..<merge>` — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`"
   */
  it("spans the delivering merges by branch position rather than by issue number, and collapses to one merge for a one-child spec", () => {
    const [early, late] = mergesOnDefaultBranch(2);

    // #801 is the lower issue number and the *later* merge; #802 the higher number and the earlier
    // one. Ordering by issue number therefore renders the range backwards, which is the failure the
    // criterion names.
    const outOfOrder: Scenario = {
      spec: specIssue(SPEC),
      children: [
        deliveredChild(801, SPEC, late, 701),
        deliveredChild(802, SPEC, early, 700),
      ],
      closer: { exitCode: 0, output: "closing record posted" },
    };
    const spanned = runSpecPass(outOfOrder);

    expect(spanned.closerCalls).toHaveLength(1);
    const invocation = JSON.stringify(spanned.closerCalls[0]);

    expect(
      invocation,
      "BASE excludes itself, so BASE is the parent of the first delivering merge",
    ).toContain(early.sha + "^.." + late.sha);
    expect(invocation, "ordered by issue number the range would run backwards").not.toContain(
      late.sha + "^.." + early.sha,
    );

    // One child: the range covers exactly that merge rather than rendering the empty `X..X`.
    const [only] = mergesOnDefaultBranch(1);
    const single: Scenario = {
      spec: specIssue(SPEC),
      children: [deliveredChild(801, SPEC, only, 700)],
      closer: { exitCode: 0, output: "closing record posted" },
    };
    const collapsed = runSpecPass(single);

    expect(collapsed.closerCalls).toHaveLength(1);
    expect(JSON.stringify(collapsed.closerCalls[0])).toContain(only.sha + "^.." + only.sha);
  }, 300_000);
});
