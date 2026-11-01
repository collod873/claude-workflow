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
