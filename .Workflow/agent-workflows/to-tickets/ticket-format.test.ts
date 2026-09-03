import { describe, expect, it } from "vitest";
import { promptHandedTo } from "./checkpoint.fixture";
import { ticketFormat } from "./to-tickets";

describe("the slicer takes the ticket contract by injection", () => {
  it("ticketFormat() reads docs/agents/ticket-format.md's spec-sub-issue variant", () => {
    const format = ticketFormat();
    expect(format).toContain("### Spec sub-issue");
    expect(format).toContain("## Acceptance criteria");
    expect(format).toContain("## Files claimed");
    expect(format).not.toContain("Local-file ticket");
    expect(format).not.toContain("Wayfinder decision");
  });

  it("hands the slicer the contract itself, with no placeholder left unrendered", async () => {
    const prompt = await promptHandedTo("slice");

    expect(prompt).toContain(ticketFormat());
    expect(prompt).not.toContain("{{");
  });
});
