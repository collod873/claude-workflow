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
});
