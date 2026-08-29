import { describe, expect, it } from "vitest";
import {
  createSpecTracker,
  RED_SPEC_CHECK_COMMAND,
  runnableSpecBody,
  runPass,
} from "./spec-closer.fixture";

/**
 * #238 — "Wire the injected --spec closer, delivery and range synthesis into the pass".
 *
 * What a reader of the tracker sees is whether `bin/close-ticket --spec` ran against a spec at all,
 * so that is what these assert — never how the pass reached the decision. The spec's own check is a
 * real command (`true …` / `false …`), so nothing about running it is mocked away: the pass runs
 * what the body says, and the only injected things are the two seams the ticket names.
 */

/** Two merges, in branch order. Both are delivering merges of children of #300. */
const FIRST_MERGE = "b7d2f0c9e14a5b6c8d9e0f1a2b3c4d5e6f708192";
const LAST_MERGE = "0f3a5c7e9b1d2f4a6c8e0b2d4f6a8c0e2b4d6f81";

describe("lane 09's spec-closing pass invokes its injected closer", () => {
  // The closer runs once for a runnable spec with every child delivered by a merged PR, never with an undelivered child — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("runs the closer exactly once for a runnable spec whose every child closed with a merged PR", () => {
    const tracker = createSpecTracker({
      specs: [
        {
          number: 300,
          title: "A spec whose slices have all landed",
          children: [
            { number: 402, state: "closed", stateReason: "completed", merge: FIRST_MERGE },
            { number: 401, state: "closed", stateReason: "completed", merge: LAST_MERGE },
          ],
        },
      ],
    });

    runPass(tracker);

    expect(tracker.closerCalls, "green check and every child delivered: the closer runs, once").toHaveLength(1);
  });

  // The closer runs once for a runnable spec with every child delivered by a merged PR, never with an undelivered child — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("never runs the closer while a child is still open", () => {
    const tracker = createSpecTracker({
      specs: [
        {
          number: 300,
          children: [
            { number: 401, state: "closed", stateReason: "completed", merge: FIRST_MERGE },
            { number: 402, state: "open" },
          ],
        },
      ],
    });

    runPass(tracker);

    expect(tracker.closerCalls).toEqual([]);
    expect(tracker.closedIssues, "an unfinished spec is left open").not.toContain(300);
  });

  // The closer runs once for a runnable spec with every child delivered by a merged PR, never with an undelivered child — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("never runs the closer for a child closed as completed with nothing merged", () => {
    const tracker = createSpecTracker({
      specs: [
        {
          number: 300,
          children: [
            { number: 401, state: "closed", stateReason: "completed", merge: FIRST_MERGE },
            // Closed by hand: completed, but no pull request ever merged. Closure is not delivery.
            { number: 402, state: "closed", stateReason: "completed" },
          ],
        },
      ],
    });

    runPass(tracker);

    expect(tracker.closerCalls).toEqual([]);
    expect(tracker.closedIssues).not.toContain(300);
  });

  // The closer runs once for a runnable spec with every child delivered by a merged PR, never with an undelivered child — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("never runs the closer for a child closed `not planned`, whatever merged against it", () => {
    const tracker = createSpecTracker({
      specs: [
        {
          number: 300,
          children: [
            { number: 401, state: "closed", stateReason: "completed", merge: FIRST_MERGE },
            { number: 402, state: "closed", stateReason: "not_planned", merge: LAST_MERGE },
          ],
        },
      ],
    });

    runPass(tracker);

    expect(tracker.closerCalls).toEqual([]);
  });

  // The closer runs once for a runnable spec with every child delivered by a merged PR, never with an undelivered child — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("never runs the closer when every child delivered but the spec's own check came back red", () => {
    const tracker = createSpecTracker({
      specs: [
        {
          number: 300,
          body: runnableSpecBody(RED_SPEC_CHECK_COMMAND),
          children: [
            { number: 401, state: "closed", stateReason: "completed", merge: FIRST_MERGE },
            { number: 402, state: "closed", stateReason: "completed", merge: LAST_MERGE },
          ],
        },
      ],
    });

    runPass(tracker);

    expect(tracker.closerCalls, "the closer is reached only when both hold").toEqual([]);
    expect(tracker.closedIssues).not.toContain(300);
  });
});
