import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import {
  countMarker,
  DELETE_ISSUE_TITLE,
  DELETE_THRESHOLD,
  deleteIssueBody,
  falseAlarmCount,
  type FindingIssue,
  FINDING_LABEL,
  GROW_ISSUE_TITLE,
  GROW_THRESHOLD,
  growIssueBody,
  isFalseAlarm,
  markedCount,
  runCounter,
  shouldProposeDelete,
  shouldProposeGrow,
} from "./counter";

const NOW = new Date("2026-08-27T00:00:00Z");

function findingIssue(over: Partial<FindingIssue> = {}): FindingIssue {
  return { number: 1, state: "OPEN", createdAt: "2026-08-26T00:00:00Z", ...over };
}

describe("isFalseAlarm", () => {
  it("is a false alarm when closed not_planned", () => {
    expect(isFalseAlarm(findingIssue({ state: "CLOSED", stateReason: "NOT_PLANNED" }), NOW)).toBe(true);
  });

  it("is not a false alarm when closed completed, however old", () => {
    const ancient = findingIssue({ state: "CLOSED", stateReason: "COMPLETED", createdAt: "2020-01-01T00:00:00Z" });
    expect(isFalseAlarm(ancient, NOW)).toBe(false);
  });

  it("is a false alarm once open past the five-day expiry", () => {
    const stale = findingIssue({ state: "OPEN", createdAt: "2026-08-21T23:59:59Z" });
    expect(isFalseAlarm(stale, NOW)).toBe(true);
  });

  it("is not a false alarm while still open and within the expiry", () => {
    const fresh = findingIssue({ state: "OPEN", createdAt: "2026-08-23T00:00:01Z" });
    expect(isFalseAlarm(fresh, NOW)).toBe(false);
  });
});

describe("falseAlarmCount", () => {
  it("counts only the false alarms in a mixed list", () => {
    const issues = [
      findingIssue({ number: 1, state: "CLOSED", stateReason: "NOT_PLANNED" }),
      findingIssue({ number: 2, state: "CLOSED", stateReason: "COMPLETED" }),
      findingIssue({ number: 3, state: "OPEN", createdAt: "2026-08-01T00:00:00Z" }),
      findingIssue({ number: 4, state: "OPEN", createdAt: NOW.toISOString() }),
    ];
    expect(falseAlarmCount(issues, NOW)).toBe(2);
  });
});

describe("shouldProposeGrow", () => {
  it("does not propose one below the threshold, and does propose at it", () => {
    expect(shouldProposeGrow(GROW_THRESHOLD - 1)).toBe(false);
    expect(shouldProposeGrow(GROW_THRESHOLD)).toBe(true);
  });
});

describe("shouldProposeDelete", () => {
  it("does not propose one below the threshold, and does propose at it", () => {
    expect(shouldProposeDelete({ reached: DELETE_THRESHOLD - 1, refuted: 0 })).toBe(false);
    expect(shouldProposeDelete({ reached: DELETE_THRESHOLD, refuted: 0 })).toBe(true);
  });

  it("never proposes once anything has ever been refuted, whatever the reached count", () => {
    expect(shouldProposeDelete({ reached: DELETE_THRESHOLD, refuted: 1 })).toBe(false);
    expect(shouldProposeDelete({ reached: DELETE_THRESHOLD * 10, refuted: 1 })).toBe(false);
  });
});

describe("the markers", () => {
  it("round-trip the count they were written with, per direction", () => {
    expect(markedCount(countMarker("grow", 3), "grow")).toBe(3);
    expect(markedCount(countMarker("delete", 20), "delete")).toBe(20);
  });

  it("never cross-match the other direction's marker", () => {
    expect(markedCount(countMarker("grow", 3), "delete")).toBeUndefined();
    expect(markedCount(countMarker("delete", 20), "grow")).toBeUndefined();
  });
});

