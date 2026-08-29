import { describe, expect, it } from "vitest";
import { createSpecTracker, runPass } from "./spec-closer.fixture";

/**
 * #238's range synthesis. The range is printed verbatim in the posted closing record — story 23's
 * first line a reader checks — so what it must be is decided by the ticket and asserted here
 * against what the injected closer was actually handed.
 *
 * The two merges below are chosen so that **only** a branch-position read produces the asserted
 * range: branch order disagrees with issue-number order (child #402 merged first) and with
 * lexicographic SHA order (`0f3a…` sorts before `b7d2…`).
 */

/** Position 0 on the default branch — the merge that delivered child #402. */
const FIRST_MERGE = "b7d2f0c9e14a5b6c8d9e0f1a2b3c4d5e6f708192";
/** Position 1 — the merge that delivered child #401, later on the branch and lower-numbered. */
const LAST_MERGE = "0f3a5c7e9b1d2f4a6c8e0b2d4f6a8c0e2b4d6f81";
/** The single delivering merge of the one-child spec. */
const ONLY_MERGE = "5c1e7a3f9d0b2468ace13579bdf02468ace13579";

/** `<base>^..<head>`, accepting the abbreviated SHAs a record may print. */
function rangeRe(base: string, head: string): RegExp {
  return new RegExp(`${base.slice(0, 7)}[0-9a-f]*\\^\\.\\.${head.slice(0, 7)}[0-9a-f]*`);
}

/** The same two SHAs with no `^` — the form that omits the very merge it names. */
function caretlessRangeRe(base: string, head: string): RegExp {
  return new RegExp(`${base.slice(0, 7)}[0-9a-f]*\\.\\.${head.slice(0, 7)}[0-9a-f]*`);
}

describe("the range the pass synthesises for `bin/close-ticket --spec`", () => {
  // Range is `<first-merge>^..<last-merge>` by branch position not issue number; one child collapses to `<merge>^..<merge>` — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("spans the first delivering merge's parent to the last, ordered by branch position", () => {
    const tracker = createSpecTracker({
      specs: [
        {
          number: 300,
          children: [
            // Branch order, deliberately not issue-number order.
            { number: 402, state: "closed", stateReason: "completed", merge: FIRST_MERGE },
            { number: 401, state: "closed", stateReason: "completed", merge: LAST_MERGE },
          ],
        },
      ],
    });

    runPass(tracker);

    expect(tracker.closerCalls).toHaveLength(1);
    const handed = (tracker.closerCalls[0] ?? []).join(" ");
    expect(handed, "BASE is the parent of the earliest merge on the branch").toMatch(
      rangeRe(FIRST_MERGE, LAST_MERGE),
    );
    expect(handed, "ordering by issue number prints the range backwards").not.toMatch(
      rangeRe(LAST_MERGE, FIRST_MERGE),
    );
  });

  // Range is `<first-merge>^..<last-merge>` by branch position not issue number; one child collapses to `<merge>^..<merge>` — check: `npx vitest run .Workflow/agent-workflows/dispatch/reconcile.test.ts`
  it("collapses to `<merge>^..<merge>` for a spec delivered by a single child", () => {
    const tracker = createSpecTracker({
      specs: [
        {
          number: 300,
          children: [{ number: 401, state: "closed", stateReason: "completed", merge: ONLY_MERGE }],
        },
      ],
    });

    runPass(tracker);

    expect(tracker.closerCalls).toHaveLength(1);
    const handed = (tracker.closerCalls[0] ?? []).join(" ");
    expect(handed).toMatch(rangeRe(ONLY_MERGE, ONLY_MERGE));
    expect(handed, "`X..X` covers nothing, so the caret is load-bearing").not.toMatch(
      caretlessRangeRe(ONLY_MERGE, ONLY_MERGE),
    );
  });
});
