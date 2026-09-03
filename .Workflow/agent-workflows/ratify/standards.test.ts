import { describe, expect, it } from "vitest";
import { appendStandardEntry, enabledRuleIds, parseStandardEntries } from "./standards";

const HEADER = ["# Coding Standards", "", "Some preamble prose.", "", "## Standards", ""].join("\n");

const ENTRY = [
  "- **Deep modules** — a small interface hiding substantial implementation.",
  "  Why: shallow wrappers add surface area without absorbing any complexity.",
  "  Red flag: an interface as wide as the implementation behind it.",
].join("\n");

describe("parseStandardEntries", () => {
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
      "- **Not a standard** — this is in the header's own list.",
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
    const halfWritten = `${HEADER}- **Missing its tail** — what it is.\n  Why: it has no red flag.\n`;

    expect(parseStandardEntries(halfWritten)).toEqual([]);
  });

  it("returns nothing at all for a file with no ## Standards heading", () => {
    expect(parseStandardEntries("# Something else\n")).toEqual([]);
  });
});

describe("appendStandardEntry", () => {
  it("grows the flat list at the bottom, leaving what is already there untouched", () => {
    const grown = appendStandardEntry(`${HEADER}${ENTRY}\n`, "- **New one** — what.\n  Why: y.\n  Red flag: r.");

    expect(parseStandardEntries(grown).map((entry) => entry.name)).toEqual(["Deep modules", "New one"]);
    expect(grown.startsWith(HEADER)).toBe(true);
  });

  it("refuses a file with no ## Standards heading rather than inventing one", () => {
    expect(() => appendStandardEntry("# Something else\n", "- **X** — w.\n  Why: y.\n  Red flag: r.")).toThrow(
      /## Standards/,
    );
  });
});

describe("enabledRuleIds", () => {
  it("reports every rule turned on across the config's elements", () => {
    const ids = enabledRuleIds([
      { rules: { "a/one": "error" } },
      { rules: { "b/two": ["error", 3], "c/three": "warn" } },
    ]);

    expect([...ids].sort()).toEqual(["a/one", "b/two", "c/three"]);
  });

  it("treats a rule switched off as gone, because that is the same decision as reverting it", () => {
    const ids = enabledRuleIds([{ rules: { "a/one": "off", "b/two": 0, "c/three": ["off"] } }]);

    expect([...ids]).toEqual([]);
  });
});
