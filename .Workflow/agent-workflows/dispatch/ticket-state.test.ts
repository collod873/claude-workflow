import { describe, expect, it } from "vitest";
import { test } from "vitest";
import type { GhExec } from "../shared/gh";
import { issueCommentsPath, subIssuesPath } from "../shared/gh-paths";
import { BY_HAND_LABEL, BUILDING_LABEL, NEEDS_HUMAN_LABEL, PRD_LABEL } from "../shared/labels";
import { CLAIM_LIMIT } from "../shared/ticket-shape";
import type { Tracker, TrackerBlocker } from "../shared/tracker";
import { openIssuesAnswer, runListAnswer } from "../shared/gh-list-answers.fixture";
import { ticketState, TO_BUILD_REFUSED_MARKER, type TicketState, type TicketStates } from "./ticket-state";
import { TO_BUILD_LABEL } from "./reconcile";

export const silent = () => {};

export const HAND_WRITTEN_TICKET = [
  "## What to build",
  "",
  "Something the owner could already write in full.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] `make gate` exits 0 — check: `make gate`",
  "",
  "## Files claimed",
  "",
  "- None — no files.",
  "",
].join("\n");

function defaultBody(): string {
  return "## Parent PRD\n#145\n\n## What to build\nSomething.\n";
}

interface FakeIssue {
  number: number;
  title: string;
  body?: string;
  blockedBy?: number[];
  labels?: string[];
  comments?: string[];
  children?: number[];
}

interface FakeClosed {
  number: number;
  stateReason: "completed" | "not_planned";
  merged?: boolean;
}

interface FakeRun {
  id: number;
  title: string;
  status?: "completed" | "in_progress" | "queued";
  conclusion?: "success" | "failure" | "cancelled" | "timed_out";
}

export function deadRun(id: number, ticket: number, failedLog?: string, conclusion: FakeRun["conclusion"] = "failure"): FakeRun {
  return { id, title: `Implement #${ticket}`, conclusion };
}

export function liveRun(id: number, title: string): FakeRun {
  return { id, title, status: "in_progress" };
}

interface Options {
  open: FakeIssue[];
  closed?: FakeClosed[];
  runs?: FakeRun[];
  branches?: string[];
  fail?: "issues" | "refs" | "edges";
}

function authoredOn(options: Options, tickets: number[]): Options {
  return { ...options, branches: [...(options.branches ?? []), ...tickets.map((ticket) => `accept/issue-${ticket}`)] };
}

function trackerWith(options: Options): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const runs = options.runs ?? [];

  const gh: GhExec = (args) => {
    calls.push([...args]);

    if (args[0] === "issue" && args[1] === "list") {
      if (options.fail === "issues") throw new Error("gh: 403");
      return openIssuesAnswer(options.open, defaultBody);
    }
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([]);
    }
    if (args[0] === "run" && args[1] === "list") {
      return runListAnswer(runs);
    }
    if (args[0] === "run" && args[1] === "view") return "";
    throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
  };

  return { gh, calls };
}

function blockerRef(number: number, options: Options): TrackerBlocker {
  const record = (options.closed ?? []).find((closed) => closed.number === number);
  return record ? { number, state: "closed", stateReason: record.stateReason } : { number, state: "open", stateReason: null };
}

function trackerFor(options: Options): { tracker: Tracker; commentCalls: number[] } {
  const open = new Map(options.open.map((issue) => [issue.number, issue]));
  const closed = new Map((options.closed ?? []).map((issue) => [issue.number, issue]));
  const branches = options.branches ?? [];
  const commentCalls: number[] = [];

  const tracker: Tracker = {
    workflowRuns: () => [],
    jobs: () => [],
    blockedBy(number) {
      if (options.fail === "edges") throw new Error("gh: 403");
      return (open.get(number)?.blockedBy ?? []).map((blocker) => blockerRef(blocker, options));
    },
    children(number) {
      return (open.get(number)?.children ?? []).map((child) => blockerRef(child, options));
    },
    comments(number) {
      commentCalls.push(number);
      return (open.get(number)?.comments ?? []).map((body, index) => ({ id: number * 1000 + index, body }));
    },
    recordComments: () => [],
    branchesUnder(prefix) {
      if (options.fail === "refs") throw new Error("gh: 403");
      return branches.filter((branch) => branch.startsWith(prefix));
    },
    mergedCloser(number) {
      const record = closed.get(number);
      return record?.merged ? number * 10 + 4 : undefined;
    },
  };

  return { tracker, commentCalls };
}

