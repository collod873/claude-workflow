import { describe, expect, it } from "vitest";
import { gatesThisRun } from "./gate";

describe("#519: the gate reads whether the claim survived its own judgement", () => {
  it("refuses to run against a claim the immutability judgement turned down", () => {
    expect(gatesThisRun("failure")).toBe(false);
  });

  it.each(["success", "skipped", "cancelled", ""])("runs when that judgement ended %s, as the condition it replaces did", (result) => {
    expect(gatesThisRun(result)).toBe(true);
  });
});
