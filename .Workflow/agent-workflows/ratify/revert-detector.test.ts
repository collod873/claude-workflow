import { describe, expect, it } from "vitest";
import { ratificationRecord } from "../shared/ratification.fixture";
import { scanForReverts } from "./revert-detector";

const STANDARDS = [
  "# Coding Standards",
  "",
  "## Standards",
  "",
  "- **Deep modules**: a small interface hiding substantial implementation.",
  "  Why: shallow wrappers add surface area.",
  "  Red flag: a layer that mostly delegates.",
  "",
].join("\n");

const ratified = (finding: string, landedAs: string) =>
  ratificationRecord({ finding, decision: "ratified", landedAs, reason: "landed" });

describe("scanForReverts: tree versus memory, one mechanical rule", () => {
  it("writes nothing while every ratified standard is still in the tree", () => {
    const scan = scanForReverts({
      records: [ratified("f1", "Deep modules"), ratified("f2", "ns/rule")],
      standards: STANDARDS,
      ruleIds: new Set(["ns/rule"]),
      sha: "abc123",
    });

    expect(scan.declined).toEqual([]);
    expect(scan.present.sort()).toEqual(["Deep modules", "ns/rule"]);
  });

  it("declines a prose entry the owner deleted, carrying the original finding and its sites", () => {
    const scan = scanForReverts({
      records: [ratificationRecord({ finding: "f1", decision: "ratified", landedAs: "Gone", sites: ["a.ts:1", "b.ts:2"] })],
      standards: STANDARDS,
      ruleIds: new Set(),
      sha: "abc123",
    });

    expect(scan.declined).toEqual([
      {
        finding: "f1",
        sites: ["a.ts:1", "b.ts:2"],
        decision: "declined",
        reason: 'reverted by owner at abc123: "Gone" is no longer in the tree',
        landedAs: "Gone",
      },
    ]);
  });

  it("declines a lint rule the owner switched off, which is the same decision as deleting it", () => {
    const scan = scanForReverts({
      records: [ratified("f2", "ns/rule")],
      standards: STANDARDS,
      ruleIds: new Set(),
      sha: "abc123",
    });

    expect(scan.declined.map((record) => record.landedAs)).toEqual(["ns/rule"]);
  });

  it("is idempotent, so a finding already declined derives nothing new", () => {
    const scan = scanForReverts({
      records: [ratified("f1", "Gone"), ratificationRecord({ finding: "f1" })],
      standards: STANDARDS,
      ruleIds: new Set(),
      sha: "abc123",
    });

    expect(scan.declined).toEqual([]);
  });

  it("writes one record for a finding ratified more than once, not one per record", () => {
    const scan = scanForReverts({
      records: [ratified("f1", "Gone"), ratified("f1", "Gone")],
      standards: STANDARDS,
      ruleIds: new Set(),
      sha: "abc123",
    });

    expect(scan.declined).toHaveLength(1);
  });

  it("declines to guess about a ratified record that names nothing it landed as", () => {
    const scan = scanForReverts({
      records: [ratificationRecord({ finding: "f1", decision: "ratified" })],
      standards: STANDARDS,
      ruleIds: new Set(),
      sha: "abc123",
    });

    expect(scan.declined).toEqual([]);
  });

  it("ignores a record that was never a ratification in the first place", () => {
    const scan = scanForReverts({
      records: [ratificationRecord({ finding: "f1", decision: "deferred", landedAs: "Gone" })],
      standards: STANDARDS,
      ruleIds: new Set(),
      sha: "abc123",
    });

    expect(scan.declined).toEqual([]);
  });
});
