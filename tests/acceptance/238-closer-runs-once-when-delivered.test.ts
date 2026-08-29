import { describe, expect, it } from "vitest";
import {
  abandonedChild,
  closedIssues,
  deliveredChild,
  mergesOnDefaultBranch,
  openChild,
  runSpecPass,
  specIssue,
  type Scenario,
} from "./238-reconcile-closer.fixture";

const SPEC = 900;

describe("#238 — lane 09's spec-closing pass invokes the injected closer", () => {
  /**
   * Acceptance criterion, verbatim:
   *
   * "The closer runs once for a runnable spec with every child delivered by a merged PR, never with an undelivered child — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`"
   */
  it("runs the closer once for a runnable spec whose every child was delivered by a merged PR, and never for one with an undelivered child", () => {
    const merges = mergesOnDefaultBranch(2);

    const delivered: Scenario = {
      spec: specIssue(SPEC),
      children: [
        deliveredChild(801, SPEC, merges[0], 700),
        deliveredChild(802, SPEC, merges[1], 701),
      ],
      closer: { exitCode: 0, output: "closing record posted" },
    };
    const green = runSpecPass(delivered);

    expect(
      green.closerCalls,
      "a runnable spec with every child delivered is handed to the closer exactly once",
    ).toHaveLength(1);

    // One child still open: not delivered, so the closer is never reached and the spec stays open.
    const stillBuilding: Scenario = {
      spec: specIssue(SPEC),
      children: [deliveredChild(801, SPEC, merges[0], 700), openChild(802, SPEC)],
      closer: { exitCode: 0, output: "closing record posted" },
    };
    const waiting = runSpecPass(stillBuilding);

    expect(waiting.closerCalls, "an open child is an undelivered child").toEqual([]);
    expect(closedIssues(waiting)).not.toContain(SPEC);

    // One child closed `not planned`: closed, and by the estate's rule still not delivered.
    const abandoned: Scenario = {
      spec: specIssue(SPEC),
      children: [deliveredChild(801, SPEC, merges[0], 700), abandonedChild(802, SPEC)],
      closer: { exitCode: 0, output: "closing record posted" },
    };
    const stopped = runSpecPass(abandoned);

    expect(
      stopped.closerCalls,
      "closed is not delivered — only a merged pull request delivers",
    ).toEqual([]);
    expect(closedIssues(stopped)).not.toContain(SPEC);
  }, 300_000);
});
