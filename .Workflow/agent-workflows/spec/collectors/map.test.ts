import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "../../shared/scratch.fixture";
import { collectMapContext } from "./map";
import { mapTrackerGh } from "./map-gh.fixture";

/**
 * The map collector reproduces `to-spec/SKILL.md`'s own walk of a closed
 * Wayfinder Map: read `## Decisions so far`, follow each link one level,
 * and prefer the durable record a gist names over the linked ticket's
 * resolution comment.
 */

function mapBody(over: { decisions?: string; outOfScope?: string; notYetSpecified?: string } = {}): string {
  return [
    "## Destination",
    "",
    "Ship the thing.",
    "",
    "Budget: 10 tickets.",
    "",
    "## Decisions so far",
    "",
    over.decisions ?? "",
    "",
    "## Not yet specified",
    "",
    over.notYetSpecified ?? "",
    "",
    "## Out of scope",
    "",
    over.outOfScope ?? "",
  ].join("\n");
}

describe("collectMapContext", () => {
  it("prefers the gist-linked durable record over the resolution comment when both exist", () => {
    const repoRoot = scratchDir("map-collector");
    mkdirSync(join(repoRoot, "docs/adr"), { recursive: true });
    writeFileSync(
      join(repoRoot, "docs/adr/0099-the-thing-is-decided.md"),
      "# The thing is decided\n\nThe durable ruling, in full.",
    );

    const body = mapBody({
      decisions:
        "- [The thing ticket](https://github.com/o/r/issues/42): filed as [ADR-0099](docs/adr/0099-the-thing-is-decided.md)",
    });
    const gh = mapTrackerGh(1, body, {
      42: ["A resolution comment nobody should have to read once the ADR exists."],
    });

    const context = collectMapContext(gh, 1, repoRoot);

    expect(context.rulings).toContain("The durable ruling, in full.");
    expect(context.rulings).not.toContain("A resolution comment nobody should have to read");
  });

  it("falls back to the resolution comment when the gist names no durable record", () => {
    const body = mapBody({
      decisions: "- [Another ticket](https://github.com/o/r/issues/7): decided to do it the plain way",
    });
    const gh = mapTrackerGh(1, body, { 7: ["The resolution comment, since no ADR was filed."] });

    const context = collectMapContext(gh, 1, "/nonexistent");

    expect(context.rulings).toContain("The resolution comment, since no ADR was filed.");
  });

  it("reads the map body verbatim as ownerWords", () => {
    const body = mapBody({ decisions: "- [A ticket](https://github.com/o/r/issues/1): the gist" });
    const gh = mapTrackerGh(5, body, { 1: ["resolution"] });

    const context = collectMapContext(gh, 5, "/nonexistent");

    expect(context.ownerWords).toBe(body);
  });

  it("reads boundaries from Out of scope and openGuesses from Not yet specified", () => {
    const body = mapBody({
      decisions: "- [A ticket](https://github.com/o/r/issues/1): the gist",
      outOfScope: "- Billing: real work, filed elsewhere (filed)",
      notYetSpecified: "- Whether the retry policy needs a cap",
    });
    const gh = mapTrackerGh(5, body, { 1: ["resolution"] });

    const context = collectMapContext(gh, 5, "/nonexistent");

    expect(context.boundaries).toContain("Billing");
    expect(context.openGuesses).toContain("retry policy");
  });

  it("throws when the map carries no Decisions so far entries", () => {
    const gh = mapTrackerGh(1, mapBody());

    expect(() => collectMapContext(gh, 1, "/nonexistent")).toThrow();
  });
});
