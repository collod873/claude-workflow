import { describe, expect, it } from "vitest";
import { createFakeStage } from "../shared/stage.fake";
import { SPEC_AUTHOR_ALLOWED_TOOLS, type DecidedContext } from "./spec";
import { applySweep, renderSweepRulings, runSpecSweep, type SpecSweep } from "./sweep";

const CONTEXT: DecidedContext = {
  ownerWords: "the owner's words",
  decisions: "a decision, with its reason",
  rulings: "- docs/adr/0060-only-the-accepted-sheet-cited-this-one.md",
  boundaries: "a boundary",
  openGuesses: "none yet",
};

const FOUND: SpecSweep = {
  rulings: [
    {
      ref: "docs/adr/0104-the-sweep-reads-the-record-the-collectors-forgot.md",
      quote: "no upstream sheet or map ever cited this line",
    },
  ],
};

describe("runSpecSweep", () => {
  it("runs on claude-haiku-4-5-20251001, the same cheap tier lane 01's own sweep runs on", async () => {
    const fake = createFakeStage(JSON.stringify(FOUND));

    await runSpecSweep(fake.exec, CONTEXT);

    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--model") + 1]).toBe("claude-haiku-4-5-20251001");
  });

  it("reads the author's own exported allow-list rather than a list of its own", async () => {
    const fake = createFakeStage(JSON.stringify(FOUND));

    await runSpecSweep(fake.exec, CONTEXT);

    const [argv] = fake.calls;
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe(SPEC_AUTHOR_ALLOWED_TOOLS.join(","));
    expect(argv).not.toContain("--disallowedTools");
  });

  it("substitutes the context's own words, decisions, boundaries and open guesses — never its rulings", async () => {
    const fake = createFakeStage(JSON.stringify(FOUND));

    await runSpecSweep(fake.exec, CONTEXT);

    const prompt = fake.stdins[0] ?? "";
    const substituted = [CONTEXT.ownerWords, CONTEXT.decisions, CONTEXT.boundaries, CONTEXT.openGuesses];
    for (const field of substituted) expect(prompt).toContain(field);
    // The field this stage exists to replace is not itself an input to it.
    expect(prompt).not.toContain(CONTEXT.rulings);
  });

  it("returns whatever it found, parsed", async () => {
    const fake = createFakeStage(JSON.stringify(FOUND));

    await expect(runSpecSweep(fake.exec, CONTEXT)).resolves.toEqual(FOUND);
  });
});

describe("applySweep", () => {
  it("replaces the collector's rulings rather than appending to them", () => {
    const result = applySweep(CONTEXT, FOUND);

    expect(result.rulings).not.toContain(CONTEXT.rulings);
    expect(result.rulings).toContain("docs/adr/0104-the-sweep-reads-the-record-the-collectors-forgot.md");
  });

  it("hands a ruling no upstream sheet or map cited to the author, as rulings", () => {
    // Nothing in the collector's own rulings mentions the sweep's find — it is entirely the
    // sweep's own, and the replace is the only way it reaches the author.
    expect(CONTEXT.rulings).not.toContain("no upstream sheet or map ever cited this line");

    const result = applySweep(CONTEXT, FOUND);

    expect(result.rulings).toContain("no upstream sheet or map ever cited this line");
  });

  it("leaves every other field of the Decided context untouched", () => {
    const result = applySweep(CONTEXT, FOUND);

    expect(result.ownerWords).toBe(CONTEXT.ownerWords);
    expect(result.decisions).toBe(CONTEXT.decisions);
    expect(result.boundaries).toBe(CONTEXT.boundaries);
    expect(result.openGuesses).toBe(CONTEXT.openGuesses);
  });

  it("says so plainly, and still replaces, when the sweep found nothing", () => {
    const result = applySweep(CONTEXT, { rulings: [] });

    expect(result.rulings).not.toContain(CONTEXT.rulings);
    expect(result.rulings.length).toBeGreaterThan(0);
  });
});

describe("renderSweepRulings", () => {
  it("renders each finding in lane 01's own PriorArt shape — a citation and the line it quotes", () => {
    const rendered = renderSweepRulings(FOUND.rulings);

    expect(rendered).toContain(FOUND.rulings[0]!.ref);
    expect(rendered).toContain(FOUND.rulings[0]!.quote);
  });

  it("says nothing was found, legally, rather than rendering an empty section", () => {
    expect(renderSweepRulings([])).not.toBe("");
  });
});
