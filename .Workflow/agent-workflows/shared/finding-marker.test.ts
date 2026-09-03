import { describe, expect, it } from "vitest";
import { observation } from "./observation.fixture";
import { encodeFindingMarker, parseFindingMarker } from "./finding-marker";

describe("the finding marker a ratifier PR body carries", () => {
  it("round-trips the finding, its sites and what it landed as", () => {
    const found = observation({ finding: "duplicated validation", sites: ["a.ts:1", "b.ts:2"] });

    const parsed = parseFindingMarker(`## Whatever\n${encodeFindingMarker(found, "Some standard")}`);

    expect(parsed).toEqual({
      finding: "duplicated validation",
      sites: ["a.ts:1", "b.ts:2"],
      landedAs: "Some standard",
    });
  });

  it("stays hidden in the rendered body — the marker is an HTML comment", () => {
    const encoded = encodeFindingMarker(observation({ finding: "f" }), "N");

    expect(encoded.startsWith("<!--")).toBe(true);
    expect(encoded.endsWith("-->")).toBe(true);
  });

  it("declines a line carrying no marker rather than guessing one", () => {
    expect(parseFindingMarker("- an ordinary body line")).toBeNull();
  });

  it("declines a hand-edited marker whose payload no longer parses", () => {
    expect(parseFindingMarker("<!-- release-finding:{not json -->")).toBeNull();
  });

  it("declines a payload missing the fields every reader depends on", () => {
    expect(parseFindingMarker('<!-- release-finding:{"finding":"f"} -->')).toBeNull();
    expect(parseFindingMarker('<!-- release-finding:{"sites":["a.ts:1"]} -->')).toBeNull();
  });

  it("accepts a marker written before landedAs existed, so an older PR still parses", () => {
    expect(parseFindingMarker('<!-- release-finding:{"finding":"f","sites":["a.ts:1"]} -->')).toEqual({
      finding: "f",
      sites: ["a.ts:1"],
    });
  });
});