describe("the signal bodies", () => {
  it("name the count and the marker", () => {
    expect(growIssueBody(3)).toContain("**3**");
    expect(growIssueBody(3)).toContain(countMarker("grow", 3));

    const body = deleteIssueBody({ reached: 20, refuted: 0 });
    expect(body).toContain("**20**");
    expect(body).toContain("**0**");
    expect(body).toContain(countMarker("delete", 20));
  });
});

/** A `gh` stand-in recording every argv verbatim, the shape `bypass-counter.test.ts`'s `fakeGh` already has. */
function fakeGh(options: {
  findingIssues?: Array<{ number: number; state: string; stateReason?: string; createdAt: string }>;
  signals?: Array<{ number: number; body: string; state: string; stateReason?: string }>;
}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list" && args.includes("--label")) {
      return JSON.stringify(options.findingIssues ?? []);
    }
    if (args[0] === "issue" && args[1] === "list") {
      return JSON.stringify(options.signals ?? []);
    }
    if (args[0] === "issue" && args[1] === "create") {
      return "https://github.com/owner/repo/issues/42\n";
    }
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };
  return { gh, calls };
}

function findings(count: number, over: Partial<{ state: string; stateReason: string; createdAt: string }> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    state: "CLOSED",
    stateReason: "NOT_PLANNED",
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  }));
}

