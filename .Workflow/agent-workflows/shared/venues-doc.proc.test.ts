import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  checkVenuesDoc,
  readVenueSlots,
  regenerateVenuesDoc,
  renderVenuesTable,
  venuesTableMarkers,
} from "./venues-doc.cli";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = fileURLToPath(new URL("./venues-doc.cli.ts", import.meta.url));

const leadingProse = "A venue is a place a check can run.";
const trailingProse = "Only `push` and CI fail closed.";

function docAround(table: string): string {
  const { begin, end } = venuesTableMarkers();
  return `# Venues\n\n${leadingProse}\n\n${begin}\n${table}\n${end}\n\n${trailingProse}\n`;
}

test(
  "#554.1: the venue-to-slot mapping is read from one place, not typed in both bin/gauntlet and the doc",
  () => {
    const byVenue = new Map(readVenueSlots().map((entry) => [entry.venue, entry.slots]));

    for (const venue of ["turn", "stop"]) {
      const slots = byVenue.get(venue) ?? [];
      expect(slots, venue).toEqual(
        expect.arrayContaining(["typecheck", "lint_one", "test_related"]),
      );
      expect(slots, venue).toHaveLength(3);
    }

    const push = byVenue.get("push") ?? [];
    expect(push).toEqual(
      expect.arrayContaining(["typecheck", "lint", "rules", "test", "clones", "adrs"]),
    );
    expect(push).toHaveLength(6);

    const rows = renderVenuesTable().split("\n");
    for (const [venue, slots] of byVenue) {
      const row = rows.find(
        (line) => line.includes(venue) && slots.every((slot) => line.includes(slot)),
      );
      expect(row, venue).toBeDefined();
    }
  },
);

test("#554.2: the venues table names `adrs` in the push row", () => {
  const rows = renderVenuesTable()
    .split("\n")
    .filter((line) => line.includes("adrs"));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatch(/push/);
});

test(
  "#554.3: the table sits between regeneration markers and the prose around it survives a regeneration",
  () => {
    const { begin, end } = venuesTableMarkers();
    const staleRow = "| `push` | pre-push | `typecheck` | **Refuses the push** |";
    const regenerated = regenerateVenuesDoc(
      docAround(`| Venue | Fires at | Slots | On failure |\n| --- | --- | --- | --- |\n${staleRow}`),
    );

    expect(regenerated).toContain(leadingProse);
    expect(regenerated).toContain(trailingProse);
    expect(regenerated).not.toContain(staleRow);

    const beginAt = regenerated.indexOf(begin);
    const endAt = regenerated.indexOf(end);
    expect(beginAt).toBeGreaterThan(regenerated.indexOf(leadingProse));
    expect(endAt).toBeGreaterThan(beginAt);
    expect(regenerated.indexOf(trailingProse)).toBeGreaterThan(endAt);

    const between = regenerated.slice(beginAt + begin.length, endAt);
    expect(between).toContain(renderVenuesTable().trim());

    expect(regenerateVenuesDoc(regenerated)).toBe(regenerated);
  },
);

test("#554.4: a stale table fails a --check run that names the fix", () => {
  const stale = docAround(
    "| Venue | Fires at | Slots | On failure |\n| --- | --- | --- | --- |\n| `push` | pre-push | `typecheck` | **Refuses the push** |",
  );

  const staleVerdict = checkVenuesDoc(stale);
  expect(staleVerdict.ok).toBe(false);
  expect(staleVerdict.message).toContain("venues-doc");

  const freshVerdict = checkVenuesDoc(regenerateVenuesDoc(stale));
  expect(freshVerdict.ok).toBe(true);
});

test(
  "#554.5: the whole check contract passes",
  () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("package.json", new URL("file://" + repoRoot)), "utf8"),
    ) as { scripts?: Record<string, string> };
    const scripts = Object.values(packageJson.scripts ?? {});
    expect(scripts.some((command) => command.includes("venues-doc.cli.ts"))).toBe(true);

    const run = spawnSync("npx", ["tsx", cliPath, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(run.status, `${run.stdout ?? ""}${run.stderr ?? ""}`).toBe(0);
  },
  120_000,
);
