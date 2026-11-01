import { describe, expect, it } from "vitest";
import { type Action, type IssueState, reconcile } from "./reconcile.ts";

const REPO = "collod873/Lumaria";
const blocker = (open: boolean) => ({ repo: "collod873/design-kit", number: 7, open });
const ticket = (labels: string[], blockers: IssueState["blockers"]): IssueState => ({ repo: REPO, number: 931, labels, blockers });

const applied = (states: IssueState[], actions: Action[]): IssueState[] =>
  states.map((state) => {
    const mine = actions.filter((action) => action.repo === state.repo && action.number === state.number);
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