describe("runCounter", () => {
  it("proposes neither direction below both thresholds", () => {
    const fake = fakeGh({ findingIssues: findings(GROW_THRESHOLD - 1) });

    const outcome = runCounter({ gh: fake.gh, tally: { reached: 0, refuted: 0 }, assignee: "collod873", now: NOW });

    expect(outcome.grow).toEqual({ code: "below-threshold" });
    expect(outcome.delete).toEqual({ code: "below-threshold" });
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
  });

  it("proposes a second refuter at the grow threshold", () => {
    const fake = fakeGh({ findingIssues: findings(GROW_THRESHOLD) });

    const outcome = runCounter({ gh: fake.gh, tally: { reached: 0, refuted: 0 }, assignee: "collod873", now: NOW });

    expect(outcome.grow).toMatchObject({ code: "proposed", issue: 42 });
    const create = fake.calls.find(
      (argv) => argv[0] === "issue" && argv[1] === "create" && argv.includes(GROW_ISSUE_TITLE),
    )!;
    expect(create).toBeDefined();
    expect(create[create.indexOf("--assignee") + 1]).toBe("collod873");
    expect(create[create.indexOf("--body") + 1]).toContain(countMarker("grow", GROW_THRESHOLD));
  });

  it("proposes the fleet's deletion at the delete threshold with zero ever refuted", () => {
    const fake = fakeGh({});

    const outcome = runCounter({
      gh: fake.gh,
      tally: { reached: DELETE_THRESHOLD, refuted: 0 },
      assignee: "collod873",
      now: NOW,
    });

    expect(outcome.delete).toMatchObject({ code: "proposed", issue: 42 });
    const create = fake.calls.find(
      (argv) => argv[0] === "issue" && argv[1] === "create" && argv.includes(DELETE_ISSUE_TITLE),
    )!;
    expect(create).toBeDefined();
    expect(create[create.indexOf("--body") + 1]).toContain(countMarker("delete", DELETE_THRESHOLD));
  });

  it("does not propose deletion one below the delete threshold", () => {
    const fake = fakeGh({});

    const outcome = runCounter({
      gh: fake.gh,
      tally: { reached: DELETE_THRESHOLD - 1, refuted: 0 },
      assignee: "collod873",
      now: NOW,
    });

    expect(outcome.delete).toEqual({ code: "below-threshold" });
  });

  it("does not propose deletion at the threshold if anything was ever refuted", () => {
    const fake = fakeGh({});

    const outcome = runCounter({
      gh: fake.gh,
      tally: { reached: DELETE_THRESHOLD, refuted: 1 },
      assignee: "collod873",
      now: NOW,
    });

    expect(outcome.delete).toEqual({ code: "below-threshold" });
  });

  it("does not double-propose while a grow proposal already stands open", () => {
    const fake = fakeGh({
      findingIssues: findings(GROW_THRESHOLD + 1),
      signals: [{ number: 7, body: `earlier\n${countMarker("grow", GROW_THRESHOLD)}`, state: "OPEN" }],
    });

    const outcome = runCounter({ gh: fake.gh, tally: { reached: 0, refuted: 0 }, assignee: "collod873", now: NOW });

    expect(outcome.grow).toMatchObject({ code: "already-proposed", issue: 7 });
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
  });

  it("never re-proposes a grow declined not planned, however far the count grows", () => {
    const fake = fakeGh({
      findingIssues: findings(GROW_THRESHOLD + 10),
      signals: [
        { number: 7, body: `refused\n${countMarker("grow", GROW_THRESHOLD)}`, state: "CLOSED", stateReason: "NOT_PLANNED" },
      ],
    });

    const outcome = runCounter({ gh: fake.gh, tally: { reached: 0, refuted: 0 }, assignee: "collod873", now: NOW });

    expect(outcome.grow).toMatchObject({ code: "declined-for-good", issue: 7 });
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
  });

  it("does not re-propose a declined grow at the same count it was declined at", () => {
    const fake = fakeGh({
      findingIssues: findings(GROW_THRESHOLD),
      signals: [{ number: 7, body: `declined\n${countMarker("grow", GROW_THRESHOLD)}`, state: "CLOSED", stateReason: "COMPLETED" }],
    });

    const outcome = runCounter({ gh: fake.gh, tally: { reached: 0, refuted: 0 }, assignee: "collod873", now: NOW });

    expect(outcome.grow).toEqual({ code: "declined-and-not-grown", declinedAt: GROW_THRESHOLD });
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
  });

  it("re-proposes a declined grow once the count has grown past what it recorded", () => {
    const fake = fakeGh({
      findingIssues: findings(GROW_THRESHOLD + 1),
      signals: [{ number: 7, body: `declined\n${countMarker("grow", GROW_THRESHOLD)}`, state: "CLOSED", stateReason: "COMPLETED" }],
    });

    const outcome = runCounter({ gh: fake.gh, tally: { reached: 0, refuted: 0 }, assignee: "collod873", now: NOW });

    expect(outcome.grow).toMatchObject({ code: "proposed", issue: 42 });
  });

  it("keeps the two directions' proposals independent — grow declined does not block delete", () => {
    const fake = fakeGh({
      findingIssues: findings(0),
      signals: [{ number: 7, body: `refused\n${countMarker("grow", GROW_THRESHOLD)}`, state: "CLOSED", stateReason: "NOT_PLANNED" }],
    });

    const outcome = runCounter({
      gh: fake.gh,
      tally: { reached: DELETE_THRESHOLD, refuted: 0 },
      assignee: "collod873",
      now: NOW,
    });

    expect(outcome.delete).toMatchObject({ code: "proposed", issue: 42 });
  });

  it("only ever calls gh issue create, and never close or reopen, in either direction", () => {
    const fake = fakeGh({ findingIssues: findings(GROW_THRESHOLD + 5) });

    runCounter({ gh: fake.gh, tally: { reached: DELETE_THRESHOLD + 5, refuted: 0 }, assignee: "collod873", now: NOW });

    for (const argv of fake.calls) {
      if (argv[0] !== "issue") continue;
      expect(["list", "create"]).toContain(argv[1]);
    }
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create")).toBe(true);
  });

  it("reads finding issues scoped to the finding label", () => {
    const fake = fakeGh({ findingIssues: findings(1) });

    runCounter({ gh: fake.gh, tally: { reached: 0, refuted: 0 }, assignee: "collod873", now: NOW });

    const list = fake.calls.find((argv) => argv.includes("--label"));
    expect(list).toBeDefined();
    expect(list![list!.indexOf("--label") + 1]).toBe(FINDING_LABEL);
  });
});
