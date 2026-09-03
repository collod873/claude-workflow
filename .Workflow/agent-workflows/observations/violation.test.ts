import { describe, expect, it } from "vitest";
import { parseViolationFindings, violationPrompt } from "./lenses/violation";

describe("parseViolationFindings", () => {
  it("parses a single Finding/Site pair", () => {
    const raw = "Finding: never mutate a shared array in place\nSite: a.ts:10\n";

    expect(parseViolationFindings(raw)).toEqual([
      { finding: "never mutate a shared array in place", site: "a.ts:10" },
    ]);
  });

  it("parses multiple Finding/Site blocks, in order", () => {
    const raw = [
      "Finding: never mutate a shared array in place",
      "Site: a.ts:10",
      "",
      "Finding: always validate input at the boundary",
      "Site: b.ts:5",
    ].join("\n");

    expect(parseViolationFindings(raw)).toEqual([
      { finding: "never mutate a shared array in place", site: "a.ts:10" },
      { finding: "always validate input at the boundary", site: "b.ts:5" },
    ]);
  });

  it("returns no findings when the raw text carries no Finding/Site pair, an empty pass", () => {
    const raw = "The diff violates no ratified entry. Empty pass.";

    expect(parseViolationFindings(raw)).toEqual([]);
  });

  it("drops a Finding line with no Site line following it, a pending finding never consumed", () => {
    const raw = ["Finding: never mutate a shared array in place", "", "Some closing prose."].join("\n");

    expect(parseViolationFindings(raw)).toEqual([]);
  });

  it("ignores a Site line with no Finding pending above it", () => {
    const raw = ["Site: a.ts:10", "Finding: always validate input at the boundary", "Site: b.ts:5"].join("\n");

    expect(parseViolationFindings(raw)).toEqual([
      { finding: "always validate input at the boundary", site: "b.ts:5" },
    ]);
  });

  it("does not carry a pending finding across an unrelated Site-less finding into the next block", () => {
    const raw = [
      "Finding: first, never consumed",
      "Finding: second, replaces the pending finding above",
      "Site: a.ts:1",
    ].join("\n");

    expect(parseViolationFindings(raw)).toEqual([{ finding: "second, replaces the pending finding above", site: "a.ts:1" }]);
  });
});

describe("violationPrompt", () => {
  it("states the Finding:/Site: grammar explicitly in the Output section", () => {
    const prompt = violationPrompt({ standards: "entry: never do Y", diff: "+ x", spine: "session did X" });
    const outputSection = prompt.slice(prompt.indexOf("## Output"));

    expect(outputSection).toContain("Finding:");
    expect(outputSection).toContain("Site:");
  });
});
