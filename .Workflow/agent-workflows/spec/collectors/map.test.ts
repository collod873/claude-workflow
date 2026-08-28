import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GhExec } from "../../shared/gh";
import { collectMapContext } from "./map";

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

/** A fake `gh` answering `issue view --json body` for the map and `--json comments` for its linked tickets. */
function fakeGh(mapNumber: number, body: string, ticketComments: Record<number, string[]> = {}): GhExec {
  return (args) => {
    const issueNumber = Number(args[2]);
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") {
      if (issueNumber !== mapNumber) throw new Error(`fake gh: unexpected body fetch for #${issueNumber}`);
      return JSON.stringify({ body });
    }
    if (fields === "comments") {
      const comments = ticketComments[issueNumber];
      if (comments === undefined) throw new Error(`fake gh: unexpected comments fetch for #${issueNumber}`);
      return JSON.stringify({ comments: comments.map((b) => ({ body: b })) });
    }
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}

describe("collectMapContext", () => {
  let repoRoot: string | undefined;

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  });

  it("prefers the gist-linked durable record over the resolution comment when both exist", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "map-collector-"));
    mkdirSync(join(repoRoot, "docs/adr"), { recursive: true });
    writeFileSync(
      join(repoRoot, "docs/adr/0099-the-thing-is-decided.md"),
      "# The thing is decided\n\nThe durable ruling, in full.",
    );

    const body = mapBody({
      decisions:
        "- [The thing ticket](https://github.com/o/r/issues/42): filed as [ADR-0099](docs/adr/0099-the-thing-is-decided.md)",
    });
    const gh = fakeGh(1, body, {
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
    const gh = fakeGh(1, body, { 7: ["The resolution comment, since no ADR was filed."] });

    const context = collectMapContext(gh, 1, repoRoot ?? "/nonexistent");

    expect(context.rulings).toContain("The resolution comment, since no ADR was filed.");
  });

  it("reads the map body verbatim as ownerWords", () => {
    const body = mapBody({ decisions: "- [A ticket](https://github.com/o/r/issues/1): the gist" });
    const gh = fakeGh(5, body, { 1: ["resolution"] });

    const context = collectMapContext(gh, 5, "/nonexistent");

    expect(context.ownerWords).toBe(body);
  });

  it("reads boundaries from Out of scope and openGuesses from Not yet specified", () => {
    const body = mapBody({
      decisions: "- [A ticket](https://github.com/o/r/issues/1): the gist",
      outOfScope: "- Billing: real work, filed elsewhere (filed)",
      notYetSpecified: "- Whether the retry policy needs a cap",
    });
    const gh = fakeGh(5, body, { 1: ["resolution"] });

    const context = collectMapContext(gh, 5, "/nonexistent");

    expect(context.boundaries).toContain("Billing");
    expect(context.openGuesses).toContain("retry policy");
  });

  it("throws when the map carries no Decisions so far entries", () => {
    const body = mapBody();
    const gh = fakeGh(1, body, {});

    expect(() => collectMapContext(gh, 1, "/nonexistent")).toThrow();
  });
});
