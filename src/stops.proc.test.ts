import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rowsUnder } from "./machine-page.ts";
import { parts } from "./parts.ts";
import { STOPS } from "./stops.ts";

const REPO = resolve(import.meta.dirname, "..");
const RULING = "docs/agents/layers/one-ticket.md";
const HELD = "The owner is never the one who fixes a stuck run";
const THE_OWNER = /^the owner\b/i;

interface Row {
  stop: string;
  clearedBy: string;
}

function runsRows(markdown: string): Row[] {
  return rowsUnder(markdown, "Runs").map(([stop, , clearedBy]) => ({ stop, clearedBy }));
}

function stopRefusals(named: Record<string, string>, rows: Row[]): string[] {
  const unruled = Object.entries(named)
    .filter(([, stop]) => !rows.some((row) => row.stop === stop))
    .map(([exit, stop]) => `${exit} names no Runs row: ${stop}`);
  const owned = rows.filter((row) => THE_OWNER.test(row.clearedBy)).map((row) => `${row.stop} is cleared by the owner`);
  return [...unruled, ...owned];
}

const ruled = () => runsRows(readFileSync(join(REPO, RULING), "utf8"));

describe("every red exit names a Runs row whose clearer is not the owner (#812)", () => {
  it("finds every stop the machine names in the ruling's Runs table, none cleared by the owner", () => {
    expect(ruled().length).toBeGreaterThan(0);
    expect(stopRefusals(STOPS, ruled())).toEqual([]);
    expect(parts.find((part) => part.file === "src/stops.proc.test.ts")?.holds).toContain(HELD);
  });

  it("fails a stage whose red exit names no Runs row", () => {
    expect(stopRefusals({ ...STOPS, builder: "The builder gave up" }, ruled())).toEqual(["builder names no Runs row: The builder gave up"]);
  });

  it("fails a Runs row cleared by the owner", () => {
    const page = [
      "## Runs",
      "",
      "| Stop | What happens | Cleared by |",
      "|---|---|---|",
      "| Filing refused | Nothing is filed | The filing session, live with the owner |",
      "| A run is stuck | It waits | The owner, by hand |",
      "",
    ].join("\n");

    expect(stopRefusals({}, runsRows(page))).toEqual(["A run is stuck is cleared by the owner"]);
  });
});
