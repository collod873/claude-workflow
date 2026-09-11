import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, test } from "vitest";
import type { GhExec } from "../shared/gh";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { GRAPH_CHANGED_DISPATCH_ACTION } from "../shared/ready-set";
import { FINDING_MARKER, retirementBody } from "../shared/unreachable";
import CLOSED_BY from "./closing-prs.fixtures/issue-237-closed-by.json";
import PR_STATE from "./closing-prs.fixtures/pr-244-state.json";
import BOT_CLOSED from "./closing-prs.fixtures/issue-493-comments.json";
import OWNER_CLOSED from "./closing-prs.fixtures/issue-494-comments.json";
import { scratchDir } from "../shared/scratch.fixture";
import {
  carriesVerifiedClosingRecord,
  closedByMergedPr,
  deliveryOf,
  RECONCILE_DISPATCH_ACTIONS,
  RUN_ENDED_ACTION,
  SESSION_CAPTURED_DISPATCH_ACTION,
  TO_BUILD_LABEL,
} from "./reconcile";
import {
  commentsCarrying,
  deadRun,
  HAND_WRITTEN_TICKET,
  liveRun,
  reconcileOver,
  startedIssues,
  trackerWith,
  type FakeRun,
  type Tracker,
  type TrackerOptions,
} from "./tracker.fixture";

