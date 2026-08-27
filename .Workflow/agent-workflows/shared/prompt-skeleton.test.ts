import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SalvagedRecord } from "../close-gate/close-gate";
import { Refutations, ShaperOutput } from "../shape/sheet-schema";
import { Sweep } from "../shape/sweep-schema";
import { SeamManifest } from "../to-tickets/seam-sweep/schema";
import { Plan } from "./plan-schema";

/**
 * Every stage prompt ends in an `<output>` skeleton — a literal example of the
 * JSON the model is asked for — and every one of those skeletons is checked
 * here against the schema the stage will actually parse the response with.
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
 */

/** Which schema each prompt's response is parsed with, at the call sites in `extractOutput`. */
const PROMPTS: ReadonlyArray<{ path: string; schema: z.ZodTypeAny }> = [
  { path: "shape/sweep/prompt.md", schema: Sweep },
  { path: "shape/shaper/prompt.md", schema: ShaperOutput },
  { path: "shape/refuter/prompt.md", schema: Refutations },
  { path: "to-tickets/seam-sweep/prompt.md", schema: SeamManifest },
  { path: "to-tickets/slice/prompt.md", schema: Plan },
  { path: "to-tickets/audit/prompt.md", schema: Plan },
  { path: "close-gate/salvage/prompt.md", schema: SalvagedRecord },
];

/** The `<output>` blocks in a prompt, in order — a prompt may show more than one legal shape. */
function skeletons(promptPath: string): unknown[] {
  const source = readFileSync(
    fileURLToPath(new URL(`../${promptPath}`, import.meta.url)),
    "utf8",
  );
  const found = [...source.matchAll(/^<output>([\s\S]*?)<\/output>$/gm)];
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

describe.each(PROMPTS)("$path", ({ path, schema }) => {
  it("shows only skeletons the stage's own schema accepts", () => {
    const shown = skeletons(path);
    expect(shown.length).toBeGreaterThan(0);
    for (const skeleton of shown) {
      expect(() => schema.parse(skeleton)).not.toThrow();
    }
  });

  it("populates every array of objects it asks for, so no field's shape is left to prose", () => {
    const shown = skeletons(path);
    const unpopulated = objectArrayPaths(schema).filter((expected) =>
      shown.every((skeleton) =>
        arraysAt(skeleton, expected).every((found) => found.length === 0),
      ),
    );

    expect(unpopulated.map((segments) => segments.join(".") || "(the response itself)")).toEqual(
      [],
    );
  });
});
