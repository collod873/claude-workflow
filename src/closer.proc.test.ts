import { describe, expect, it } from "vitest";
import { closing } from "./scenarios.ts";

describe("bin/close closes a ticket only once its own checks prove it done on main (#808)", () => {
  it("closes a ticket whose checks pass on the merge commit", () => {
    const { calls, run } = closing({ ticket: "812", fixes: true });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n812\n"));
    expect(commented).toBeDefined();
    expect(commented).toContain("test -f built.txt");
    expect(commented).toContain("red at base");
    expect(commented).toContain("green at merge");
    expect(calls().some((call) => call.startsWith("issue\nclose\n812\n") || call.startsWith("issue\nclose\n812"))).toBe(true);
  });

  it("leaves open a ticket with a red check on the merge commit", () => {
    const { calls, run } = closing({ ticket: "813", fixes: false });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n813\n"));
    expect(commented).toBeDefined();
    expect(commented).toContain("test -f built.txt");
    expect(calls().some((call) => call.startsWith("issue\nclose\n813"))).toBe(false);
    expect(calls().some((call) => call.startsWith("issue\nreopen\n813"))).toBe(false);
  });
});

describe("bin/close names how long filing took to reach merged, and never gates on it (#809)", () => {
  it("carries a speed report from filing to merged, naming the longest wait, and still closes a ticket over an hour late", () => {
    const { calls, run } = closing({
      ticket: "814",
      fixes: true,
      timing: {
        filed: "2026-01-01T00:00:00Z",
        firstCommit: "2026-01-01T00:10:00Z",
        prOpened: "2026-01-01T01:40:00Z",
        checksGreen: "2026-01-01T01:45:00Z",
        merged: "2026-01-01T01:48:00Z",
      },
    });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n814\n"));
    expect(commented).toBeDefined();
    expect(commented).toMatch(/speed report/i);
    expect(commented).toMatch(/longest[^\n]*PR opened/i);
    expect(commented).toMatch(/\d+\s*(m|min|h|hour)/i);
    expect(calls().some((call) => call.startsWith("issue\nclose\n814"))).toBe(true);
  });

  it("dates the first commit by when it was written, so a rebase after the PR opened gives no negative wait", () => {
    const { calls, run } = closing({
      ticket: "816",
      timing: {
        filed: "2026-01-01T00:00:00Z",
        firstCommit: "2026-01-01T00:10:00Z",
        rebased: "2026-01-01T01:45:00Z",
        prOpened: "2026-01-01T01:40:00Z",
        checksGreen: "2026-01-01T01:50:00Z",
        merged: "2026-01-01T01:52:00Z",
      },
    });

    expect(run().status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n816\n"));
    expect(commented).toContain("first commit to PR opened: 1h 30m");
    expect(commented).not.toMatch(/: -\d/);
  });
});

describe("bin/close ends a done ticket closed as completed with no stage label (#851)", () => {
  it("re-closes as completed and strips the stage label, even when the merge finds the ticket already closed as not planned", () => {
    const { calls, tokens, run } = closing({ ticket: "817", fixes: true, closedAs: "NOT_PLANNED" });

    const result = run();

    expect(result.status).toBe(0);
    const reopened = calls().findIndex((call) => call.startsWith("issue\nreopen\n817"));
    const closed = calls().findIndex((call) => call.startsWith("issue\nclose\n817"));
    expect(reopened, "reopens the ticket before closing it as completed").toBeGreaterThanOrEqual(0);
    expect(closed).toBeGreaterThan(reopened);
    expect(calls()[closed]).toContain("completed");
    expect(tokens()[reopened], "reopens with the token that fires no workflow, so the fixer never hears of it").toBe("quiet");
    expect(tokens()[closed]).toBe("quiet");
    const stripped = calls().find((call) => call.includes("--remove-label"));
    expect(stripped, "strips its stage label").toBeDefined();
    const args = (stripped ?? "").split("\n");
    expect(args[args.indexOf("--remove-label") + 1]).not.toBe("");
  });

  it("leaves closed as completed a done ticket the merge already closed, reopening nothing", () => {
    const { calls, run } = closing({ ticket: "818", fixes: true, closedAs: "COMPLETED" });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.startsWith("issue\nreopen\n818"))).toBe(false);
    expect(calls().some((call) => call.includes("--remove-label"))).toBe(true);
  });
});

