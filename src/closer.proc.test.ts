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