function stateOver(options: Options, authored: number[] = [], dryRun = false): TicketStates {
  const withBranches = authoredOn(options, authored);
  return ticketState({ gh: trackerWith(withBranches).gh, tracker: trackerFor(withBranches).tracker, log: silent, dryRun });
}

const record = (states: TicketStates, number: number): TicketState => states.byNumber.get(number) as TicketState;

const overWide = (count: number): string =>
  HAND_WRITTEN_TICKET.replace(
    "- None — no files.",
    Array.from({ length: count }, (_unused, at) => `- src/m${at}.ts`).join("\n"),
  );

describe("one record per open ticket, read once", () => {
  it("carries each open ticket's labels, delivery, started-ness and the stage its artifacts put it at", () => {
    const states = stateOver(
      {
        open: [
          { number: 20, title: "Ready", blockedBy: [10], labels: [TO_BUILD_LABEL] },
          { number: 21, title: "Running", labels: [BUILDING_LABEL] },
        ],
        closed: [{ number: 10, stateReason: "completed", merged: true }],
        runs: [liveRun(900, "Implement #21")],
      },
      [20],
    );

    expect(states.degraded).toBeUndefined();
    expect(states.tickets.map((ticket) => ticket.number)).toEqual([20, 21]);

    expect(record(states, 20)).toMatchObject({
      labels: [TO_BUILD_LABEL],
      delivery: "open",
      blockedBy: [10],
      started: false,
      ready: true,
      stage: "needs-build",
    });
    expect(record(states, 21)).toMatchObject({ started: true, ready: false, stage: "busy" });
  });

  it("reads a ticket behind an open blocker as neither ready nor unreachable, and one behind an abandoned blocker as unreachable", () => {
    const states = stateOver({
      open: [
        { number: 11, title: "Still building" },
        { number: 20, title: "Waiting", blockedBy: [11] },
        { number: 30, title: "Behind the abandoned one", blockedBy: [10] },
      ],
      closed: [{ number: 10, stateReason: "not_planned" }],
    });

    expect(record(states, 20)).toMatchObject({ ready: false, unreachable: false });
    expect(record(states, 30)).toMatchObject({ ready: false, unreachable: true });
  });

  it("carries the strikes already standing on a ready ticket and the dead runs nothing has struck yet", () => {
    const standing = [
      "<!-- strike:v1 run=900 conclusion=failure -->\n<!-- strike-signature:EISDIR -->\nStrike.",
    ];
    const states = stateOver(
      {
        open: [{ number: 77, title: "A ticket", body: HAND_WRITTEN_TICKET, labels: [TO_BUILD_LABEL], comments: standing }],
        runs: [deadRun(900, 77, "implement failed: x\n"), deadRun(901, 77, "implement failed: y\n")],
      },
      [77],
    );

    expect(record(states, 77).strikes.map((strike) => strike.runId)).toEqual([900]);
    expect(record(states, 77).unstruck.map((run) => run.databaseId)).toEqual([901]);
  });
});

describe("the record says what the door decided, so the pass never asks the body twice", () => {
  const door = (issue: Partial<FakeIssue>, dryRun = false) =>
    record(
      stateOver(
        { open: [{ number: 42, title: "At the door", body: HAND_WRITTEN_TICKET, labels: [TO_BUILD_LABEL], ...issue }] },
        [],
        dryRun,
      ),
      42,
    );

  it("admits a well-shaped claim", () => {
    expect(door({}).door).toEqual({ verdict: "admit" });
    expect(door({}).startable).toBe(true);
  });

  it("stands a claim only a human can build down, whoever applied the label", () => {
    expect(door({ body: HAND_WRITTEN_TICKET.replace("- None — no files.", "- .claude/settings.json") }).door).toEqual({
      verdict: "stand-down",
      labelled: false,
    });
    expect(door({ labels: [TO_BUILD_LABEL, BY_HAND_LABEL] }).door).toEqual({ verdict: "stand-down", labelled: true });
  });

  it("holds a stood-down claim by hand before the label the door is about to apply exists", () => {
    expect(door({ body: HAND_WRITTEN_TICKET.replace("- None — no files.", "- .claude/settings.json") }).hold).toBe(
      "by-hand",
    );
  });

  it("sends a claim wider than lane 04's budget to slicing, naming the count", () => {
    expect(door({ body: overWide(CLAIM_LIMIT + 1) }).door).toEqual({ verdict: "slice", claimed: CLAIM_LIMIT + 1 });
  });

  it("refuses a body with no check: marker, and does not make it startable", () => {
    const refused = door({ body: "## Acceptance criteria\n\n- [ ] It works\n\n## Files claimed\n\n- src/a.ts\n" });

    expect(refused.door.verdict).toBe("refuse");
    expect(refused.startable).toBe(false);
  });

  it("holds a needs-human ticket until its own standing refusal is the thing being cleared", () => {
    const held = door({ labels: [TO_BUILD_LABEL, NEEDS_HUMAN_LABEL] });
    expect(held.door).toEqual({ verdict: "clear" });
    expect(held.hold, "nothing standing to clear, so the hold stays").toBe("needs-human");

    const clearing = door({
      labels: [TO_BUILD_LABEL, NEEDS_HUMAN_LABEL],
      comments: [`Missing something.\n\n${TO_BUILD_REFUSED_MARKER}`],
    });
    expect(clearing.hold, "the door lifts what it wrote, so the same pass may dispatch it").toBeUndefined();
  });

  it("reads nothing at the door in a dry run, which writes nothing to clear", () => {
    expect(door({ labels: [TO_BUILD_LABEL, NEEDS_HUMAN_LABEL] }, true).comments).toBeUndefined();
  });
});

