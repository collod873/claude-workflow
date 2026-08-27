import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SALVAGE_OUTPUT } from "../close-gate/close-gate";
import { REFUTER_OUTPUT, SHAPER_OUTPUT } from "../shape/sheet-schema";
import { SWEEP_OUTPUT } from "../shape/sweep-schema";
import { SEAM_SWEEP_OUTPUT } from "../to-tickets/seam-sweep/schema";
import { AUDIT_OUTPUT, SLICE_CAPS, SLICE_OUTPUT } from "./plan-schema";
import type { StructuredOutput } from "./structured-output";

/**
 * Every stage prompt ends in a ```structured-output skeleton — a literal
 * example of the JSON the model is asked for — and every one of those
 * skeletons is checked here against the schema the stage actually sends to
 * the CLI.
 *
 * The pair drifts silently otherwise, and a drifted skeleton is not a test
 * failure at commit time but a dead run at the end of a stage that has already
 * spent its model time. #143's shaping died exactly that way: `newTerms` was
 * the one field whose skeleton carried an empty array, so the shape of a term
 * existed only in prose ("the near-synonyms to avoid, and which of that file's
 * four groupings"), and the model guessed `avoid` as a string and omitted
 * `section` entirely. Both guesses were reasonable readings of the sentence.
 *
 * That is why parsing alone is not the check. `{"newTerms":[]}` parses — the
 * field is `.default([])` — and taught nothing. The second assertion below is
 * the one that would have caught it.
 *
 * **The skeleton is checked against the wrapped shape, not the domain
 * schema.** What the model is handed is the object-rooted schema — `slices`,
 * `entries`, `answer` and all — so a skeleton showing the unwrapped shape is
 * an example of something the tool will refuse, however well it matches the
 * type the stage eventually returns.
 */

/** Which structured-output contract each prompt's skeleton is checked against. */
const PROMPTS: ReadonlyArray<{ path: string; output: StructuredOutput<unknown> }> = [
  { path: "shape/sweep/prompt.md", output: SWEEP_OUTPUT },
  { path: "shape/shaper/prompt.md", output: SHAPER_OUTPUT },
  { path: "shape/refuter/prompt.md", output: REFUTER_OUTPUT },
  { path: "to-tickets/seam-sweep/prompt.md", output: SEAM_SWEEP_OUTPUT },
  { path: "to-tickets/slice/prompt.md", output: SLICE_OUTPUT },
  { path: "to-tickets/audit/prompt.md", output: AUDIT_OUTPUT },
  { path: "close-gate/salvage/prompt.md", output: SALVAGE_OUTPUT },
];

