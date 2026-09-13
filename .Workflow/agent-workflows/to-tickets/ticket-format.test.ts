import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIM_LIMIT } from "../shared/ticket-shape";
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

describe("the claim ceiling the publisher enforces is the one the prompts state", () => {
  const promptPath = (stage: string) => resolve(__dirname, stage, "prompt.md");

  it.each(["slice", "audit"])("%s names CLAIM_LIMIT rather than a number of its own", (stage) => {
    const prompt = readFileSync(promptPath(stage), "utf8");

    expect(prompt).toContain(`at most ${CLAIM_LIMIT} paths`);
    expect(
      prompt,
      "a prompt telling the model there is no ceiling is what published #538's ten-file slice",
    ).not.toContain("no ceiling on how many files");
  });
});
