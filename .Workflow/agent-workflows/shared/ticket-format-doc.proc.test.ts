import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { countCriteria } from "./ticket-shape";
import { type Kind, pythonVerdict } from "./ticket-shape.fixture";

/**
 * The producer/parser seam, run against **this repo's own copies**.
 *
 * `docs/agents/ticket-format.md` and `bin/ticket_shape.py` are both vendored here from
 * `collod873/agent-skills`, and the test that holds the two together —
 * `hooks/test_ticket_templates.py` — lives in *that* tree and reads *that* tree's files. This
 * repo's `test` slot (`.claude/contract.json`) is `npm test`, vitest over `.Workflow` and
 * `.claude`, with no Python runner in it. So until this file existed, the pair vendored here was
 * pinned by a suite that never once ran against them: the doc could say one thing, the validator
 * next to it decide another, and nothing in this repo would notice. Both copies had in fact
 * already drifted from the seed when this was written — benignly, which is not the same as
 * detectably.
 *
 * What it asserts is what the seed's suite asserts, minus the seed-mirror case this tree has no
 * seed for: every `### <variant>` under `## Variants` yields its fenced example, the example
 * carries at least one criterion the gate can count, and the example passes the real
 * `validate(kind, …)` for the kind it is shaped like. Cases are discovered from the doc, so a
 * variant added or renamed here is picked up without editing this file — the same property that
 * makes the pin worth having.
 *
 * `.proc.test.ts`, not `.test.ts`: the verdicts come from the real interpreter through
 * `ticket-shape.fixture.ts`, because a `*.test.ts` may not import `node:child_process`.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const TICKET_FORMAT_DOC = join(REPO_ROOT, "docs/agents/ticket-format.md");

/**
 * Variant heading (prefix match) → the `file-issue` kind its example is shaped like, or `null`
 * where the variant is a body shape `file-issue` never produces. `null` is a claim, not a skip:
 * the local-file ticket's `**Files claimed:**` bold label is another tracker backend's
 * convention, not the `## Files claimed` heading the `ticket` kind requires, so validating it
 * against any kind would assert something the doc never says.
 */
const VARIANT_KIND: [prefix: string, kind: Kind | null][] = [
  ["Spec sub-issue", "ticket"],
  ["Local-file ticket", null],
  ["Wayfinder decision", "question"],
  ["Question (file-issue question", "question"],
];

/** The `### <variant>` headings under `## Variants`, each with its first fenced `markdown` block. */
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
    throw new Error(`${label} is not in VARIANT_KIND — add a row (a kind, or null saying why)`);
  }
  return row[1];
}

const CASES = variantCases();

describe("docs/agents/ticket-format.md's variants, through this repo's bin/ticket_shape.py", () => {
  it("finds variants to check at all", () => {
    // A doc whose `## Variants` anchor drifted would otherwise make every case below vacuous.
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
    // The Question variant is exempt by design: a `fuzzy` issue has no criteria yet — they
    // arrive later, through `file-issue ticketify`.
    expect(countCriteria(variant.example ?? "")).toBeGreaterThanOrEqual(1);
  });

  it.each(
    CASES.filter((c) => kindFor(c.label) !== null).map((c) => [c.label, c] as const),
  )("%s: passes the real validate() for its kind", (label, variant) => {
    expect(pythonVerdict(kindFor(label)!, variant.example ?? "", REPO_ROOT)).toMatchObject({ ok: true });
  });
});
