import { describe, expect, it } from "vitest";
import {
  createSpecTracker,
  runPass,
  SPEC_CHECK_COMMAND,
  type SpecTracker,
} from "./spec-closer.fixture";

/**
 * #238's divergence case: the pass runs the spec's check itself and sees it green, hands the spec
 * to the injected closer, and the closer's own run of the same command comes back non-zero. The
 * world moved mid-session.
 *
 * The pass's run is genuinely green — `true …` exits 0 however it is run — and the closer is the
 * one thing injected, so the disagreement is real rather than arranged inside the subject.
 */

const DELIVERING_MERGE = "b7d2f0c9e14a5b6c8d9e0f1a2b3c4d5e6f708192";
const SECOND_MERGE = "0f3a5c7e9b1d2f4a6c8e0b2d4f6a8c0e2b4d6f81";

/** A runnable spec, every child delivered, whose closer disagrees with the pass's own green run. */
function diverging(): SpecTracker {
  return createSpecTracker({
    specs: [
      {
        number: 300,
        title: "A spec whose check answered twice",
        children: [
          { number: 401, state: "closed", stateReason: "completed", merge: DELIVERING_MERGE },
          { number: 402, state: "closed", stateReason: "completed", merge: SECOND_MERGE },
        ],
      },
    ],
    closerResult: { exitCode: 1, output: "the check came back red" },
  });
}

/** The one comment the pass owns on #300 — the verdict, whatever it now says. */
function verdictOn(tracker: SpecTracker): string[] {
  return tracker.commentsOn(300).filter((body) => body.includes("prd-check:v1"));
}

describe("a pass/closer disagreement about the same spec", () => {
  // A pass/closer disagreement rewrites the verdict naming both, leaves the spec open, writes no `needs-human` — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("rewrites the one verdict comment to name both runs and their exit statuses", () => {
    const tracker = diverging();

    runPass(tracker);

    expect(tracker.closerCalls, "the disagreement needs the closer to have run").toHaveLength(1);

    const verdicts = verdictOn(tracker);
    expect(verdicts, "the pass owns exactly one comment per spec and rewrites it whole").toHaveLength(1);

    const verdict = verdicts[0] ?? "";
    expect(verdict, "the command run, verbatim").toContain(SPEC_CHECK_COMMAND);
    expect(verdict, "the pass's own run: exit 0").toMatch(/exit[^\n]*\b0\b/i);
    expect(verdict, "the closer's run: exit 1").toMatch(/exit[^\n]*\b1\b/i);
    expect(verdict, "the second run is named as the closer's").toMatch(/clos/i);
  });

  // A pass/closer disagreement rewrites the verdict naming both, leaves the spec open, writes no `needs-human` — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("leaves the spec open", () => {
    const tracker = diverging();

    runPass(tracker);

    expect(tracker.closedIssues).not.toContain(300);
  });

  // A pass/closer disagreement rewrites the verdict naming both, leaves the spec open, writes no `needs-human` — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("writes no `needs-human`, because nothing is stuck and the body was runnable", () => {
    const tracker = diverging();

    runPass(tracker);

    expect(tracker.wrote("needs-human"), "an agent that neither tried nor stopped writes no label").toBe(false);
    expect(
      verdictOn(tracker).join("\n"),
      "a divergence is a verdict, never the refusal marker",
    ).not.toContain("prd-unrunnable:v1");
  });
});
