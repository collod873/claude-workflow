import { describe, expect, it } from "vitest";
import { parseStandardEntries, readStandards, renderStandardsSection } from "./standards";

const HEADER = ["# Coding Standards", "", "Some preamble prose.", "", "## Standards", ""].join("\n");

const ENTRY = [
  "- **Deep modules**: a small interface hiding substantial implementation.",
  "  Why: shallow wrappers add surface area without absorbing any complexity.",
  "  Red flag: an interface as wide as the implementation behind it.",
].join("\n");

describe("parseStandardEntries", () => {
  it("reads this repo's own CODING_STANDARDS.md, whatever separator its entries are written with", () => {
    expect(parseStandardEntries(readStandards()).length).toBeGreaterThan(0);
  });

  it("reads the em dash separator earlier entries were written with", () => {
    const legacy = `${HEADER}${ENTRY.replace("**Deep modules**:", "**Deep modules** —")}\n`;

    expect(parseStandardEntries(legacy).map((entry) => entry.name)).toEqual(["Deep modules"]);
  });

  it("reads an entry's three lines apart", () => {
    expect(parseStandardEntries(`${HEADER}${ENTRY}\n`)).toEqual([
      {
        name: "Deep modules",
        what: "a small interface hiding substantial implementation.",
        why: "shallow wrappers add surface area without absorbing any complexity.",
        redFlag: "an interface as wide as the implementation behind it.",
      },
    ]);
  });

  it("reads nothing above the ## Standards heading, so a preamble bullet is never a standard", () => {
    const withPreambleBullet = [
      "# Coding Standards",
      "",
      "- **Not a standard**: this is in the header's own list.",
      "  Why: because the header explains the format.",
      "  Red flag: reading it as an entry.",
      "",
      "## Standards",
      "",
      ENTRY,
      "",
    ].join("\n");

    expect(parseStandardEntries(withPreambleBullet).map((entry) => entry.name)).toEqual(["Deep modules"]);
  });

  it("refuses a half-written entry rather than reporting it as a landed standard", () => {
    const halfWritten = `${HEADER}- **Missing its tail**: what it is.\n  Why: it has no red flag.\n`;

    expect(parseStandardEntries(halfWritten)).toEqual([]);
  });

  it("returns nothing at all for a file with no ## Standards heading", () => {
    expect(parseStandardEntries("# Something else\n")).toEqual([]);
  });
});

describe("renderStandardsSection", () => {
  it("renders an entry back as its three lines", () => {
    expect(renderStandardsSection(`${HEADER}${ENTRY}\n`)).toBe(
      [
        "- **Deep modules**: a small interface hiding substantial implementation.",
        "  Why: shallow wrappers add surface area without absorbing any complexity.",
        "  Red flag: an interface as wide as the implementation behind it.",
      ].join("\n"),
    );
  });

  it("renders every entry, separated, in source order", () => {
    const second = [
      "- **Test the public interface**: test through the module's public surface.",
      "  Why: tests wired to internals break on refactor.",
      "  Red flag: a test importing a private helper.",
    ].join("\n");

    const rendered = renderStandardsSection(`${HEADER}${ENTRY}\n\n${second}\n`);

    expect(rendered).toContain("Deep modules");
    expect(rendered).toContain("Test the public interface");
    expect(rendered.indexOf("Deep modules")).toBeLessThan(rendered.indexOf("Test the public interface"));
  });

  it("renders '(none)' for a file with no standards", () => {
    expect(renderStandardsSection("# Something else\n")).toBe("(none)");
  });
});
