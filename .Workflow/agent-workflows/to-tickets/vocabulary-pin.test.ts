import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { vocabulary } from "./to-tickets";

const CONTEXT = resolve(import.meta.dirname, "../../../CONTEXT.md");

const PINNED_TERMS = ["Lane", "Spec", "Slice", "Ticket", "Seam manifest", "Stage"];

function entryFor(source: string, term: string): string {
  const start = source.indexOf(`**${term}**:\n`);
  const end = source.indexOf("\n\n", start);

  return source.slice(start, end);
}

describe("the vocabulary this lane injects", () => {
  const context = readFileSync(CONTEXT, "utf8");
  const injected = vocabulary();

  it.each(PINNED_TERMS)("carries CONTEXT.md's %s entry verbatim", (term) => {
    const entry = entryFor(context, term);

    expect(entry).toContain("_Avoid_:");
    expect(injected).toContain(entry);
  });

  it("carries nothing else, so a term added to CONTEXT.md is a deliberate addition here", () => {
    expect(injected.match(/^\*\*.+\*\*:$/gm)).toHaveLength(PINNED_TERMS.length);
  });
});
