import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeGh } from "../shared/gh.fake";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import { CLAIM_LIMIT } from "../shared/ticket-shape";
import { checkpointPath } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { runNamedStage, ticketFormat } from "./to-tickets";

async function promptHandedToSlice(): Promise<string> {
  withHandoffDir();
  mkdirSync(dirname(checkpointPath("seam-sweep")), { recursive: true });
  writeFileSync(
    checkpointPath("seam-sweep"),
    JSON.stringify({ key: "test", response: JSON.stringify({ entries: ["a seam"] }) }),
    "utf8",
  );
  const fake = createFakeStage(JSON.stringify({ slices: [slice({ title: "One slice" })] }));

  await runNamedStage("slice", "13", fake.exec, createFakeGh().gh);

  return fake.calls[0][1];
}

describe("the slicer takes the ticket contract by injection", () => {
  it("ticketFormat() reads docs/agents/ticket-format.md's spec-sub-issue variant", () => {
    const format = ticketFormat();
    expect(format).toContain("### Spec sub-issue");
    expect(format).toContain("## Acceptance criteria");
    expect(format).toContain("## Files claimed");
    expect(format).not.toContain("Local-file ticket");
    expect(format).not.toContain("Wayfinder decision");
  });

  it("carries the core's criteria and claim rules, not only the text above its first subheading", () => {
    expect(ticketFormat()).toContain("claimLimit");
    expect(ticketFormat()).toContain("bash -c");
  });

  it("hands the slicer the contract itself, with no placeholder left unrendered", async () => {
    const prompt = await promptHandedToSlice();

    expect(prompt).toContain(ticketFormat());
    expect(prompt).not.toContain("{{");
  });
});

describe("the claim ceiling the publisher enforces is the one the prompts state", () => {
  const promptPath = (stage: string) => resolve(__dirname, stage, "prompt.md");

  it.each(["slice", "audit"])("%s names CLAIM_LIMIT rather than a number of its own", (stage) => {
    const prompt = readFileSync(promptPath(stage), "utf8");

    expect(prompt).toContain("claimLimit");
    expect(prompt).not.toContain(`at most ${CLAIM_LIMIT} paths`);
    expect(
      prompt,
      "a prompt telling the model there is no ceiling is what published #538's ten-file slice",
    ).not.toContain("no ceiling on how many files");
  });
});
