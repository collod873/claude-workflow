import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INDEX_RELATIVE_PATH, regenerateAdrIndex, renderAdrIndex } from "./adr-index";

function adr(status: string, title: string, body = "one two three"): string {
  return `---\nstatus: ${status}\ndate: 2026-09-04\nreversal: Undoing it costs a rewrite.\n---\n\n# ${title}\n\n${body}\n`;
}

describe("renderAdrIndex", () => {
  it("renders a row per constraint, ascending by number, with the title as the ruling", () => {
    const index = renderAdrIndex([
      { name: "0002-second.md", content: adr("constraint", "The second ruling") },
      { name: "0001-first.md", content: adr("constraint", "The first ruling") },
    ]);

    const rows = index.split("\n").filter((line) => line.startsWith("| 0"));
    expect(rows).toEqual(["| 0001 | [The first ruling](0001-first.md) |", "| 0002 | [The second ruling](0002-second.md) |"]);
    expect(index).not.toContain("## Retired");
  });

  it("moves a demoted ADR out of the table into a retired tail that keeps its number but drops its ruling", () => {
    const index = renderAdrIndex([
      { name: "0001-first.md", content: adr("constraint", "The first ruling") },
      { name: "0002-second.md", content: adr("note", "The second ruling") },
    ]);

    expect(index.split("\n").filter((line) => line.startsWith("| 0"))).toEqual(["| 0001 | [The first ruling](0001-first.md) |"]);
    expect(index).toContain("## Retired\n");
    expect(index).toContain("- [0002](0002-second.md) note\n");
    expect(index).not.toContain("The second ruling");
  });

  it("skips a draft, which carries no number, so work in progress never reaches the index", () => {
    const index = renderAdrIndex([
      { name: "0001-first.md", content: adr("constraint", "The first ruling") },
      { name: "draft-a-ruling-being-written.md", content: adr("constraint", "Still being written") },
      { name: "README.md", content: "# Format\n" },
    ]);

    expect(index).not.toContain("Still being written");
    expect(index).toContain("1 ADR · 1 constraint");
  });

  it("escapes a pipe in a title rather than breaking the row into extra columns", () => {
    const index = renderAdrIndex([{ name: "0001-a.md", content: adr("constraint", "A | B") }]);

    expect(index).toContain("| 0001 | [A \\| B](0001-a.md) |");
  });

  it("tallies by status and totals the words, excluding the title line the cap never charges for", () => {
    const index = renderAdrIndex([
      { name: "0001-a.md", content: adr("constraint", "One", "alpha beta") },
      { name: "0002-b.md", content: adr("note", "Two", "gamma") },
      { name: "0003-c.md", content: adr("constraint", "Three", "delta epsilon zeta") },
    ]);

    expect(index).toContain("3 ADRs · 2 constraint · 1 note · 6 words total.");
  });

  it("names a file with no status and no title rather than dropping it silently", () => {
    const index = renderAdrIndex([{ name: "0009-mystery.md", content: "no frontmatter, no heading\n" }]);

    expect(index).toContain("- [0009](0009-mystery.md) ?\n");
    expect(index).toContain("1 ADR · 1 ? · 4 words total.");
  });
});

describe("regenerateAdrIndex", () => {
  function corpus(withIndex: boolean): string {
    const root = mkdtempSync(join(tmpdir(), "adr-index-"));
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    writeFileSync(join(root, "docs/adr/0001-a-ruling.md"), adr("constraint", "A ruling"));
    if (withIndex) writeFileSync(join(root, INDEX_RELATIVE_PATH), "stale\n");
    return root;
  }

  it("rewrites an index that has gone stale and says it wrote one", () => {
    const root = corpus(true);

    expect(regenerateAdrIndex(root)).toBe(true);
    expect(readFileSync(join(root, INDEX_RELATIVE_PATH), "utf8")).toContain("| 0001 | [A ruling](0001-a-ruling.md) |");
  });

  it("stands down on a target that carries no index, so enrolment never invents one", () => {
    const root = corpus(false);

    expect(regenerateAdrIndex(root)).toBe(false);
    expect(existsSync(join(root, INDEX_RELATIVE_PATH))).toBe(false);
  });

  it("reports false rather than throwing when the corpus cannot be read, so a render never fails a landing", () => {
    const root = corpus(true);
    mkdirSync(join(root, "docs/adr/0002-a-directory-not-a-file.md"));

    expect(regenerateAdrIndex(root)).toBe(false);
  });

  it("needs nothing on $HOME, so it renders the same index on a runner as on the workstation", () => {
    const root = corpus(true);

    regenerateAdrIndex(root);
    const onRunner = readFileSync(join(root, INDEX_RELATIVE_PATH), "utf8");
    writeFileSync(join(root, INDEX_RELATIVE_PATH), "stale\n");
    regenerateAdrIndex(root);

    expect(readFileSync(join(root, INDEX_RELATIVE_PATH), "utf8")).toBe(onRunner);
  });
});
