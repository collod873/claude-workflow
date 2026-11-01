import { describe, expect, it } from "vitest";
import { ELSEWHERE, HERE, linking } from "./reconcile.part.ts";

const edits = (calls: string[][]) => calls.filter((args) => args[0] === "issue" && args[1] === "edit");

describe("bin/reconcile applies the waiting projection of each open ticket's blockers (#1606)", () => {
  it("unlabels a waiting ticket whose cross-repo blocker closed and labels one with an open blocker, leaving an unlinked one alone", () => {
    const { reconcile, calls } = linking({
      tickets: [
        { number: 931, labels: ["ticket", "waiting"], blockers: [{ repo: ELSEWHERE, number: 7, state: "closed" }] },
        { number: 932, labels: ["ticket"], blockers: [{ repo: HERE, number: 5, state: "open" }] },
        { number: 933, labels: ["ticket", "waiting"], blockers: [] },
      ],
    });

    const result = reconcile();

    expect(result.status, result.stderr).toBe(0);
    expect(edits(calls())).toEqual([
      ["issue", "edit", "931", "--repo", HERE, "--remove-label", "waiting"],
      ["issue", "edit", "932", "--repo", HERE, "--add-label", "waiting"],
    ]);
  });

  it("fails red naming the ticket when the label edit is refused", () => {
    const result = linking({ refused: true, tickets: [{ number: 932, labels: ["ticket"], blockers: [{ repo: HERE, number: 5, state: "open" }] }] }).reconcile();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${HERE}#932 could not be labelled waiting`);
  });
});

describe("bin/issue-links reads and adds blocked-by links and sub-issue parents across repos (#1606)", () => {
  it("reads a ticket's blockers with the repo each lives in", () => {
    const { links } = linking({ tickets: [{ number: 931, labels: [], blockers: [{ repo: ELSEWHERE, number: 7, state: "closed" }] }] });

    expect(links("blockers", HERE, "931").stdout).toBe(`${JSON.stringify([{ repo: ELSEWHERE, number: 7, open: false }])}\n`);
  });

  it("adds a blocker from another repo by its issue id", () => {
    const { links, calls } = linking();

    expect(links("add-blocker", HERE, "931", ELSEWHERE, "7").status).toBe(0);
    expect(calls()).toEqual([
      ["api", `repos/${ELSEWHERE}/issues/7`, "--jq", ".id"],
      ["api", "--method", "POST", `repos/${HERE}/issues/931/dependencies/blocked_by`, "-F", "issue_id=4242"],
    ]);
  });

  it("files a ticket under a parent in another repo by the ticket's issue id", () => {
    const { links, calls } = linking();

    expect(links("add-parent", HERE, "931", ELSEWHERE, "12").status).toBe(0);
    expect(calls()).toEqual([
      ["api", `repos/${HERE}/issues/931`, "--jq", ".id"],
      ["api", "--method", "POST", `repos/${ELSEWHERE}/issues/12/sub_issues`, "-F", "sub_issue_id=4242"],
    ]);
  });

  it.each([
    ["its parent in another repo", false, `${JSON.stringify({ repo: ELSEWHERE, number: 12, open: true })}\n`],
    ["null for a ticket with no parent", true, "null\n"],
  ])("reads %s", (_, parentless, said) => {
    expect(linking({ parentless }).links("parent", HERE, "931").stdout).toBe(said);
  });
});
