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