function promptSource(promptPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${promptPath}`, import.meta.url)), "utf8");
}

/** The skeletons in a prompt, in order — a prompt may show more than one legal shape. */
function skeletons(promptPath: string): unknown[] {
  const source = promptSource(promptPath);
  const found = [...source.matchAll(/^```structured-output\n([\s\S]*?)\n```$/gm)];
  return found.map((match) => JSON.parse(match[1]) as unknown);
}

/** Peels the wrappers that carry a schema inside them, down to the thing being described. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = schema._def as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny };
  if (def.innerType) return unwrap(def.innerType);
  if (def.schema) return unwrap(def.schema);
  return schema;
}

/**
 * Every path at which the schema expects an array **of objects**, as key
 * segments (an array in the path is traversed rather than named, so a `Plan`'s
 * per-slice fields read as `seamsConsumed`, not `[].seamsConsumed`).
 *
 * Only arrays of objects, because only an object has field names and types a
 * prose description cannot convey. An array of strings or numbers left empty
 * in a skeleton — `dependsOn`, `survivors` — costs the model nothing it can't
 * read off the surrounding sentence, and demanding an example of those would
 * fail three prompts that are not wrong.
 */
function objectArrayPaths(schema: z.ZodTypeAny, path: string[] = []): string[][] {
  const node = unwrap(schema);
  const def = node._def as {
    typeName?: string;
    type?: z.ZodTypeAny;
    options?: z.ZodTypeAny[];
  };

  if (node instanceof z.ZodArray) {
    const element = unwrap(def.type as z.ZodTypeAny);
    if (element instanceof z.ZodObject) {
      return [path, ...objectArrayPaths(element, path)];
    }
    return [];
  }

  if (node instanceof z.ZodObject) {
    const shape = node.shape as Record<string, z.ZodTypeAny>;
    return Object.keys(shape).flatMap((key) => objectArrayPaths(shape[key], [...path, key]));
  }

  // A union's branches are alternative shapes of the same response; a path that
  // any branch declares still has to be shown somewhere in that prompt.
  if (def.options) {
    return def.options.flatMap((option) => objectArrayPaths(option, path));
  }

  return [];
}

/** Every array found at `path` in `value`, traversing any array in the way. */
function arraysAt(value: unknown, path: string[]): unknown[][] {
  if (path.length === 0) return Array.isArray(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => arraysAt(item, path));
  if (value === null || typeof value !== "object") return [];
  const next = (value as Record<string, unknown>)[path[0]];
  return next === undefined ? [] : arraysAt(next, path.slice(1));
}

describe.each(PROMPTS)("$path", ({ path, output }) => {
  it("shows only skeletons the stage's own schema accepts", () => {
    const shown = skeletons(path);
    expect(shown.length).toBeGreaterThan(0);
    for (const skeleton of shown) {
      // Through `parse`, not the bare schema, so the skeleton is checked
      // against the whole trip a real response makes — serialised, validated,
      // unwrapped — rather than against one step of it.
      expect(() => output.parse(JSON.stringify(skeleton))).not.toThrow();
    }
  });

  it("populates every array of objects it asks for, so no field's shape is left to prose", () => {
    const shown = skeletons(path);
    const unpopulated = objectArrayPaths(output.schema).filter((expected) =>
      shown.every((skeleton) =>
        arraysAt(skeleton, expected).every((found) => found.length === 0),
      ),
    );

    expect(unpopulated.map((segments) => segments.join(".") || "(the response itself)")).toEqual(
      [],
    );
  });
});

/**
 * The `Slice` caps (#151) have to hold in three places at once: on the wire,
 * where the API refuses a field that runs over; and in both plan-emitting
 * prompts, so a model aims under a ceiling it knows about rather than being
 * refused mid-turn by one it doesn't. The JSON Schema is what the API
 * enforces, so the caps are asserted on the derived schema — not on the zod
 * source — and the prompts are pinned to the same constants.
 */
describe("the Slice caps, on the wire and in both prompts", () => {
  /** The `Slice` property map as each plan-emitting stage's derived JSON Schema carries it. */
  const wireSlices: ReadonlyArray<{ stage: string; properties: Record<string, Record<string, unknown>> }> = [
    { stage: "slice", properties: sliceProperties(SLICE_OUTPUT) },
    { stage: "audit", properties: sliceProperties(AUDIT_OUTPUT) },
  ];

  function sliceProperties(output: StructuredOutput<unknown>) {
    const schema = JSON.parse(output.jsonSchema) as {
      properties: { slices: { items: { properties: Record<string, Record<string, unknown>> } } };
    };
    return schema.properties.slices.items.properties;
  }

  const PLAN_PROMPTS = ["to-tickets/slice/prompt.md", "to-tickets/audit/prompt.md"] as const;

  it.each(wireSlices)("$stage: the derived JSON Schema carries maxLength on all three prose fields", ({ properties }) => {
    expect(properties.whatToBuild.maxLength).toBe(SLICE_CAPS.whatToBuild);
    expect(properties.whyNotMerged.maxLength).toBe(SLICE_CAPS.whyNotMerged);
    expect((properties.acceptanceCriteria.items as Record<string, unknown>).maxLength).toBe(
      SLICE_CAPS.acceptanceCriteria,
    );
  });

  it.each(wireSlices)("$stage: neither filesClaimed nor acceptanceCriteria carries an item-count cap", ({ properties }) => {
    expect(properties.filesClaimed).not.toHaveProperty("maxItems");
    expect(properties.acceptanceCriteria).not.toHaveProperty("maxItems");
  });

  it.each(PLAN_PROMPTS)("%s states each cap beside the field it bounds", (promptPath) => {
    const source = promptSource(promptPath);
    for (const [field, cap] of Object.entries(SLICE_CAPS)) {
      // The number on the same line as the field name, not merely somewhere
      // in the prompt — "200" alone could be the title cap, or a line number.
      expect(source).toMatch(new RegExp(`\`${field}\`[^\\n]*\\b${cap}\\b`));
    }
  });
});
