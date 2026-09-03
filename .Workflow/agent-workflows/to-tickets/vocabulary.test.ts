import { describe, expect, it } from "vitest";
import { promptHandedTo } from "./checkpoint.fixture";
import { STAGES, vocabulary, type StageName } from "./to-tickets";

describe("no to-tickets stage reads CONTEXT.md", () => {
  it.each(Object.keys(STAGES) as StageName[])("%s takes the vocabulary by injection", async (stage) => {
    const prompt = await promptHandedTo(stage);

    expect(prompt).toContain(vocabulary());
    expect(prompt).not.toContain("CONTEXT.md");
    expect(prompt).not.toContain("{{");
  });

  it("withholds the vocabulary file's own header, which names CONTEXT.md", () => {
    expect(vocabulary()).not.toContain("CONTEXT.md");
    expect(vocabulary()).toContain("**Slice**:");
  });
});
