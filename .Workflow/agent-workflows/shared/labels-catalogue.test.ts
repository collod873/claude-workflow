import { expect, test } from "vitest";
import type { GhExec } from "./gh";
import {
  DESCRIPTION_LIMIT,
  ensureLabel,
  FAMILY_COLORS,
  FAMILY_HOLDERS,
  LABEL_CATALOGUE,
  LABELS_TABLE_CLOSE,
  LABELS_TABLE_OPEN,
  labelsOf,
  renderLabelsTable,
  withLabelsTable,
  type CatalogueLabel,
} from "./labels";
import rawCatalogue from "./labels.json";

const catalogue = rawCatalogue as CatalogueLabel[];
const names = catalogue.map((label) => label.name);
const families = Object.keys(FAMILY_COLORS);

const OWNER_ROSTER = [
  "needs-human",
  "fuzzy",
  "by-hand",
  "1-decide",
  "2-questions-open",
  "slice-failed",
  "shape-refused",
  "spec/gap",
];

const shape = (label: CatalogueLabel) => ({
  name: label.name,
  color: label.color,
  description: label.description,
  family: label.family,
});

const rowsOf = (table: string) => table.split("\n").slice(3, -1);

const tableOf = (doc: string) =>
  doc.slice(doc.indexOf(LABELS_TABLE_OPEN), doc.indexOf(LABELS_TABLE_CLOSE) + LABELS_TABLE_CLOSE.length);

test("#557.1: one JSON file carries the label catalogue — name, colour, description and family per label", () => {
  expect(Array.isArray(rawCatalogue)).toBe(true);
  expect(catalogue.length).toBeGreaterThan(0);
  for (const label of catalogue) {
    expect(label.name.length).toBeGreaterThan(0);
    expect(label.color).toMatch(/^[0-9a-f]{6}$/);
    expect(label.description.length).toBeGreaterThan(0);
    expect(families).toContain(label.family);
  }
  expect(catalogue.filter((label) => label.family === "owner").map((label) => label.name)).toEqual(
    expect.arrayContaining(OWNER_ROSTER),
  );
  expect(names).toContain("ticket");
  expect(new Set(names).size).toBe(names.length);
});

test("#557.2: shared/labels.ts builds LABEL_CATALOGUE from that file rather than listing the labels", () => {
  expect(catalogue.length).toBe(LABEL_CATALOGUE.length);
  expect(LABEL_CATALOGUE.map(shape)).toEqual(catalogue.map(shape));
});

test("#557.5: docs/agents/pipeline-labels.md still regenerates byte-identically from the catalogue", () => {
  const doc = `# Pipeline labels\n\n${LABELS_TABLE_OPEN}\nstale\n${LABELS_TABLE_CLOSE}\n\ntail\n`;
  const once = withLabelsTable(doc);
  expect(withLabelsTable(once)).toBe(once);
  expect(once.startsWith("# Pipeline labels\n\n")).toBe(true);
  expect(once.endsWith("\n\ntail\n")).toBe(true);
  const rows = rowsOf(renderLabelsTable());
  expect(rows).toHaveLength(catalogue.length);
  for (const label of catalogue) {
    expect(rows).toContain(
      `| \`${label.name}\` | ${FAMILY_HOLDERS[label.family]} | \`#${label.color}\` | ${label.description} |`,
    );
  }
  expect(rowsOf(tableOf(withLabelsTable(once)))).toEqual(rows);
});

test("#557.6: the whole check contract passes", () => {
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names).size).toBe(names.length);
  for (const label of catalogue) {
    expect(label.color).toBe(FAMILY_COLORS[label.family]);
    expect(label.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  }
  expect([...labelsOf("in-flight", "machine", "owner", "verb", "kind", "fire")].sort()).toEqual([...names].sort());
  expect(labelsOf("owner")).toEqual(catalogue.filter((label) => label.family === "owner").map((label) => label.name));
  const ensured: string[] = [];
  const gh: GhExec = (args) => {
    ensured.push(args.join(" "));
    return "";
  };
  for (const label of catalogue) ensureLabel(gh, label.name);
  expect(ensured).toHaveLength(names.length);
  expect(ensured[0]).toContain(catalogue[0].color);
  expect(() => ensureLabel(gh, "no-such-label-in-the-catalogue")).toThrow();
});
