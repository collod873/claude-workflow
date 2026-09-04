import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { countCriteria } from "./ticket-shape";
import { type Kind, pythonVerdict } from "./ticket-shape.fixture";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const TICKET_FORMAT_DOC = join(REPO_ROOT, "docs/agents/ticket-format.md");

const VARIANT_KIND: [prefix: string, kind: Kind | null][] = [
  ["Spec sub-issue", "ticket"],
  ["Local-file ticket", null],
  ["Wayfinder decision", "question"],
  ["Question (file-issue question", "question"],
];

function variantCases(): { label: string; example: string | undefined }[] {
  const page = readFileSync(TICKET_FORMAT_DOC, "utf8");
  const variants = page.split(/^## Variants[ \t]*$/m)[1];
  if (variants === undefined) return [];

  return variants
    .split(/^### /m)
    .slice(1)
    .map((chunk) => ({
      label: chunk.split("\n", 1)[0]!.trim(),
      example: /```markdown\n([\s\S]*?)```/.exec(chunk)?.[1],
    }));
}

function kindFor(label: string): Kind | null {
  const row = VARIANT_KIND.find(([prefix]) => label.startsWith(prefix));
  if (row === undefined) {
    throw new Error(`${label} is not in VARIANT_KIND; add a row (a kind, or null saying why)`);
  }
  return row[1];
}

const CASES = variantCases();

describe("docs/agents/ticket-format.md's variants, through this repo's bin/ticket_shape.py", () => {
  it("finds variants to check at all", () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  it.each(CASES.map((c) => [c.label, c] as const))("%s: carries a fenced example", (_label, variant) => {
    expect(variant.example).toBeDefined();
  });

  it.each(CASES.map((c) => [c.label, c] as const))("%s: is mapped in VARIANT_KIND", (label) => {
    expect(() => kindFor(label)).not.toThrow();
  });

  it.each(
    CASES.filter((c) => !c.label.startsWith("Question (file-issue question")).map((c) => [c.label, c] as const),
  )("%s: the gate counts at least one criterion in it", (_label, variant) => {
    expect(countCriteria(variant.example ?? "")).toBeGreaterThanOrEqual(1);
  });

  it.each(
    CASES.filter((c) => kindFor(c.label) !== null).map((c) => [c.label, c] as const),
  )("%s: passes the real validate() for its kind", (label, variant) => {
    expect(pythonVerdict(kindFor(label)!, variant.example ?? "", REPO_ROOT)).toMatchObject({ ok: true });
  });
});
