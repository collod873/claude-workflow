import { describe, expect, it } from "vitest";
import { type Action, type IssueState, reconcile } from "./reconcile.ts";

const REPO = "collod873/Lumaria";
const blocker = (open: boolean) => ({ repo: "collod873/design-kit", number: 7, open });
const ticket = (labels: string[], blockers: IssueState["blockers"]): IssueState => ({ repo: REPO, number: 931, labels, blockers });

const applied = (states: IssueState[], actions: Action[]): IssueState[] =>
  states.map((state) => {
    const mine = actions.flatMap((action) => ("label" in action && action.repo === state.repo && action.number === state.number ? [action] : []));
    const removed = new Set(mine.filter(({ kind }) => kind === "remove-label").map(({ label }) => label));
    const added = mine.filter(({ kind }) => kind === "add-label").map(({ label }) => label);
    return { ...state, labels: [...state.labels.filter((label) => !removed.has(label)), ...added] };
  });

describe("reconcile projects the blocked-by state onto the waiting label (#1606)", () => {
  it("wakes a waiting ticket whose blockers have all closed, even one closed before it was parked", () => {
    expect(reconcile([ticket(["ticket", "waiting"], [blocker(false), { ...blocker(false), number: 8 }])])).toEqual([{ kind: "remove-label", repo: REPO, number: 931, label: "waiting" }]);
  });

  it("parks a ticket with an open blocker", () => {
    expect(reconcile([ticket(["ticket"], [blocker(false), blocker(true)])])).toEqual([{ kind: "add-label", repo: REPO, number: 931, label: "waiting" }]);
  });

  it.each([
    ["a waiting ticket with no blocked-by links", ticket(["ticket", "waiting"], [])],
    ["a ticket with no blocked-by links", ticket(["ticket"], [])],
    ["a waiting ticket with an open blocker", ticket(["ticket", "waiting"], [blocker(true)])],
    ["an unparked ticket whose blockers closed", ticket(["ticket"], [blocker(false)])],
  ])("leaves %s untouched", (_, state) => {
    expect(reconcile([state])).toEqual([]);
  });

  it("does nothing more on a second pass over the states the first produced", () => {
    const states = [ticket(["ticket", "waiting"], [blocker(false)]), { ...ticket(["ticket"], [blocker(true)]), number: 932 }];
    const first = reconcile(states);

    expect(first).toHaveLength(2);
    expect(reconcile(applied(states, first))).toEqual([]);
  });
});

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const building = (over: Partial<IssueState> = {}): IssueState => ({ ...ticket(["ticket", "building"], []), buildingSince: NOW - HOUR - 1, liveRun: false, restarted: false, ...over });

describe("reconcile restarts a stale build once, then flags it to the owner (#1606)", () => {
  it("restarts a ticket building for over an hour with no live run, flags it after one restart, then does nothing more", () => {
    expect(reconcile([building()], NOW)).toEqual([{ kind: "restart", repo: REPO, number: 931 }]);
    expect(reconcile([building({ restarted: true })], NOW)).toEqual([{ kind: "flag", repo: REPO, number: 931 }]);
    expect(reconcile([building({ restarted: true, labels: ["ticket", "building", "stuck"] })], NOW)).toEqual([]);
  });

  it.each([
    ["with a live run", building({ liveRun: true })],
    ["for under an hour", building({ buildingSince: NOW - HOUR + 1000 })],
  ])("leaves a ticket building %s alone", (_, state) => {
    expect(reconcile([state], NOW)).toEqual([]);
  });
});

const refused = (admissible: boolean): IssueState => ({ ...ticket(["ticket"], []), refused: true, admissible });
const readmitted = (states: IssueState[], actions: Action[]): IssueState[] =>
  states.map((state) => (actions.some(({ kind, number }) => kind === "admit" && number === state.number) ? { ...state, refused: false } : state));

describe("reconcile re-admits a refused ticket once its chain is valid (#1606)", () => {
  it("admits a refused ticket whose chain is valid now, leaves one still invalid alone, and does nothing more on a second pass", () => {
    const states = [refused(true), { ...refused(false), number: 932 }];
    const first = reconcile(states);

    expect(first).toEqual([{ kind: "admit", repo: REPO, number: 931 }]);
    expect(reconcile(readmitted(states, first))).toEqual([]);
  });

  it.each([
    ["building", refused(true).labels.concat("building")],
    ["held", ["ticket", "paused"]],
  ])("leaves a refused ticket %s alone", (_, labels) => {
    expect(reconcile([{ ...refused(true), labels }])).toEqual([]);
  });
});

const MEZZANINE = "collod873/Mezzanine";
const wait = { repo: MEZZANINE, count: 3, afterRepo: "collod873/agent-hooks", sha: "da77e6c" };
const checked = (runs: number[], blockers: IssueState["blockers"] = []): IssueState => ({ ...ticket(["ticket", "waiting"], blockers), checks: { wait, runs } });

describe("reconcile holds a ticket waiting on another repo's full checks until that many have run (#1648)", () => {
  it("keeps it waiting while fewer have run, even with every blocker closed", () => {
    expect(reconcile([checked([11, 12], [blocker(false)])])).toEqual([]);
  });

  it("parks a ticket with a checks wait not yet met", () => {
    expect(reconcile([{ ...checked([]), labels: ["ticket"] }])).toEqual([{ kind: "add-label", repo: REPO, number: 931, label: "waiting" }]);
  });

  it("records the first runs that met it, then wakes it", () => {
    expect(reconcile([checked([11, 12, 13, 14])])).toEqual([
      { kind: "waited", repo: REPO, number: 931, wait, runs: [11, 12, 13] },
      { kind: "remove-label", repo: REPO, number: 931, label: "waiting" },
    ]);
  });

  it("keeps it waiting on an open blocker once its checks have run", () => {
    expect(reconcile([checked([11, 12, 13], [blocker(true)])])).toEqual([{ kind: "waited", repo: REPO, number: 931, wait, runs: [11, 12, 13] }]);
  });

  it("wakes a waiting ticket whose checks wait was recorded met before its wake was lost", () => {
    expect(reconcile([{ ...ticket(["ticket", "waiting"], []), waited: true }])).toEqual([{ kind: "remove-label", repo: REPO, number: 931, label: "waiting" }]);
  });
});

const RESET = Date.parse("2026-11-10T09:20:00Z");
const accountBound = (labels: string[]): IssueState => ({ ...ticket(labels, []), number: 2772, accountsBack: RESET });

describe("reconcile holds an issue whose every Claude account refused its hire until the time they come back (#1765)", () => {
  it("keeps it waiting before the reset, then takes waiting off on the first pass after it", () => {
    expect(reconcile([accountBound(["spec", "waiting"])], RESET - 60_000)).toEqual([]);
    expect(reconcile([accountBound(["spec", "waiting"])], RESET + 60_000)).toEqual([{ kind: "remove-label", repo: REPO, number: 2772, label: "waiting" }]);
  });

  it("leaves an issue alone once its reset has passed and it was woken", () => {
    expect(reconcile([accountBound(["spec"])], RESET + 60_000)).toEqual([]);
  });
});

describe("reconcile closes a ticket whose PR merged but stayed open, where Mezzanine#2426 sat checking after #2434 merged", () => {
  it("closes a checking ticket naming its merged PR, and leaves one with no merged PR alone", () => {
    expect(reconcile([{ ...ticket(["ticket", "checking"], []), merged: 2434 }, { ...ticket(["ticket", "checking"], []), number: 932 }])).toEqual([{ kind: "close", repo: REPO, number: 931, pr: 2434 }]);
  });
});
