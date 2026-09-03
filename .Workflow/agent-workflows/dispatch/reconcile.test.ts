import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { GRAPH_CHANGED_DISPATCH_ACTION } from "../shared/ready-set";
import { FINDING_MARKER, retirementBody } from "../shared/unreachable";
import CLOSED_BY from "./closing-prs.fixtures/issue-237-closed-by.json";
import PR_STATE from "./closing-prs.fixtures/pr-244-state.json";
import {
  closedByMergedPr,
  deliveryOf,
  RECONCILE_DISPATCH_ACTIONS,
  SESSION_CAPTURED_DISPATCH_ACTION,
} from "./reconcile";
import {
  HAND_WRITTEN_TICKET,
  reconcileOver,
  startedIssues,
  trackerWith,
  type TrackerOptions,
} from "./tracker.fixture";

/**
 * Lane 09's recompute over the graph (#179): how a blocker's delivery is read, which slices the
 * pass starts, what it files as unreachable, when it retires that report, and when it refuses to
 * answer at all. The `to-build` door is `to-build-door.test.ts`; the spec passes are
 * `spec-pass.test.ts`. All three run against `tracker.fixture.ts`.
 */

/**
 * The delivery question, replayed against payloads recorded from the live tracker rather than
 * against a shape this file made up — `gh issue view 237 --json closedByPullRequestsReferences` and
 * `gh pr view 244 --json state`, both captured on 2026-08-29.
 *
 * This is the guard the old reader never had — `closedByMergedPr`'s docstring in `reconcile.ts` is
 * the home for the defect it exists to catch (ADR-0106). A fixture cannot be talked into agreeing
 * the way the hand-written fake that missed it could.
 *
 * `applyJq` is deliberately tiny and deliberately fed the reader's *own* `--jq` string: the point is
 * that the expression the code ships is the expression the recorded data is read with, so putting
 * `.state` back reproduces the `[null]` that started this.
 */
describe("the delivery question, against payloads GitHub actually served", () => {
  /** `[.a[].b]` and `.a`, the only two forms the reader sends. Strings print raw, as `gh --jq` does. */
  function applyJq(expression: string, payload: unknown): string {
    const collect = /^\[\.([A-Za-z]+)\[\]\.([A-Za-z_]+)\]$/.exec(expression);
    if (collect) {
      const nodes = (payload as Record<string, Record<string, unknown>[]>)[collect[1]] ?? [];
      return JSON.stringify(nodes.map((node) => node[collect[2]] ?? null));
    }
    const field = /^\.([A-Za-z]+)$/.exec(expression)![1];
    return String((payload as Record<string, unknown>)[field]);
  }

  const replay: GhExec = (args) => {
    const expression = args[args.indexOf("--jq") + 1];
    return applyJq(expression, args[0] === "issue" ? CLOSED_BY : PR_STATE);
  };

  it("carries the closing pull request's number, and no state anywhere on it", () => {
    const [node] = CLOSED_BY.closedByPullRequestsReferences;
    expect(node.number).toBe(244);
    expect(node).not.toHaveProperty("state");
  });

  it("reads #237 as delivered, which is what it is: merged as PR #244", () => {
    expect(closedByMergedPr(replay, 237)).toBe(true);
  });

  it("asks the pull request for the state, never the issue", () => {
    const asked: string[][] = [];
    const watched: GhExec = (args) => {
      asked.push([...args]);
      return replay(args);
    };
    closedByMergedPr(watched, 237);
    expect(asked[0].slice(0, 2)).toEqual(["issue", "view"]);
    expect(asked[1].slice(0, 3)).toEqual(["pr", "view", "244"]);
  });
});

describe("deliveryOf", () => {
  it("reads an open blocker as open", () => {
    expect(deliveryOf({ number: 1, state: "open", state_reason: null }, () => false)).toBe("open");
  });

  it("reads a blocker closed as completed with a merged PR as delivered", () => {
    expect(deliveryOf({ number: 1, state: "closed", state_reason: "completed" }, () => true)).toBe("delivered");
  });

  it("reads a blocker closed as completed with nothing merged as undelivered", () => {
    expect(deliveryOf({ number: 1, state: "closed", state_reason: "completed" }, () => false)).toBe("undelivered");
  });

  it("reads a blocker closed `not planned` as undelivered without asking about pull requests", () => {
    let asked = false;
    const delivery = deliveryOf({ number: 1, state: "closed", state_reason: "not_planned" }, () => {
      asked = true;
      return true;
    });

    expect(delivery).toBe("undelivered");
    expect(asked, "a `not planned` close is undelivered whatever merged").toBe(false);
  });
});