describe("bin/close brings ticket PRs left behind by a merge up to date, so auto-merge is never stuck in silence (#858)", () => {
  it("brings every open ticket PR up to date, as the App, so its checks run again and auto-merge can finish", () => {
    const { calls, tokens, run } = closing({
      ticket: "819",
      behindPrs: [
        { number: "901", ticket: "820" },
        { number: "902", ticket: "821" },
      ],
    });

    const result = run();

    expect(result.status).toBe(0);
    const first = calls().findIndex((call) => call.startsWith("pr\nupdate-branch\n901"));
    const second = calls().findIndex((call) => call.startsWith("pr\nupdate-branch\n902"));
    expect(first, "the first PR left behind by the merge is brought up to date").toBeGreaterThanOrEqual(0);
    expect(second, "the second PR left behind by the merge is brought up to date").toBeGreaterThanOrEqual(0);
    expect(tokens()[first], "runs as the App, so its checks run again").toBe("app");
    expect(tokens()[second]).toBe("app");
  });

  it("names on its ticket the reason a PR that cannot be brought up to date was left, instead of leaving it waiting in silence", () => {
    const { calls, run } = closing({
      ticket: "819",
      behindPrs: [{ number: "903", ticket: "822", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
    });

    const result = run();

    expect(result.status).toBe(0);
    const commented = calls().find((call) => call.startsWith("issue\ncomment\n822\n"));
    expect(commented, "the ticket behind the stuck PR is told why").toBeDefined();
    expect(commented).toContain("903");
    expect(commented).toContain("merge conflicts");
  });
});

describe("bin/close brings land PRs left behind by a merge up to date too, since the ruleset holds them the same way (#869)", () => {
  it("brings an open land PR up to date, as the App", () => {
    const { calls, tokens, run } = closing({ ticket: "819", behindPrs: [{ number: "904", ticket: "", branch: "land/0123456789ab" }] });

    expect(run().status).toBe(0);
    const updated = calls().findIndex((call) => call.startsWith("pr\nupdate-branch\n904"));
    expect(updated, "the land PR left behind by the merge is brought up to date").toBeGreaterThanOrEqual(0);
    expect(tokens()[updated]).toBe("app");
  });

  it("names on the land PR itself the reason it could not be brought up to date, since it has no ticket", () => {
    const { calls, run } = closing({
      ticket: "819",
      behindPrs: [{ number: "905", ticket: "", branch: "land/ba9876543210", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }],
    });

    expect(run().status).toBe(0);
    const commented = calls().find((call) => call.startsWith("pr\ncomment\n905\n"));
    expect(commented, "the land PR is told why").toBeDefined();
    expect(commented).toContain("merge conflicts");
    expect(calls().some((call) => call.startsWith("issue\ncomment\n\n"))).toBe(false);
  });

  it("leaves alone a PR from a branch the machine did not open", () => {
    const { calls, run } = closing({ ticket: "819", behindPrs: [{ number: "906", ticket: "", branch: "dependabot/npm_and_yarn/vitest-5.0.0" }] });

    expect(run().status).toBe(0);
    expect(calls().some((call) => call.includes("\n906"))).toBe(false);
  });
});

describe("bin/close wakes a ticket its fixer split once every follow-up it split into has merged (#910)", () => {
  const piece = (ticket: string) =>
    ["## Why", "", "Follow-up of #811: its fixer split it, since it does not fit one build.", "", "> The shape rules refuse a missing read by name.", "", "## Acceptance criteria", "", "- [ ] The fix lands - check: `test -f built.txt`", "", "## Files claimed", "", `- src/built-${ticket}.ts`, ""].join("\n");
  const said = "@collod873 the fixer split #811 into #812, #813, which build themselves. #811 keeps what must wait for them, labelled `waiting`, and builds once they all merge: see #889";
  const woken = (calls: string[]) => calls.findIndex((call) => call.trimEnd() === "issue\nedit\n811\n--remove-label\nwaiting");

  it("takes `waiting` off the split ticket, as the App so its build starts, when the last follow-up merges", () => {
    const { calls, tokens, run } = closing({ ticket: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "813": "CLOSED COMPLETED" } } });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(woken(calls())).toBeGreaterThanOrEqual(0);
    expect(tokens()[woken(calls())]).toBe("app");
    expect(result.stdout).toContain("#811 builds now");
  });

  it("leaves the split ticket waiting while a follow-up is still open, and never wakes one that is not waiting", () => {
    const early = closing({ ticket: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "waiting\n", said, siblings: { "813": "OPEN " } } });
    const unparked = closing({ ticket: "812", ticketBody: piece("812"), splitFrom: { parent: "811", labels: "fixing\n", said, siblings: { "813": "CLOSED COMPLETED" } } });

    const result = early.run();

    expect(result.status).toBe(0);
    expect(woken(early.calls())).toBe(-1);
    expect(result.stdout).toContain("#811 still waits for #813");
    expect(unparked.run().status).toBe(0);
    expect(woken(unparked.calls())).toBe(-1);
  });
});
