import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PROMPT_PATH = ".Workflow/agent-workflows/to-tickets/slice/prompt.md";

/**
 * The wave-0-is-a-tracer rule, pinned verbatim. A paraphrase edit that keeps the same idea but
 * loses the "never a wiring slice" / "never a bare seam slice" negations would still read fine to
 * a human — this is what would catch it.
 */
const WAVE_ZERO_RULE =
  "4. Wave 0 — the unblocked root, every slice you draw with no `dependsOn` — is a tracer: it has to trace the thinnest possible end-to-end path through every layer the work touches, stubs expected wherever a full implementation would cost the wave its thinness. Wave 0 is never a wiring slice that only connects layers with nothing behind them, and it is never a bare seam slice that ships an abstraction with no consumer proving it end-to-end.";

describe("the slicer's prompt pins the wave-0-is-a-tracer rule", () => {
  const prompt = readFileSync(PROMPT_PATH, "utf8");

  it("carries the rule's exact text", () => {
    expect(prompt).toContain(WAVE_ZERO_RULE);
  });

  it("names the first wave and defines it as the thinnest end-to-end path through every layer", () => {
    expect(prompt).toMatch(/wave 0/i);
    expect(prompt).toMatch(/unblocked root/i);
    expect(prompt).toMatch(/thinnest/i);
    expect(prompt).toMatch(/end-to-end/i);
    expect(prompt).toMatch(/\blayer/i);
  });

  it("says stubs are expected in that wave", () => {
    expect(prompt).toMatch(/stub/i);
  });

  it("rejects a wiring slice as the first wave", () => {
    expect(prompt).toMatch(/never a wiring slice/i);
  });

  it("rejects a bare seam slice as the first wave", () => {
    expect(prompt).toMatch(/never a bare seam slice/i);
  });
});