describe("runReconcile answers both dispatch actions and no others", () => {
  it("names session-captured as the floor and graph-changed as the hint", () => {
    expect(RECONCILE_DISPATCH_ACTIONS).toEqual([SESSION_CAPTURED_DISPATCH_ACTION, GRAPH_CHANGED_DISPATCH_ACTION]);
  });
});

describe("runReconcile dispatches the wave nothing was sending", () => {
  it("starts a slice whose every blocker closed with a merged PR", () => {
    const tracker = trackerWith({
      open: [{ number: 20, title: "Second wave", blockedBy: [10, 11] }],
      closed: [
        { number: 10, stateReason: "completed", merged: true },
        { number: 11, stateReason: "completed", merged: true },
      ],
    });

    const outcome = reconcileOver(tracker);

    expect(outcome.action).toBe("dispatched");
    expect(startedIssues(tracker)).toEqual([20]);
  });

  it("starts nothing for a slice with one merged and one open blocker", () => {
    const tracker = trackerWith({
      open: [
        { number: 11, title: "Still building" },
        { number: 20, title: "Second wave", blockedBy: [10, 11] },
      ],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
    });

    const outcome = reconcileOver(tracker);

    expect(outcome.action).toBe("dispatched");
    // #11 is itself a ready root, which is why the run is not `clear` — but #20 is not in it.
    expect(startedIssues(tracker)).toEqual([11]);
  });

  it("does not start a slice that already has an implement/issue-<n> ref", () => {
    const tracker = trackerWith({
      open: [{ number: 20, title: "Already claimed", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
      claimed: ["implement/issue-20"],
    });

    const outcome = reconcileOver(tracker);

    expect(startedIssues(tracker)).toEqual([]);
    expect(outcome.action).toBe("clear");
  });

  /**
   * The scope rule, and it is a safety rule. Being in the graph is what makes an issue ready;
   * being something the owner meant to be built is what makes it something an implementer may be
   * pointed at. Without this, every unblocked issue on the tracker — this ticket included — would
   * get a Sonnet run and a pull request.
   *
   * #184 widened the rule to a second door and did not weaken it: an issue carrying neither the
   * `## Parent PRD` heading nor `to-build` is still refused however ready it looks, which is what
   * this pins.
   */
  it("never starts an issue that is neither a published slice nor labelled to-build", () => {
    const tracker = trackerWith({
      open: [
        // Ticket-shaped, and still not dispatched: shape was never the missing term.
        { number: 30, title: "A hand-written idea", body: HAND_WRITTEN_TICKET, labels: [] },
        { number: 31, title: "A published slice" },
      ],
    });

    reconcileOver(tracker);

    expect(startedIssues(tracker)).toEqual([31]);
  });

  /** One slice, ready: its only blocker closed with a merged pull request. */
  const readyBehindMerged = () =>
    trackerWith({
      open: [{ number: 20, title: "Second wave", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
    });

  it("reads the dependency graph and writes nothing to it", () => {
    const tracker = readyBehindMerged();

    reconcileOver(tracker);

    const graphWrites = tracker.calls.filter(
      (call) => call[1]?.endsWith("/dependencies/blocked_by") && (call.includes("-F") || call.includes("-f")),
    );
    expect(graphWrites, "ADR-0069: the graph is lane 03's output, read-only downstream").toEqual([]);
  });

  it("dispatches nothing at all in a dry run", () => {
    const tracker = readyBehindMerged();

    const outcome = reconcileOver(tracker, { dryRun: true });

    expect(outcome.dispatched).toEqual([20]);
    expect(tracker.dispatches).toEqual([]);
  });
});

describe("runReconcile reports what became unreachable", () => {
  it("files a slice transitively behind a blocker closed without delivering, as one issue rather than one per slice", () => {
    const tracker = trackerWith({
      open: [
        { number: 20, title: "Behind the abandoned one", blockedBy: [10] },
        { number: 21, title: "Behind that", blockedBy: [20] },
      ],
      closed: [{ number: 10, stateReason: "not_planned" }],
    });

    const outcome = reconcileOver(tracker);

    expect(outcome.unreachable.sort()).toEqual([20, 21]);
    expect(tracker.created).toHaveLength(1);
    expect(tracker.created[0].body).toContain("#20 —");
    expect(tracker.created[0].body).toContain("#21 —");
    expect(tracker.created[0].body).toContain(FINDING_MARKER);
  });

  it("comments on the standing issue rather than opening a second one", () => {
    const tracker = trackerWith({
      open: [{ number: 20, title: "Behind the abandoned one", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "not_planned" }],
      standing: { number: 400, body: `Already standing.\n\n${FINDING_MARKER}` },
    });

    reconcileOver(tracker);

    expect(tracker.created).toEqual([]);
    expect(tracker.comments).toHaveLength(1);
    expect(tracker.comments[0].issue).toBe(400);
    expect(tracker.comments[0].body).toContain("#20 —");
    // And leaves it open: the report is only retired at a count of zero (ADR-0099).
    expect(tracker.closedByRun).toEqual([]);
  });

  it("says nothing twice about a slice the standing issue already names", () => {
    const tracker = trackerWith({
      open: [{ number: 20, title: "Behind the abandoned one", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "not_planned" }],
      standing: { number: 400, body: `#20 — Behind the abandoned one\n\n${FINDING_MARKER}` },
    });

    const outcome = reconcileOver(tracker);

    expect(tracker.comments).toEqual([]);
    expect(tracker.created).toEqual([]);
    expect(outcome.unreachable).toEqual([]);
  });

  it("files nothing when everything is merely waiting", () => {
    const tracker = trackerWith({
      open: [
        { number: 11, title: "Still building" },
        { number: 20, title: "Waiting on it", blockedBy: [11] },
      ],
    });

    const outcome = reconcileOver(tracker);

    expect(outcome.unreachable).toEqual([]);
    expect(tracker.created).toEqual([]);
    expect(tracker.comments).toEqual([]);
    expect(tracker.closedByRun).toEqual([]);
  });
});

describe("runReconcile closes the standing report once nothing is unreachable", () => {
  /** Nothing unreachable — #20 is merely waiting on an open blocker — with `standing` up. */
  const waiting = (standing?: TrackerOptions["standing"]) =>
    trackerWith({
      open: [
        { number: 11, title: "Still building" },
        { number: 20, title: "Waiting on it", blockedBy: [11] },
      ],
      standing,
    });
  const REPORT = { number: 400, body: `#20 — Was unreachable\n\n${FINDING_MARKER}` };

  it("closes it, so a report that named slices which then delivered cannot outlive them (#216)", () => {
    const tracker = waiting(REPORT);

    reconcileOver(tracker);

    expect(tracker.closedByRun).toEqual([{ issue: 400, reason: "completed" }]);
  });

  it("posts a closing record first, so the close gate's grammar is satisfied by the mechanism", () => {
    const tracker = waiting(REPORT);

    reconcileOver(tracker);

    expect(tracker.comments).toEqual([{ issue: 400, body: retirementBody() }]);
    // Ordered: the record has to exist before the close, or the gate reads a close with no record.
    const order = tracker.calls.filter((call) => call[0] === "issue").map((call) => call[1]);
    expect(order.indexOf("comment")).toBeLessThan(order.indexOf("close"));
  });

  it("closes nothing in a dry run", () => {
    const tracker = waiting(REPORT);

    reconcileOver(tracker, { dryRun: true });

    expect(tracker.closedByRun).toEqual([]);
    expect(tracker.comments).toEqual([]);
  });

  it("keeps its answer when the close will not go through, because the next recompute retries it", () => {
    const tracker = waiting(REPORT);
    const refusing: GhExec = (args) => {
      if (args[0] === "issue" && args[1] === "close") throw new Error("gh: 403");
      return tracker.gh(args);
    };

    const outcome = reconcileOver(tracker, { gh: refusing });

    expect(outcome.action).not.toBe("degraded");
    expect(outcome.unreachable).toEqual([]);
  });
});

describe("runReconcile refuses to answer when it cannot read its own inputs", () => {
  it.each([
    { what: "the tracker will not list open issues", options: { open: [], fail: "issues" } },
    // Without the refs, every slice reads as unstarted — the direction that dispatches duplicates.
    { what: "the refs API will not say which slices are claimed", options: { open: [{ number: 20, title: "A slice" }], fail: "refs" } },
    { what: "the dependency graph cannot be read", options: { open: [{ number: 20, title: "A slice" }], fail: "edges" } },
  ] satisfies Array<{ what: string; options: TrackerOptions }>)("is degraded, and starts nothing, when $what", ({ options }) => {
    const tracker = trackerWith(options);

    expect(reconcileOver(tracker).action).toBe("degraded");
    expect(tracker.dispatches).toEqual([]);
  });
});
