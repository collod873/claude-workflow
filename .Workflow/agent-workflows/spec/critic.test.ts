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

  it("substitutes the owner's answering comments as the prompt's third variable", async () => {
    // The critic-only door has no author to re-draft the body, so a re-run against unchanged
    // text would report the same findings forever and the count could never fall. The answers
    // are what let this stage see a finding as answered.
    const fake = createFakeStage(RESPONSE);

    await runSpecCritic(fake.exec, {
      ...DRAFT,
      answers: ["Done means the gauntlet exits 0.", "Yes — only the owner may fire it."],
    });

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).toContain("Done means the gauntlet exits 0.");
    expect(prompt).toContain("Yes — only the owner may fire it.");
  });

  it("substitutes a stated absence when no answers were passed, never an empty hole", async () => {
    // `runStage` throws on an unsubstituted `{{VAR}}`, so the author's own call — which has no
    // answers to pass — must still resolve the variable to something the critic can read.
    const fake = createFakeStage(RESPONSE);

    await runSpecCritic(fake.exec, DRAFT);

    const prompt = fake.stdins[0] ?? "";
    expect(prompt).not.toContain("{{ANSWERS}}");
    expect(prompt).toMatch(/nothing has been answered/i);
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