describe("what the record does not go back to the tracker for", () => {
  it("reads no comments for a ticket it admits and cannot dispatch yet", () => {
    const options: Options = {
      open: [
        { number: 11, title: "Still building" },
        { number: 12, title: "Admitted, blocked", body: HAND_WRITTEN_TICKET, labels: [TO_BUILD_LABEL], blockedBy: [11] },
      ],
    };
    const { tracker, commentCalls } = trackerFor(options);

    ticketState({ gh: trackerWith(options).gh, tracker, log: silent, dryRun: false });

    expect(commentCalls).not.toContain(12);
  });

  it("asks each ticket for its comments at most once, however many decisions read them", () => {
    const options = authoredOn(
      {
        open: [{ number: 77, title: "A ticket", body: HAND_WRITTEN_TICKET, labels: [TO_BUILD_LABEL] }],
        runs: [deadRun(900, 77, "implement failed: x\n")],
      },
      [77],
    );
    const { tracker, commentCalls } = trackerFor(options);

    ticketState({ gh: trackerWith(options).gh, tracker, log: silent, dryRun: false });

    expect(commentCalls.filter((number) => number === 77)).toHaveLength(1);
  });

  it("names a spec's sub-issues on the record, so the rollup and the closing attempt share one read", () => {
    const states = stateOver({
      open: [
        { number: 145, title: "A spec", labels: [PRD_LABEL], children: [201], body: "## Acceptance criteria\n\n- [ ] It works — check: `true`\n" },
        { number: 201, title: "Its child" },
      ],
    });

    expect(record(states, 145).isSpec).toBe(true);
    expect(record(states, 145).children?.map((child) => child.number)).toEqual([201]);
    expect(record(states, 201).isSpec).toBe(false);
  });
});

describe("a read it cannot finish is said once, not half-answered", () => {
  it.each([
    { what: "the open issues", fail: "issues" as const, names: "readable list of open issues" },
    { what: "the accept refs", fail: "refs" as const, names: "still wanting it" },
    { what: "the dependency graph", fail: "edges" as const, names: "dependency graph" },
  ])("says the pass is degraded when it cannot read $what", ({ fail, names }) => {
    const states = stateOver({ open: [{ number: 20, title: "A slice" }], fail });

    expect(states.degraded).toContain(names);
    expect(states.tickets).toEqual([]);
  });
});

describe("a spec's children and comments come from the tracker, not a gh api argv ticket-state builds itself", () => {
  test("#609.1: fetchChildren and fetchComments answer without ticket-state.ts building a gh api argv", () => {
    const fixture = trackerWith({
      open: [
        {
          number: 145,
          title: "A spec",
          labels: [PRD_LABEL],
          children: [201],
          body: "## Acceptance criteria\n\n- [ ] It works — check: `true`\n",
          comments: ["a comment"],
        },
        { number: 201, title: "Its child" },
      ],
    });
    const tracker = new Proxy({}, { get: () => () => [] }) as never;
    const input = { gh: fixture.gh, tracker, log: silent, dryRun: false };

    ticketState(input);

    const built = (path: string): boolean => fixture.calls.some((call) => call[0] === "api" && call[1] === path);

    expect(built(subIssuesPath(145)), "fetchChildren still asked gh for the sub_issues path directly").toBe(false);
    expect(built(issueCommentsPath(145)), "fetchComments still asked gh for the comments path directly").toBe(false);
  });
});