describe("the delivery question, against payloads GitHub actually served", () => {
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

describe("a closing record delivers what no linked pull request shows", () => {
  const recordOf = <T extends { body: string }>(pages: T[][]) => pages.flat().filter((comment) => comment.body.startsWith("## Closing record"));

  it("reads #493 as delivered: lane 08 merged its PR unlinked and the bot posted the record", () => {
    expect(carriesVerifiedClosingRecord(BOT_CLOSED.flat())).toBe(true);
  });

  it("reads #494 as delivered: pushed by hand and closed by the owner's record", () => {
    expect(carriesVerifiedClosingRecord(OWNER_CLOSED.flat())).toBe(true);
  });

  it("refuses the same record from a stranger", () => {
    const forged = recordOf(OWNER_CLOSED).map((comment) => ({ ...comment, author_association: "NONE", user: { login: "stranger" } }));
    expect(carriesVerifiedClosingRecord(forged)).toBe(false);
  });

  it("refuses a record that verified nothing", () => {
    const empty = recordOf(OWNER_CLOSED).map((comment) => ({ ...comment, body: comment.body.replace(/^\d+ of/m, "0 of") }));
    expect(carriesVerifiedClosingRecord(empty)).toBe(false);
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

describe("runReconcile answers its three dispatch actions and no others", () => {
  it("names session-captured as the floor, graph-changed as the hint, and run-ended as a lane saying it stopped", () => {
    expect(RECONCILE_DISPATCH_ACTIONS).toEqual([SESSION_CAPTURED_DISPATCH_ACTION, GRAPH_CHANGED_DISPATCH_ACTION, RUN_ENDED_ACTION]);
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
    expect(startedIssues(tracker)).toEqual([11]);
  });

  it("does not start a slice a live Implement run carries, whatever the refs say", () => {
    const tracker = leftBehind({ runs: [liveRun(900, "Implement #20")] });

    expect(reconcileOver(tracker).action).toBe("clear");
    expect(tracker.released).toEqual([]);
  });

  const leftBehind = (held: Partial<TrackerOptions> = {}) =>
    trackerWith({
      open: [{ number: 20, title: "Left behind", blockedBy: [10] }],
      closed: [{ number: 10, stateReason: "completed", merged: true }],
      claimed: ["implement/issue-20"],
      ...held,
    });

  it("does not start a slice whose implement/issue-<n> ref has a pull request or commits, since that is somebody's work", () => {
    for (const held of [{ withPullRequest: ["implement/issue-20"] }, { withCommits: ["implement/issue-20"] }]) {
      const tracker = leftBehind(held);

      const outcome = reconcileOver(tracker);

      expect(startedIssues(tracker)).toEqual([]);
      expect(tracker.released).toEqual([]);
      expect(outcome.action).toBe("clear");
    }
  });

  it("releases a bare implement/issue-<n> ref no run is holding and starts the slice, since a claim with no run is a dead run's leftover (#384)", () => {
    const tracker = leftBehind();

    const outcome = reconcileOver(tracker);

    expect(tracker.released).toEqual(["implement/issue-20"]);
    expect(startedIssues(tracker)).toEqual([20]);
    expect(outcome.action).toBe("dispatched");
  });

  it("leaves a bare ref alone in a dry run and reads the slice as started", () => {
    const tracker = leftBehind();

    reconcileOver(tracker, { dryRun: true });

    expect(tracker.released).toEqual([]);
    expect(startedIssues(tracker)).toEqual([]);
  });

  it("never starts an issue that is neither a published slice nor labelled to-build", () => {
    const tracker = trackerWith({
      open: [
        { number: 30, title: "A hand-written idea", body: HAND_WRITTEN_TICKET, labels: [] },
        { number: 31, title: "A published slice" },
      ],
    });

    reconcileOver(tracker);

    expect(startedIssues(tracker)).toEqual([31]);
  });

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

describe("runReconcile leaves alone a slice a merged pull request already closes", () => {
  const landedNotClosed = () => trackerWith({ open: [{ number: 20, title: "Landed, not closed", mergedCloser: true }] });

  it("#372.1: it does not dispatch an open, unstarted slice whose closing pull request has merged, since integrate deletes the implement branch and the slice only reads as unstarted", () => {
    const tracker = landedNotClosed();

    const outcome = reconcileOver(tracker);

    expect(tracker.dispatches).toEqual([]);
    expect(outcome.action).toBe("clear");
  });

  it("#372.2: it says which merged pull request stands on the slice instead of dispatching it again", () => {
    const lines: string[] = [];
    const tracker = landedNotClosed();

    reconcileOver(tracker, { log: (line) => lines.push(line) });

    expect(lines.some((line) => line.includes("#20") && line.includes("#204"))).toBe(true);
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
    { what: "the refs API will not say which slices are claimed", options: { open: [{ number: 20, title: "A slice" }], fail: "refs" } },
    { what: "the dependency graph cannot be read", options: { open: [{ number: 20, title: "A slice" }], fail: "edges" } },
  ] satisfies Array<{ what: string; options: TrackerOptions }>)("is degraded, and starts nothing, when $what", ({ options }) => {
    const tracker = trackerWith(options);

    expect(reconcileOver(tracker).action).toBe("degraded");
    expect(tracker.dispatches).toEqual([]);
  });
});

describe("the ladder: a dead run is a strike on its ticket, and the count picks the rung (#384)", () => {
  const TICKET = 77;

  function targetNamingTheTicket(): string {
    const dir = scratchDir("reconcile-ladder");
    mkdirSync(join(dir, ".Workflow", "ladder"), { recursive: true });
    writeFileSync(join(dir, ".Workflow", "ladder", "ladder.test.ts"), `it.fails("#${TICKET}: x", () => {});\n`);
    return dir;
  }

  function ladderOver(options: Omit<TrackerOptions, "open"> & { comments?: string[]; labels?: string[]; authored?: false }) {
    const { comments, labels, authored, ...rest } = options;
    const tracker = trackerWith({
      open: [{ number: TICKET, title: "A ticket", body: HAND_WRITTEN_TICKET, labels: labels ?? [TO_BUILD_LABEL], comments }],
      ...rest,
    });
    const outcome = reconcileOver(tracker, { targetWorkspace: authored === false ? scratchDir("reconcile-ladder-untested") : targetNamingTheTicket() });
    return { tracker, outcome };
  }

  const deadAuthor = (id: number, conclusion: FakeRun["conclusion"] = "cancelled"): FakeRun => ({ id, title: `Acceptance #${TICKET}`, conclusion });

  const rungOf = (tracker: Tracker) => tracker.dispatches.map((d) => `${d.eventType}${d.payload.rung ? `:${d.payload.rung}` : ""}`);

  it("starts a ticket with no strikes on rung one, the implementer", () => {
    const { tracker } = ladderOver({});

    expect(rungOf(tracker)).toEqual(["ticket-ready"]);
    expect(tracker.comments).toEqual([]);
  });

  it("records one dead run as one strike carrying the log's failure line, and re-dispatches with fresh eyes", () => {
    const { tracker } = ladderOver({ runs: [deadRun(900, TICKET, "implementing #77\nimplement failed: EISDIR bin/close-ticket\n")] });

    const strikes = commentsCarrying(tracker, "strike:v1 run=900");
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toContain("EISDIR bin/close-ticket");
    expect(rungOf(tracker)).toEqual(["ticket-ready:fresh-eyes"]);
  });

  it("records a cancelled run that never answered by its conclusion", () => {
    const { tracker } = ladderOver({ runs: [deadRun(901, TICKET, undefined, "cancelled")] });

    expect(commentsCarrying(tracker, "strike:v1 run=901")[0]).toContain("cancelled before answering");
  });

  it("records a dead run once, so the next recompute counts it rather than repeating it", () => {
    const first = ladderOver({ runs: [deadRun(900, TICKET, "implement failed: x\n")] });
    const recorded = first.tracker.comments.map((comment) => comment.body);

    const second = ladderOver({ runs: [deadRun(900, TICKET, "implement failed: x\n")], comments: recorded });

    expect(second.tracker.comments).toEqual([]);
    expect(rungOf(second.tracker)).toEqual(["ticket-ready:fresh-eyes"]);
  });

  it("sends the mechanic after two strikes", () => {
    const runs = [deadRun(900, TICKET, "implement failed: x\n"), deadRun(901, TICKET, "implement failed: x\n")];
    const { tracker } = ladderOver({ runs });

    expect(commentsCarrying(tracker, "strike:v1").map((body) => /run=(\d+)/.exec(body)?.[1])).toEqual(["900", "901"]);
    expect(rungOf(tracker)).toEqual(["mechanic-wanted"]);
  });

  it("counts a dead Mechanic run as a strike too", () => {
    const runs = [deadRun(900, TICKET, "implement failed: x\n"), deadRun(901, TICKET, "implement failed: x\n")];
    const first = ladderOver({ runs });
    const recorded = first.tracker.comments.map((comment) => comment.body);

    const { tracker } = ladderOver({
      runs: [...runs, { id: 902, title: `Mechanic #${TICKET}`, conclusion: "failure", failedLog: "mechanic failed: fence\n" }],
      comments: recorded,
    });

    expect(commentsCarrying(tracker, "strike:v1 run=902")[0]).toContain("fence");
    expect(rungOf(tracker)).toEqual([]);
    expect(commentsCarrying(tracker, "strike-decision:v1")).toHaveLength(1);
  });

  it("stops after three strikes: posts one decision with lettered options, labels needs-human, dispatches nothing", () => {
    const runs = [900, 901, 902].map((id) => deadRun(id, TICKET, "implement failed: x\n"));
    const { tracker, outcome } = ladderOver({ runs });

    const decision = commentsCarrying(tracker, "strike-decision:v1");
    expect(decision).toHaveLength(1);
    expect(decision[0]).toContain("- A. ");
    expect(tracker.labelsAdded).toContainEqual({ issue: TICKET, name: "needs-human" });
    expect(rungOf(tracker)).toEqual([]);
    expect(outcome.action).toBe("clear");
    expect(outcome.note).toContain("decision");
  });

  test("#463.1: a ticket whose comments end with a decision marker and no later strike is dispatched at rung implementer", () => {
    const runs = [900, 901, 902].map((id) => deadRun(id, TICKET, "implement failed: x\n"));
    const first = ladderOver({ runs });
    const recorded = first.tracker.comments.map((comment) => comment.body);

    const { tracker, outcome } = ladderOver({ runs, comments: recorded });

    expect(rungOf(tracker)).toEqual(["ticket-ready"]);
    expect(outcome.action).toBe("dispatched");
    expect(tracker.comments).toEqual([]);
  });

  test("#463.3: the reconcile note never says a ticket waits on a decision after three strikes", () => {
    const runs = [900, 901, 902].map((id) => deadRun(id, TICKET, "implement failed: x\n"));

    const { outcome } = ladderOver({ runs });

    expect(outcome.note).not.toContain("wait on a decision");
  });

  it("counts a dead Acceptance run as a strike and asks the author again, so a capped author is bounded rather than looped (#457)", () => {
    const { tracker } = ladderOver({ authored: false, runs: [deadAuthor(910)] });

    const strikes = commentsCarrying(tracker, "strike:v1 run=910");
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toContain("cancelled before answering");
    expect(strikes[0]).toContain("the author starts again");
    expect(rungOf(tracker)).toEqual(["acceptance-wanted"]);
  });

  it("stops asking the author after three dead Acceptance runs, the same decision the implementer's ladder ends on (#457)", () => {
    const runs = [910, 911, 912].map((id) => deadAuthor(id));
    const { tracker, outcome } = ladderOver({ authored: false, runs });

    expect(commentsCarrying(tracker, "strike-decision:v1")).toHaveLength(1);
    expect(tracker.labelsAdded).toContainEqual({ issue: TICKET, name: "needs-human" });
    expect(rungOf(tracker)).toEqual([]);
    expect(outcome.note).toContain("decision");
  });

  it("carries an Acceptance strike into the implementer's ladder once a test exists, since the count is the ticket's, not a lane's (#457)", () => {
    const { tracker } = ladderOver({ runs: [deadAuthor(910, "failure")] });

    expect(commentsCarrying(tracker, "strike:v1 run=910")).toHaveLength(1);
    expect(rungOf(tracker)).toEqual(["ticket-ready:fresh-eyes"]);
  });

  it("does not start a ticket carrying needs-human at all; the label is the owner's hold", () => {
    const { tracker } = ladderOver({ labels: [TO_BUILD_LABEL, "needs-human"] });

    expect(rungOf(tracker)).toEqual([]);
  });

  it("reads every ticket as unstarted, with no strikes, when the runs API cannot be read (#390)", () => {
    const { tracker, outcome } = ladderOver({ fail: "runs" });

    expect(outcome.action).toBe("dispatched");
    expect(rungOf(tracker)).toEqual(["ticket-ready"]);
  });
});

test("#437.2: the to-build door never admits a `by-hand` issue and stands it down with its own comment, never adding needs-human", () => {
  const BY_HAND_TICKET = 55;
  const tracker = trackerWith({
    open: [
      {
        number: BY_HAND_TICKET,
        title: "Rewire this workstation",
        body: HAND_WRITTEN_TICKET,
        labels: [TO_BUILD_LABEL, "by-hand"],
      },
    ],
  });

  reconcileOver(tracker);

  expect(tracker.dispatches).toEqual([]);

  const standDown = tracker.comments.filter((comment) => comment.issue === BY_HAND_TICKET);
  expect(standDown).toHaveLength(1);
  expect(standDown[0].body).toContain("by-hand");
  expect(standDown[0].body).not.toContain("to-build-refused:v1");

  expect(tracker.labelsAdded.filter((label) => label.name === "needs-human")).toEqual([]);
});

test("#437.3: a `by-hand` issue never reaches the dispatched set, even with every other precondition met", () => {
  const tracker = trackerWith({
    open: [
      { number: 20, title: "Rewire this workstation", labels: ["by-hand"], blockedBy: [10] },
      { number: 21, title: "An ordinary slice", blockedBy: [10] },
    ],
    closed: [{ number: 10, stateReason: "completed", merged: true }],
  });

  const outcome = reconcileOver(tracker);

  expect(startedIssues(tracker)).toEqual([21]);
  expect(outcome.dispatched).not.toContain(20);
});

test("#472.2: the door's log line for a refusal names the needs-human hold it applied", () => {
  const lines: string[] = [];
  const tracker = trackerWith({
    open: [
      {
        number: 710,
        title: "Refused at the door",
        body: "## Acceptance criteria\n\n- [ ] It works — check: `true`\n",
        labels: [TO_BUILD_LABEL],
      },
    ],
  });

  reconcileOver(tracker, { log: (line) => lines.push(line) });

  const refusal = lines.find(
    (line) => line.includes("#710") && line.includes("refused at the") && line.includes(TO_BUILD_LABEL) && line.includes("door"),
  );

  expect(refusal).toBeDefined();
  expect(refusal).toContain(NEEDS_HUMAN_LABEL);
});

test(
  "#472.3: the to-build door section of the reconcile lane's edge walkthrough says a refusal escalates and a clear lifts the label",
  async () => {
    const doc = await readFile(new URL("../../../docs/agents/reconcile-lane-edges.md", import.meta.url), "utf8");
    const lines = doc.split("\n");

    const opens = lines.findIndex((line) => line.includes("toBuildRefusal"));
    expect(opens).toBeGreaterThanOrEqual(0);

    const rest = lines.slice(opens + 1);
    const closes = rest.findIndex((line) => line.startsWith("## "));
    const section = rest.slice(0, closes === -1 ? rest.length : closes).join("\n");

    expect(section).toContain(NEEDS_HUMAN_LABEL);
  },
);
