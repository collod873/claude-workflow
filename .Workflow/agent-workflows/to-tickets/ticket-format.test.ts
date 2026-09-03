import { describe, expect, it } from "vitest";
import { promptHandedTo } from "./checkpoint.fixture";
import { ticketFormat } from "./to-tickets";

/**
 * §3 of #226: the ticket contract is written down once, in `docs/agents/ticket-format.md`, and
 * every producer takes it by injection rather than restating it — the restatement is exactly what
 * let `/wayfinder`'s template drift out of sync with the parser it feeds. This pins the slice
 * stage's half of that: `ticketFormat()` cuts the doc to the one variant this lane publishes, and
 * the prompt the slicer is actually handed carries it — rendered through the real stage, since
 * what a `{{TICKET_FORMAT}}` placeholder was substituted with is only visible there.
 */

describe("the slicer takes the ticket contract by injection", () => {
  it("ticketFormat() reads docs/agents/ticket-format.md's spec-sub-issue variant", () => {
    const format = ticketFormat();
    expect(format).toContain("### Spec sub-issue");
    expect(format).toContain("## Acceptance criteria");
    expect(format).toContain("## Files claimed");
    // Never a variant this lane doesn't publish.
    expect(format).not.toContain("Local-file ticket");
    expect(format).not.toContain("Wayfinder decision");
  });

  it("hands the slicer the contract itself, with no placeholder left unrendered", async () => {
    const prompt = await promptHandedTo("slice");

    expect(prompt).toContain(ticketFormat());
    expect(prompt).not.toContain("{{");
  });
});
