import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/author/prompt.md";

/**
 * The owner's check-sentence rule, pinned verbatim as the third non-negotiable. A paraphrase edit
 * that keeps the idea but drops the "single check-marked criterion, or an open question if it
 * can't be mechanised" clause would still read fine to a human — this is what would catch it.
 */
const CHECK_SENTENCE_RULE =
  '**The owner\'s "I\'ll know it works when I can ___" sentence becomes the\n' +
  "spec's single check-marked criterion, or an open question if it can't be\n" +
  "mechanised.** Where he said how he will know the work is done, quote that\n" +
  "sentence and give it the one acceptance criterion carrying a check-mark,\n" +
  "in the shape `<what is observably true> — check: <one command>`. If it\n" +
  "cannot be turned into a single mechanised check, do not invent one —\n" +
  "raise it as an open question instead.";

describe("the spec author's prompt pins the owner's check-sentence rule", () => {
  const prompt = readFileSync(PROMPT_PATH, "utf8");

  it("carries the rule's exact text", () => {
    expect(prompt).toContain(CHECK_SENTENCE_RULE);
  });

  it("heads the section as non-negotiables without claiming there are two", () => {
    const heading = prompt.split("\n").find((line) => /^##\s.*non-negotiable/i.test(line));
    expect(heading, "no non-negotiables heading found").toBeDefined();
    expect(heading as string).not.toMatch(/\btwo\b/i);
  });

  it("quotes the owner's \"I'll know it works when I can ___\" sentence", () => {
    expect(prompt).toMatch(/I'll know it works when I can/);
  });

  it("ties that sentence to the spec's single check-marked criterion", () => {
    expect(prompt).toMatch(/check:/);
    expect(prompt).toMatch(/criteri(on|a)/i);
    expect(prompt).toMatch(/single/i);
  });

  it("tells an author who cannot mechanise it to raise an open question instead", () => {
    expect(prompt).toMatch(/open question/i);
  });
});
