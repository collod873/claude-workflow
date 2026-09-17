import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "../../shared/scratch.fixture";
import { collectMapContext } from "./map";
import { test } from "vitest";
import { trackerGh } from "../../shared/tracker-gh";
import { trackerMemory } from "../../shared/tracker-memory";
import { createIssueGh } from "../../shared/gh.fake";

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
    const tracker = trackerMemory({
      issues: {
        1: { body },
        42: { comments: ["A resolution comment nobody should have to read once the ADR exists."] },
      },
    });

    const context = collectMapContext(tracker, 1, repoRoot);

    expect(context.rulings).toContain("The durable ruling, in full.");
    expect(context.rulings).not.toContain("A resolution comment nobody should have to read");
  });

  it("falls back to the resolution comment when the gist names no durable record", () => {
    const body = mapBody({
      decisions: "- [Another ticket](https://github.com/o/r/issues/7): decided to do it the plain way",
    });
    const tracker = trackerMemory({
      issues: { 1: { body }, 7: { comments: ["The resolution comment, since no ADR was filed."] } },
    });

    const context = collectMapContext(tracker, 1, "/nonexistent");

    expect(context.rulings).toContain("The resolution comment, since no ADR was filed.");
  });

  it("reads the map body verbatim as ownerWords", () => {
    const body = mapBody({ decisions: "- [A ticket](https://github.com/o/r/issues/1): the gist" });
    const tracker = trackerMemory({ issues: { 5: { body }, 1: { comments: ["resolution"] } } });

    const context = collectMapContext(tracker, 5, "/nonexistent");

    expect(context.ownerWords).toBe(body);
  });

  it("reads boundaries from Out of scope and openGuesses from Not yet specified", () => {
    const body = mapBody({
      decisions: "- [A ticket](https://github.com/o/r/issues/1): the gist",
      outOfScope: "- Billing: real work, filed elsewhere (filed)",
      notYetSpecified: "- Whether the retry policy needs a cap",
    });
    const tracker = trackerMemory({ issues: { 5: { body }, 1: { comments: ["resolution"] } } });

    const context = collectMapContext(tracker, 5, "/nonexistent");

    expect(context.boundaries).toContain("Billing");
    expect(context.openGuesses).toContain("retry policy");
  });

  it("throws when the map carries no Decisions so far entries", () => {
    const tracker = trackerMemory({ issues: { 1: { body: mapBody() } } });

    expect(() => collectMapContext(tracker, 1, "/nonexistent")).toThrow();
  });
});

test("#615.3: collectMapContext resolves a durable ruling when read through a Tracker built over trackerGh", () => {
  const repoRoot = scratchDir("map-collector-tracker");
  mkdirSync(join(repoRoot, "docs/adr"), { recursive: true });
  writeFileSync(
    join(repoRoot, "docs/adr/0099-the-thing-is-decided.md"),
    "# The thing is decided\n\nThe durable ruling, in full.",
  );

  const body = mapBody({
    decisions:
      "- [The thing ticket](https://github.com/o/r/issues/42): filed as [ADR-0099](docs/adr/0099-the-thing-is-decided.md)",
  });
  const { gh } = createIssueGh((fields) =>
    fields === "body"
      ? JSON.stringify({ body })
      : fields === "comments"
        ? JSON.stringify({ comments: [] })
        : undefined,
  );
  const tracker = trackerGh(gh) as unknown as Parameters<typeof collectMapContext>[0];

  const context = collectMapContext(tracker, 1, repoRoot);

  expect(context.rulings).toContain("The durable ruling, in full.");
});
