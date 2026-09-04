import { describe, expect, it } from "vitest";
import { createFakeStage } from "../shared/stage.fake";
import { runSpecCritic, SPEC_CRITIC_MODEL } from "./critic";

const DRAFT = {
  title: "A spec",
  body: "The whole statement of the work, with a criterion nobody can observe.",
};

const RESPONSE = JSON.stringify({
  resolutions: [
    {
      decision: "\"Handles errors gracefully\" becomes \"returns a 400 on a malformed request.\"",
      reason: "The restatement already says malformed input is rejected; this is the observable version of it.",
    },
  ],
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

  it("substitutes the owner's answering comments as the prompt's third variable", async () => {
    const fake = createFakeStage(RESPONSE);

    await runSpecCritic(fake.exec, {
      ...DRAFT,
      answers: ["Done means the gauntlet exits 0.", "Yes, only the owner may fire it."],
    });

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain("Done means the gauntlet exits 0.");
    expect(prompt).toContain("Yes, only the owner may fire it.");
  });

  it("substitutes a stated absence when no answers were passed, never an empty hole", async () => {
    const fake = createFakeStage(RESPONSE);

    await runSpecCritic(fake.exec, DRAFT);

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).not.toContain("{{ANSWERS}}");
    expect(prompt).toMatch(/nothing has been answered/i);
  });

  it("returns the response parsed as a list of resolutions, each carrying a decision and a reason", async () => {
    const fake = createFakeStage(RESPONSE);

    await expect(runSpecCritic(fake.exec, DRAFT)).resolves.toEqual({
      resolutions: [
        {
          decision: "\"Handles errors gracefully\" becomes \"returns a 400 on a malformed request.\"",
          reason: "The restatement already says malformed input is rejected; this is the observable version of it.",
        },
      ],
    });
  });

  it("returns an empty resolutions list when the critic agrees", async () => {
    const fake = createFakeStage(JSON.stringify({ resolutions: [] }));

    await expect(runSpecCritic(fake.exec, DRAFT)).resolves.toEqual({ resolutions: [] });
  });

  it("refuses a resolution carrying a decision with no reason, or a reason with no decision", async () => {
    const fake = createFakeStage(
      JSON.stringify({ resolutions: [{ decision: "Pick reading A.", reason: "" }] }),
    );

    await expect(runSpecCritic(fake.exec, DRAFT)).rejects.toThrow();
  });
});
