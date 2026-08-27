import { describe, expect, it } from "vitest";
import { createFakeStage } from "../shared/stage.fake";
import { runSpecCritic, SPEC_CRITIC_MODEL } from "./critic";

const DRAFT = {
  title: "A spec",
  body: "The whole statement of the work, with a criterion nobody can observe.",
};

const RESPONSE = JSON.stringify({
  findings: ["\"handles errors gracefully\" admits two implementations and names no observable check."],
});

describe("runSpecCritic", () => {
  it("runs on the Opus model, with the draft's title and body substituted into the prompt", async () => {
    const fake = createFakeStage(RESPONSE);

    await runSpecCritic(fake.exec, DRAFT);

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--model") + 1]).toBe(SPEC_CRITIC_MODEL);
    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain(DRAFT.title);
    expect(prompt).toContain(DRAFT.body);
  });

  it("returns the response parsed as a list of findings", async () => {
    const fake = createFakeStage(RESPONSE);

    await expect(runSpecCritic(fake.exec, DRAFT)).resolves.toEqual({
      findings: ["\"handles errors gracefully\" admits two implementations and names no observable check."],
    });
  });

  it("returns an empty findings list when the critic agrees", async () => {
    const fake = createFakeStage(JSON.stringify({ findings: [] }));

    await expect(runSpecCritic(fake.exec, DRAFT)).resolves.toEqual({ findings: [] });
  });
});
